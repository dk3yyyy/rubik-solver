/**
 * Two stylesheet rules decide whether features exist at all, so they are worth
 * a test even though node --test has no layout engine:
 *
 *  - the `hidden` attribute has to win over a class rule that sets display;
 *  - the phone layout must not hide the navigation that carries the theme and
 *    colourblind toggles.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const CSS = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles.css'),
  'utf8',
);

test('an element with the hidden attribute is not displayed by its class', () => {
  // `.move-preview { display: flex }` outranked the UA rule for [hidden], so the
  // empty "Next:" bar sat under the controls on every page load, and the webcam
  // confidence bar showed its dash before any capture.
  const rule = /\[hidden\]\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, 'styles.css needs a [hidden] rule');
  assert.match(rule[1], /display:\s*none\s*!important/);
});

test('the phone layout keeps the theme and colourblind toggles reachable', () => {
  const media = /@media \(max-width: 900px\)\s*\{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(media, 'the 900px breakpoint is missing');

  // `.primary-nav { display: none }` hid the links *and* both buttons, leaving
  // dark mode and the colourblind palette unreachable on every phone and
  // tablet.
  assert.doesNotMatch(
    media[1],
    /\.primary-nav\s*\{[^}]*display:\s*none/,
    'the whole navigation is hidden at the 900px breakpoint',
  );
  assert.match(media[1], /\.primary-nav a\s*\{[^}]*display:\s*none/);
});
