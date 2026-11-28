import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseBoardJSON, TileType } from '../js/engine/board.js';
import { checkBoard, measureBoard, lapLength, referenceProfile, styleGap } from '../js/boardCheck.js';
import { generateBoard, playtestBoard, BOARD_SIZES } from '../js/boardGenerator.js';

const boards = JSON.parse(readFileSync(fileURLToPath(new URL('../boards.json', import.meta.url)), 'utf8'));

// Dessin -> grille. S Départ, R B Y G checkpoints, c commande (zone A), x dégâts, D Prize Cube,
// - | téléporteurs, . vide
function gridOf(rows) {
  const cells = {
    S: { type: 'start' },
    R: { type: 'checkpoint', color: 'red' },
    B: { type: 'checkpoint', color: 'blue' },
    Y: { type: 'checkpoint', color: 'yellow' },
    G: { type: 'checkpoint', color: 'green' },
    c: { type: 'command', zone: 'A' },
    x: { type: 'damage', noBox: true },
    D: { type: 'damage', hasDice: true },
    '-': { type: 'teleporter', direction: 'horizontal' },
    '|': { type: 'teleporter', direction: 'vertical' },
    '.': {},
  };
  return rows.map(row => [...row].map(ch => ({ ...cells[ch] })));
}

// Anneau de 12 cases : le Départ et les quatre checkpoints, dans le désordre
const RING = [
  'ScRc',
  'c..c',
  'G..B',
  'ccYc',
];

test('les plateaux de boards.json sont valides, sans remarque', () => {
  for (const [name, entry] of Object.entries(boards)) {
    const check = checkBoard(entry);
    assert.deepEqual(check.errors, [], name);
    assert.deepEqual(check.warnings, [], name);
  }
});

test('un anneau complet est valide et son tour fait le tour de l\'anneau', () => {
  const grid = gridOf(RING);
  assert.equal(checkBoard({ grid }).ok, true);
  assert.equal(lapLength(parseBoardJSON({ grid })), 12);
});

test('un téléporteur compte pour un seul pas dans le tour', () => {
  const grid = gridOf([
    'ScRc',
    '|..c',
    '|..B',
    'GcYc',
  ]);
  assert.equal(checkBoard({ grid }).ok, true);
  assert.equal(lapLength(parseBoardJSON({ grid })), 10);
});

test('checkBoard signale ce qui manque', () => {
  const noStart = RING.map(row => row.replace('S', 'c'));
  assert.match(checkBoard({ grid: gridOf(noStart) }).errors.join('\n'), /Départ/);

  const noRed = RING.map(row => row.replace('R', 'c'));
  assert.match(checkBoard({ grid: gridOf(noRed) }).errors.join('\n'), /checkpoint rouge/);

  assert.deepEqual(checkBoard({ grid: gridOf(['....', '....']) }).errors, ['Le plateau est vide.']);
});

test('checkBoard signale les impasses, les cases coupées du reste et les téléporteurs sans issue', () => {
  const deadEnd = checkBoard({ grid: gridOf([...RING.map(row => `${row}.`), '...c.']) });
  assert.match(deadEnd.errors.join('\n'), /Cul-de-sac en \(4, 3\)/);

  const island = checkBoard({ grid: gridOf(RING.map((row, r) => (r < 2 ? `${row}.cc` : `${row}...`))) });
  assert.match(island.errors.join('\n'), /4 case\(s\) ne sont pas reliées au Départ/);

  const looseLink = checkBoard({ grid: gridOf(RING.map((row, r) => (r === 1 ? `${row}-.` : `${row}..`))) });
  assert.match(looseLink.errors.join('\n'), /Téléporteur en \(1, 4\)/);
});

test('checkBoard signale un Prize Cube isolé, et remarque les cases commande sans zone', () => {
  const loneCube = RING.map((row, r) => (r === 0 ? 'SDRc' : row));
  assert.match(checkBoard({ grid: gridOf(loneCube) }).errors.join('\n'), /Prize Cube en \(0, 1\)/);

  const grid = gridOf(RING);
  delete grid[0][1].zone;
  const check = checkBoard({ grid });
  assert.equal(check.ok, true);
  assert.match(check.warnings.join('\n'), /1 case\(s\) commande sans zone/);
});

test('le profil de référence couvre les plateaux dont il est tiré', () => {
  const profile = referenceProfile(boards);
  assert.equal(profile.boards, Object.keys(boards).length);
  for (const [name, entry] of Object.entries(boards)) {
    assert.equal(styleGap(measureBoard(entry), profile), 0, name);
  }
});

test('une même graine redonne le même plateau, une autre graine un plateau différent', () => {
  const first = generateBoard({ seed: 12, reference: boards });
  const again = generateBoard({ seed: 12, reference: boards });
  const other = generateBoard({ seed: 13, reference: boards });
  assert.deepEqual(again.board, first.board);
  assert.notDeepEqual(other.board, first.board);
});

test('les plateaux générés sont valides et bien construits, pour toutes les tailles', () => {
  const profile = referenceProfile(boards);
  for (const [size, preset] of Object.entries(BOARD_SIZES)) {
    for (let seed = 1; seed <= 40; seed++) {
      const label = `${size}, graine ${seed}`;
      const { board, metrics } = generateBoard({ seed, size, reference: boards });

      const check = checkBoard(board);
      assert.deepEqual(check.errors, [], label);
      assert.deepEqual(check.warnings, [], label);

      assert.ok(metrics.tiles >= preset.tiles[0] && metrics.tiles <= preset.tiles[1], `${label} : ${metrics.tiles} cases`);
      assert.ok(metrics.loops >= 3, `${label} : ${metrics.loops} boucles`);
      assert.ok(metrics.junctions >= 4, `${label} : ${metrics.junctions} carrefours`);
      assert.ok(metrics.links >= 1, `${label} : aucun téléporteur`);
      assert.ok(metrics.zones.length >= 3 && metrics.zones[0] >= 2, `${label} : zones de ${metrics.zones.join('/')}`);
      assert.ok(Number.isFinite(metrics.lap), `${label} : pas de tour complet`);
      // Chaque piste de dégâts a son Prize Cube, et un seul
      assert.ok(metrics.tracks.length >= 2 && metrics.tracks[0] >= 3, `${label} : pistes de ${metrics.tracks.join('/')}`);
      assert.equal(metrics.cubes, metrics.tracks.length, label);
      // Proportions proches de celles des plateaux faits main
      assert.ok(styleGap(metrics, profile) < 0.5, `${label} : écart de style ${styleGap(metrics, profile)}`);

      // Chemins fins : aucune case n'a plus de trois sorties, les zones tiennent dans la grille de l'éditeur
      const { tiles } = parseBoardJSON(board);
      for (const tile of tiles) {
        const exits = Object.values(tile.adjacencies).filter(Boolean).length;
        assert.ok(exits === 2 || exits === 3, `${label} : case (${tile.row}, ${tile.col}) à ${exits} sorties`);
        if (tile.type === TileType.NORMAL) assert.match(tile.zone, /^[A-F]$/, label);
      }
      assert.equal(board.grid.length, board.grid[0].length, `${label} : grille carrée`);
    }
  }
});

test('des parties entre IA vont à leur terme sur les plateaux générés', () => {
  for (const size of Object.keys(BOARD_SIZES)) {
    const { board, playtest } = generateBoard({ seed: 5, size, reference: boards, playtest: 2 });
    assert.deepEqual({ games: playtest.games, finished: playtest.finished }, { games: 2, finished: 2 }, size);
    assert.equal(playtestBoard(board, { games: 1, seed: 99 }).finished, 1, size);
  }
});
