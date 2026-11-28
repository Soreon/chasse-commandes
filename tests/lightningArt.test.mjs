import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boltGrid, burstGrid, cloudGrid, BURST_STAGES, EDGE, RIM } from '../js/lightningArt.js';
import { createRng } from '../js/engine/rng.js';

const at = (grid, x, y) => grid.cells[y * grid.width + x];
const drawn = (grid, x, y) => at(grid, x, y) > EDGE;

// Les formes d'éclair dont se servent les mises en scène
const SHAPES = [
  { width: 41, height: 120, thick: 3, forks: 2 },
  { width: 31, height: 110, thick: 2, forks: 1 },
  { width: 25, height: 26, thick: 3, forks: 0, stride: [4, 7] },
];

test('un éclair va du haut de la grille à sa pointe, au milieu du bas, sans trou', () => {
  for (const shape of SHAPES) {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createRng(seed);
      const grid = boltGrid(() => rng.next(), shape);
      const label = `${shape.width}x${shape.height}, graine ${seed}`;

      const centre = (shape.width - 1) / 2;
      assert.equal(at(grid, centre, shape.height - 1), RIM, `pointe absente (${label})`);
      for (let y = 0; y < shape.height; y++) {
        let found = false;
        for (let x = 0; x < shape.width; x++) found = found || drawn(grid, x, y);
        assert.ok(found, `rangée ${y} vide (${label})`);
      }

      // D'un seul tenant : tous les points se rejoignent par leurs côtés
      const seen = new Set([`${centre},${shape.height - 1}`]);
      const queue = [[centre, shape.height - 1]];
      while (queue.length > 0) {
        const [x, y] = queue.pop();
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= shape.width || ny >= shape.height) continue;
          if (!drawn(grid, nx, ny) || seen.has(`${nx},${ny}`)) continue;
          seen.add(`${nx},${ny}`);
          queue.push([nx, ny]);
        }
      }
      let total = 0;
      for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] > EDGE) total += 1;
      assert.equal(seen.size, total, `éclair en plusieurs morceaux (${label})`);
    }
  }
});

test('le trait principal garde la place de son liseré sur les côtés', () => {
  // Sans ramification, rien ne doit toucher les bords gauche et droit de la grille
  const rng = createRng(7);
  for (let n = 0; n < 60; n++) {
    const grid = boltGrid(() => rng.next(), { width: 41, height: 120, thick: 3, forks: 0 });
    for (let y = 0; y < grid.height; y++) {
      assert.ok(!drawn(grid, 0, y) && !drawn(grid, grid.width - 1, y));
    }
  }
});

test('la même suite de hasard redonne le même éclair', () => {
  const draw = () => {
    const rng = createRng(42);
    return boltGrid(() => rng.next(), SHAPES[0]);
  };
  assert.deepEqual(draw().cells, draw().cells);
});

test('éclat et nuage : dessins centrés, entourés de leur liseré', () => {
  for (let stage = 0; stage < BURST_STAGES; stage++) {
    const grid = burstGrid(stage);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        // Symétrique dans les deux sens
        assert.equal(at(grid, x, y), at(grid, grid.width - 1 - x, y));
        assert.equal(at(grid, x, y), at(grid, x, grid.height - 1 - y));
      }
    }
    assert.ok(grid.cells.some(code => code > EDGE));
  }

  const cloud = cloudGrid();
  for (let x = 0; x < cloud.width; x++) {
    assert.ok(!drawn(cloud, x, 0) && !drawn(cloud, x, cloud.height - 1), 'le nuage touche le haut ou le bas');
  }
  // L'éclair sort du milieu de la base : elle doit être pleine à cet endroit
  assert.ok(drawn(cloud, (cloud.width - 1) / 2, 11));
});
