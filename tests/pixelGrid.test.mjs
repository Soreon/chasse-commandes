import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EDGE, gridFromRows } from '../js/pixelGrid.js';

const at = (grid, x, y) => grid.cells[y * grid.width + x];

test('un dessin écrit à la main reçoit une marge et son liseré', () => {
  const grid = gridFromRows(['.A.', 'ABA'], { A: 2, B: 3 });
  assert.equal(grid.width, 5);
  assert.equal(grid.height, 4);
  // Le dessin est décalé d'un point
  assert.equal(at(grid, 2, 1), 2);
  assert.equal(at(grid, 2, 2), 3);
  // Liseré : les points vides qui touchent le dessin par un côté, pas ceux qui ne le touchent
  // que par un coin
  assert.equal(at(grid, 2, 0), EDGE);
  assert.equal(at(grid, 1, 1), EDGE);
  assert.equal(at(grid, 0, 2), EDGE);
  assert.equal(at(grid, 0, 1), 0);
  assert.equal(at(grid, 0, 0), 0);
});

test('une rangée trop courte ou un caractère inconnu sont signalés', () => {
  assert.throws(() => gridFromRows(['AAA', 'AA'], { A: 2 }), /Rangée 1/);
  assert.throws(() => gridFromRows(['AXA'], { A: 2 }), /sans couleur/);
});
