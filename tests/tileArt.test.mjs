import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeTileArt } from '../js/tileArt.js';

// Construit une image carrée à partir de lignes de caractères et d'une palette
function art(rows, palette) {
  const size = rows.length;
  const data = [];
  for (const row of rows) {
    for (const ch of row) data.push(...palette[ch]);
  }
  return { size, data };
}

const kindAt = (model, x, y) => model.cells.find(c => c.x === x && c.y === y).kind;
const colorAt = (model, x, y) => model.cells.find(c => c.x === x && c.y === y).color;

test('case commande : cadre, fond gris et emplacement en creux au centre', () => {
  const model = analyzeTileArt(art([
    'HHHHHHH',
    'LffffFS',
    'Lf...fS',
    'Lf...fS',
    'Lf...fS',
    'LfffFfS',
    'DDDDDDD',
  ], {
    H: [240, 240, 240, 255], // reflet du haut
    L: [168, 168, 168, 255], // colonne de gauche : teinte du cube
    S: [160, 160, 160, 255],
    D: [112, 112, 112, 255],
    f: [193, 193, 193, 255], // cadre intérieur
    F: [185, 185, 185, 255], // même couleur à une nuance près
    '.': [0, 0, 0, 0],       // transparent
  }));

  assert.equal(model.size, 7);
  assert.equal(model.body, 0xa8a8a8);
  assert.equal(model.rim, 0xf0f0f0);
  assert.equal(kindAt(model, 0, 0), 'rim');
  assert.equal(kindAt(model, 6, 3), 'rim');
  assert.equal(kindAt(model, 1, 1), 'bg');
  assert.equal(kindAt(model, 5, 1), 'bg', 'une nuance proche reste dans le fond');
  assert.equal(kindAt(model, 3, 3), 'slot');
  assert.equal(model.cells.filter(c => c.kind === 'slot').length, 9);
  assert.equal(model.cells.filter(c => c.kind === 'motif').length, 0);
});

test('checkpoint : le fond est la couleur du pourtour, la croix forme le motif', () => {
  const model = analyzeTileArt(art([
    'HHHHHHH',
    'LwwrwwS',
    'LwrrrwS',
    'LrrrrrS',
    'LwrrrwS',
    'LwwrwwS',
    'DDDDDDD',
  ], {
    H: [248, 136, 120, 255],
    L: [240, 72, 64, 255],
    S: [176, 16, 8, 255],
    D: [120, 16, 8, 255],
    w: [248, 240, 240, 255],
    r: [240, 24, 8, 255],
  }));

  assert.equal(model.body, 0xf04840);
  assert.equal(kindAt(model, 1, 1), 'bg');
  assert.equal(colorAt(model, 1, 1), 0xf8f0f0);
  assert.equal(kindAt(model, 3, 3), 'motif');
  assert.equal(kindAt(model, 3, 1), 'motif', 'le bout de la croix touche le pourtour mais reste du motif');
  assert.equal(colorAt(model, 3, 3), 0xf01808);
  assert.equal(model.cells.filter(c => c.kind === 'motif').length, 13);
});

test('une image trop petite ou trop grande n\'est pas exploitée', () => {
  assert.equal(analyzeTileArt({ size: 3, data: new Array(3 * 3 * 4).fill(255) }), null);
  assert.equal(analyzeTileArt({ size: 64, data: new Array(64 * 64 * 4).fill(255) }), null);
});
