/**
 * A page whose JavaScript never runs still builds, and the build is what CI
 * checked: PR #21 deleted App.init() and left `this.init()` in the constructor,
 * so the frontend threw on load and every green pipeline since shipped a dead
 * page. It also called `this.announce(...)` from fifteen places with no
 * definition anywhere. Neither is visible to the bundler.
 *
 * This walks the source and asserts that every `this.something(...)` call has a
 * definition in the same file. It cannot see across files or inheritance, which
 * is fine: the file it protects has neither.
 *
 * The first test is the important one. A static check that stops matching is a
 * check that always passes, so the checker is run over a snippet with a call
 * that has no definition and must report it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const SRC = path.join(import.meta.dirname, '..', 'src');

const CALL = /this\.([A-Za-z_$][\w$]*)\s*\(/;
const METHOD = /^\s{2,}(?:async\s+|static\s+|get\s+|set\s+|\*\s*)?([A-Za-z_$][\w$]*)\s*\(/;
const FIELD = /^\s{2,}([A-Za-z_$][\w$]*)\s*=(?!=)/;
const FUNCTION = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const ARROW = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/;
const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'function', 'await',
  'typeof', 'new', 'do', 'try', 'in', 'of', 'import', 'export', 'delete', 'void',
]);

function optionsFromConstructor(text) {
  // `constructor(netEl, { onChange } = {})` puts callbacks on the instance.
  const names = new Set();
  const match = text.match(/constructor\s*\(([\s\S]*?)\)\s*\{/);
  if (!match) return names;
  const braced = match[1].match(/\{([^}]*)\}/);
  if (!braced) return names;
  for (const part of braced[1].split(',')) {
    const name = part.split('=')[0].trim().replace(/^\.\.\./, '');
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
  }
  return names;
}

function definitions(text) {
  const names = optionsFromConstructor(text);
  names.add('constructor');
  for (const line of text.split('\n')) {
    for (const pattern of [METHOD, FIELD, FUNCTION, ARROW]) {
      const match = pattern.exec(line);
      if (match && !RESERVED.has(match[1])) names.add(match[1]);
    }
  }
  return names;
}

function unresolvedCalls(text) {
  const known = definitions(text);
  const found = [];
  text.split('\n').forEach((line, index) => {
    const code = line.split('//')[0];
    const match = CALL.exec(code);
    if (match && !known.has(match[1])) {
      found.push({ line: index + 1, name: match[1] });
    }
  });
  return found;
}

test('the checker notices a call with no definition', () => {
  const broken = [
    'class Example {',
    '  constructor() {',
    '    this.init();',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(unresolvedCalls(broken), [{ line: 3, name: 'init' }]);
});

test('the checker accepts a method, a field callback and a constructor option', () => {
  const fine = [
    'class Example {',
    '  constructor({ onChange } = {}) {',
    '    this.setup();',
    '    this.onChange();',
    '    this.handler();',
    '  }',
    '  setup() {}',
    '  handler = () => {};',
    '}',
  ].join('\n');
  assert.deepEqual(unresolvedCalls(fine), []);
});

// Ids the source looks up that the markup does not have. Each one is a feature
// with no UI, which arrived with the PR that added the code. They are listed
// rather than ignored so that a *new* one fails the test, and so that the debt
// is visible in one place; removing an entry means adding the element.
const MISSING_FROM_MARKUP = new Map([
  ['btn-copy-link', 'the copy-link button: PR #21 added the handler, never the button'],
  ['inspection-timer', 'the inspection timer display: PR #21 added the logic, never the element'],
  ['speedcubing-stats', 'the ao5/ao12 stats panel: PR #21 added the module, never the element'],
]);

test('every getElementById in the source has that id in the markup', () => {
  const html = fs.readFileSync(path.join(SRC, '..', 'index.html'), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const files = fs.readdirSync(SRC).filter((name) => name.endsWith('.js'));
  const problems = [];
  const stillReferenced = new Set();
  for (const name of files) {
    const text = fs.readFileSync(path.join(SRC, name), 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
      const code = line.split('//')[0];
      for (const match of code.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
        if (MISSING_FROM_MARKUP.has(match[1])) {
          stillReferenced.add(match[1]);
        } else if (!ids.has(match[1])) {
          problems.push(`${name}:${index + 1} looks up #${match[1]}, which the markup does not have`);
        }
      }
      if (line.includes('speedcubing-stats')) stillReferenced.add('speedcubing-stats');
    }
  }
  assert.deepEqual(problems, []);
  const stale = [...MISSING_FROM_MARKUP.keys()].filter((id) => !stillReferenced.has(id));
  assert.deepEqual(stale, [], 'these ids now have markup (or no longer exist): drop them from the list');
});

test('every this.x(...) call in the frontend source has a definition', () => {
  const files = fs.readdirSync(SRC).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 4, `expected the frontend sources in ${SRC}`);
  const problems = [];
  for (const name of files) {
    const text = fs.readFileSync(path.join(SRC, name), 'utf8');
    for (const { line, name: called } of unresolvedCalls(text)) {
      problems.push(`${name}:${line} calls this.${called}(...) but nothing defines it`);
    }
  }
  assert.deepEqual(problems, []);
});
