/**
 * The "enter your cube" panel: a clickable net of the six faces plus a colour
 * palette, so a scrambled physical cube can be typed in sticker by sticker.
 *
 * Pure state lives in cube-logic.js; this module only builds and updates the
 * DOM and reports changes back to the app.
 */

import {
  FACE_COLOURS,
  FACE_NET,
  FACE_ORDER,
  STICKERS_PER_FACE,
  STICKER_COUNT,
  describeInputProblems,
  faceletFromStickers,
} from './cube-logic.js';

const CENTRE = 4; // index of a face's centre sticker inside its nine
const FACE_LABEL = {
  U: 'Up (white)',
  R: 'Right (red)',
  F: 'Front (green)',
  D: 'Down (yellow)',
  L: 'Left (orange)',
  B: 'Back (blue)',
};

export class CubeInput {
  constructor(netEl, paletteEl, { onChange } = {}) {
    this.netEl = netEl;
    this.paletteEl = paletteEl;
    this.onChange = onChange || (() => {});
    this.brush = 'U';
    this.stickers = new Array(STICKER_COUNT).fill(null);
    // A cube's centre stickers define its colour scheme, so they are fixed:
    // holding the cube white-up and green-front makes each centre predictable.
    FACE_ORDER.forEach((face, faceIndex) => {
      this.stickers[faceIndex * STICKERS_PER_FACE + CENTRE] = face;
    });
    this.build();
  }

  indexFor(face, offset) {
    return FACE_ORDER.indexOf(face) * STICKERS_PER_FACE + offset;
  }

  build() {
    this.buildPalette();
    this.buildNet();
    this.refresh();
  }

  buildPalette() {
    this.paletteEl.innerHTML = '';
    for (const face of FACE_ORDER) {
      const { name, hex } = FACE_COLOURS[face];
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.dataset.face = face;
      swatch.style.setProperty('--swatch-colour', hex);
      swatch.innerHTML = `<span class="swatch-dot"></span><span class="swatch-name">${name}</span>`;
      swatch.title = `Paint ${name} stickers (${face})`;
      swatch.addEventListener('click', () => this.setBrush(face));
      this.paletteEl.appendChild(swatch);
    }

    const eraser = document.createElement('button');
    eraser.type = 'button';
    eraser.className = 'swatch swatch-eraser';
    eraser.dataset.face = 'erase';
    eraser.innerHTML = '<span class="swatch-dot"></span><span class="swatch-name">clear</span>';
    eraser.title = 'Clear stickers';
    eraser.addEventListener('click', () => this.setBrush('erase'));
    this.paletteEl.appendChild(eraser);
  }

  buildNet() {
    this.netEl.innerHTML = '';
    for (const { face, row, column } of FACE_NET) {
      const block = document.createElement('div');
      block.className = 'face-block';
      block.style.gridRow = row;
      block.style.gridColumn = column;

      const label = document.createElement('div');
      label.className = 'face-label';
      label.textContent = FACE_LABEL[face];
      block.appendChild(label);

      const grid = document.createElement('div');
      grid.className = 'face-grid';
      for (let offset = 0; offset < STICKERS_PER_FACE; offset += 1) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'sticker';
        cell.dataset.face = face;
        cell.dataset.offset = String(offset);
        cell.addEventListener('click', () => this.paint(face, offset));
        grid.appendChild(cell);
      }
      block.appendChild(grid);
      this.netEl.appendChild(block);
    }
  }

  setBrush(brush) {
    this.brush = brush;
    this.refresh();
  }

  paint(face, offset) {
    const index = this.indexFor(face, offset);
    if (offset === CENTRE) {
      // The centre is the face's identity; leave it for the app to explain.
      this.onChange(this.getState(), { lockedCentre: face });
      return;
    }
    this.stickers[index] = this.brush === 'erase' ? null : this.brush;
    this.refresh();
    this.onChange(this.getState());
  }

  getStickers() {
    return [...this.stickers];
  }

  getFacelet() {
    return faceletFromStickers(this.stickers);
  }

  problems() {
    return describeInputProblems(this.stickers);
  }

  isComplete() {
    return this.problems() === null;
  }

  clear() {
    this.stickers = new Array(STICKER_COUNT).fill(null);
    FACE_ORDER.forEach((face, faceIndex) => {
      this.stickers[faceIndex * STICKERS_PER_FACE + CENTRE] = face;
    });
    this.refresh();
    this.onChange(this.getState());
  }

  /** Load an existing 54-character facelet into the picker. */
  setFacelet(facelet) {
    if (typeof facelet !== 'string' || facelet.length !== STICKER_COUNT) return false;
    this.stickers = facelet.toUpperCase().split('');
    this.refresh();
    this.onChange(this.getState());
    return true;
  }

  getState() {
    return {
      stickers: this.getStickers(),
      facelet: this.getFacelet(),
      problems: this.problems(),
      complete: this.isComplete(),
    };
  }

  refresh() {
    const cbMode = document.documentElement.classList.contains('cb-mode');
    for (const swatch of this.paletteEl.querySelectorAll('.swatch')) {
      swatch.classList.toggle('is-active', swatch.dataset.face === this.brush);
    }
    for (const cell of this.netEl.querySelectorAll('.sticker')) {
      const face = cell.dataset.face;
      const offset = Number(cell.dataset.offset);
      const sticker = this.stickers[this.indexFor(face, offset)];
      const colours = sticker ? FACE_COLOURS[sticker] : null;
      cell.classList.toggle('is-empty', !colours);
      cell.classList.toggle('is-centre', offset === CENTRE);
      cell.style.background = colours ? colours.hex : '';
      // Colorblind mode: add pattern overlay class and letter indicator
      cell.className = cell.className.replace(/cb-pattern-\w/g, '');
      if (cbMode && colours) {
        cell.classList.add(`cb-pattern-${sticker}`);
        cell.dataset.cbLetter = sticker;
      } else {
        delete cell.dataset.cbLetter;
      }
      const position = offset + 1;
      const cbSuffix = cbMode && colours ? ` (${sticker})` : '';
      cell.setAttribute(
        'aria-label',
        `${FACE_LABEL[face]} sticker ${position}, ${colours ? colours.name : 'empty'}${cbSuffix}`,
      );
      cell.title = colours ? colours.name : 'empty';
    }
  }
}
