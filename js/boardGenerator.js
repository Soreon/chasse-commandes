// Générateur de plateaux : construit un plateau jouable à partir d'une graine. Module pur.
//
// Les plateaux faits main servent de modèle (referenceProfile, dans boardCheck.js). Ils ont tous
// la même charpente : des boucles de chemins « fins » (deux chemins ne sont jamais collés), sans
// impasse, avec quelques raccourcis en téléporteurs. Le générateur procède donc ainsi :
//   1. la charpente : une boucle de départ, puis des « oreilles », c'est-à-dire un nouveau chemin
//      tiré entre deux cases déjà posées. Chaque oreille ajoute une boucle et deux carrefours, et
//      ne peut pas créer d'impasse ;
//   2. les téléporteurs : portions droites remplacées par un pont, raccourcis entre deux cases
//      qui se font face ;
//   3. l'habillage : Départ, checkpoints éloignés les uns des autres, pistes de dégâts avec leur
//      Prize Cube, cases spéciales, puis zones de cases commande ;
//   4. le contrôle : le plateau doit passer checkBoard ; parmi plusieurs essais, on garde celui
//      dont les proportions s'écartent le moins de celles des plateaux de référence.

import { createRng } from './engine/rng.js';
import { parseBoardJSON, distancesTo, TileType, CHECKPOINT_COLORS } from './engine/board.js';
import { Game } from './engine/game.js';
import { runHeadless } from './engine/headless.js';
import { checkBoard, measureBoard, lapLength, referenceProfile, styleGap } from './boardCheck.js';
import { ZONE_IDS, zoneDefsOf } from './zones.js';

// Gabarits : côté de la grille de travail, nombre de cases visé, puis nombre d'oreilles en cases,
// de coins coupés, de ponts et de raccourcis en téléporteurs, et de pistes de dégâts ([minimum, maximum])
export const BOARD_SIZES = {
  small: { name: 'Petit', side: 11, tiles: [34, 42], ears: [1, 2], cuts: [0, 2], bridges: [0, 1], shortcuts: [1, 1], tracks: [2, 2] },
  medium: { name: 'Moyen', side: 13, tiles: [48, 58], ears: [2, 3], cuts: [0, 4], bridges: [0, 2], shortcuts: [1, 2], tracks: [2, 3] },
  large: { name: 'Grand', side: 15, tiles: [66, 80], ears: [3, 4], cuts: [1, 5], bridges: [0, 3], shortcuts: [1, 2], tracks: [3, 4] },
};

// Proportions des sept plateaux d'origine, utilisées quand aucun plateau de référence n'est fourni
const DEFAULT_PROFILE = {
  commandShare: { min: 0.395, max: 0.625 },
  damageShare: { min: 0.161, max: 0.321 },
  bonusShare: { min: 0.018, max: 0.123 },
  eventShare: { min: 0.037, max: 0.073 },
  junctionShare: { min: 0.093, max: 0.182 },
  corridorShare: { min: 0.143, max: 0.442 },
  lapShare: { min: 0.691, max: 1.212 },
  trackLength: { min: 3, max: 8 },
};

const EMPTY = 0;
const TILE = 1;
const LINK_H = 2;
const LINK_V = 3;

// Pas dans la grille : nord, sud, est, ouest
const STEPS = [[-1, 0], [1, 0], [0, 1], [0, -1]];
const REVERSE = [1, 0, 3, 2];
const isVertical = dir => dir < 2;

const MAX_LINK = 6;          // longueur maximale d'un téléporteur, en cellules
const MIN_EAR = 3;           // longueur minimale d'une oreille, en cases
const MIN_LOOP = 8;          // une oreille ne doit pas fermer une boucle plus courte
const TURN_COST = 2.5;       // un virage coûte autant que quelques cases : les chemins restent droits
const LANE_COSTS = [1, 1, 2, 3];
const MAX_ATTEMPTS = 80;

const profiles = new WeakMap(); // plateaux de référence -> leur profil

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const between = (rng, [min, max]) => min + rng.int(max - min + 1);

// === 1. Charpente ===

// Grille de travail : chaque cellule est vide, une case ou un morceau de téléporteur
function createSkeleton(side) {
  const cells = new Uint8Array(side * side);

  // Cellule voisine dans une direction, ou -1 hors de la grille
  const step = (cell, dir) => {
    const r = Math.floor(cell / side) + STEPS[dir][0];
    const c = (cell % side) + STEPS[dir][1];
    return r >= 0 && c >= 0 && r < side && c < side ? r * side + c : -1;
  };

  // Cellules occupées (case ou téléporteur) qui touchent la cellule
  const occupiedAround = (cell) => {
    const out = [];
    for (let dir = 0; dir < 4; dir++) {
      const next = step(cell, dir);
      if (next !== -1 && cells[next] !== EMPTY) out.push(next);
    }
    return out;
  };

  // Sorties d'une case : les cases voisines, et celles au bout d'un téléporteur qui part d'elle
  const exits = (cell) => {
    const out = [];
    for (let dir = 0; dir < 4; dir++) {
      const link = isVertical(dir) ? LINK_V : LINK_H;
      let next = step(cell, dir);
      while (next !== -1 && cells[next] === link) next = step(next, dir);
      if (next !== -1 && cells[next] === TILE) out.push(next);
    }
    return out;
  };

  const tiles = () => {
    const out = [];
    for (let cell = 0; cell < cells.length; cell++) if (cells[cell] === TILE) out.push(cell);
    return out;
  };

  // Nombre de pas depuis une case vers toutes les autres (-1 : inatteignable)
  const distancesFrom = (from) => {
    const dist = new Int16Array(cells.length).fill(-1);
    const queue = [from];
    dist[from] = 0;
    for (let i = 0; i < queue.length; i++) {
      for (const next of exits(queue[i])) {
        if (dist[next] === -1) {
          dist[next] = dist[queue[i]] + 1;
          queue.push(next);
        }
      }
    }
    return dist;
  };

  // Une case peut recevoir un nouvel embranchement si elle est en plein couloir, et (sauf si
  // `loose`) à l'écart des carrefours existants
  const canBranch = (cell, loose = false) => {
    const around = exits(cell);
    return around.length === 2 && (loose || around.every(next => exits(next).length === 2));
  };

  return { side, cells, step, occupiedAround, exits, tiles, distancesFrom, canBranch };
}

// Boucle de départ : un rectangle dont le pourtour fait à peu près la moitié des cases visées
function drawCore(skeleton, rng, target) {
  const { side, cells } = skeleton;
  const perimeter = target * (0.42 + rng.next() * 0.2);
  const halfSum = Math.round((perimeter + 4) / 2); // largeur + hauteur
  const width = clamp(Math.round(halfSum / 2 + (rng.next() - 0.5) * 4), 4, side);
  const height = clamp(halfSum - width, 4, side);
  const top = rng.int(side - height + 1);
  const left = rng.int(side - width + 1);
  for (let r = top; r < top + height; r++) {
    for (let c = left; c < left + width; c++) {
      if (r === top || r === top + height - 1 || c === left || c === left + width - 1) cells[r * side + c] = TILE;
    }
  }
}

// Tous les chemins possibles pour une oreille partant d'une case : le plus court chemin (virages
// pénalisés) vers chaque cellule libre qui touche une autre case, en restant à une cellule de
// distance de tout ce qui existe déjà. -> [{ path: [cellules], to: case d'arrivée }]
function earsFrom(skeleton, anchor, rng) {
  const { side, cells, step, occupiedAround } = skeleton;
  // Rangées et colonnes plus ou moins « chères » : les chemins s'alignent sur les moins chères
  const rowCost = Array.from({ length: side }, () => rng.pick(LANE_COSTS));
  const colCost = Array.from({ length: side }, () => rng.pick(LANE_COSTS));
  const stepCost = (cell, dir) => (isVertical(dir) ? colCost[cell % side] : rowCost[Math.floor(cell / side)]);

  // Nœud du parcours : cellule et direction par laquelle on y est entré
  const cost = new Float64Array(cells.length * 4).fill(Infinity);
  const previous = new Int32Array(cells.length * 4).fill(-1);
  const closed = new Uint8Array(cells.length * 4);
  const open = [];
  const arrivals = new Map(); // cellule d'arrivée -> { cost, from, to }

  for (let dir = 0; dir < 4; dir++) {
    const cell = step(anchor, dir);
    if (cell === -1 || cells[cell] !== EMPTY || occupiedAround(cell).length !== 1) continue;
    cost[cell * 4 + dir] = stepCost(cell, dir);
    open.push(cell * 4 + dir);
  }

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (cost[open[i]] < cost[open[best]]) best = i;
    const node = open.splice(best, 1)[0];
    if (closed[node]) continue;
    closed[node] = 1;

    const cell = node >> 2;
    const dir = node & 3;
    for (let next = 0; next < 4; next++) {
      if (next === REVERSE[dir]) continue;
      const target = step(cell, next);
      if (target === -1 || cells[target] !== EMPTY) continue;
      const around = occupiedAround(target);
      const total = cost[node] + stepCost(target, next) + (next === dir ? 0 : TURN_COST);

      if (around.length === 0) {
        const targetNode = target * 4 + next;
        if (total < cost[targetNode]) {
          cost[targetNode] = total;
          previous[targetNode] = node;
          open.push(targetNode);
        }
      } else if (around.length === 1 && around[0] !== anchor && cells[around[0]] === TILE) {
        // La cellule touche une seule autre case : l'oreille peut s'y raccorder
        const known = arrivals.get(target);
        if (!known || total < known.cost) arrivals.set(target, { cost: total, from: node, to: around[0] });
      }
    }
  }

  return [...arrivals].map(([cell, arrival]) => {
    const path = [cell];
    for (let node = arrival.from; node !== -1; node = previous[node]) path.push(node >> 2);
    return { path: path.reverse(), to: arrival.to };
  });
}

// Ajoute une oreille en cases d'environ `ideal` cases (au plus `max`). Retourne false si aucune ne convient.
function addEar(skeleton, rng, ideal, max) {
  const { cells, exits, tiles, distancesFrom, canBranch } = skeleton;

  for (const anchor of rng.shuffle(tiles().filter(cell => canBranch(cell)))) {
    const apart = distancesFrom(anchor);
    const ears = earsFrom(skeleton, anchor, rng).filter(ear => canBranch(ear.to)
      && ear.path.length >= MIN_EAR && ear.path.length <= max
      && apart[ear.to] >= 3 && ear.path.length + apart[ear.to] + 1 >= MIN_LOOP);
    if (ears.length === 0) continue;

    // Tirage qui favorise les longueurs proches de celle voulue
    const weights = ears.map(ear => 1 / (1 + Math.abs(ear.path.length - ideal)) ** 2);
    let draw = rng.next() * weights.reduce((a, b) => a + b, 0);
    const ear = ears.find((_, i) => (draw -= weights[i]) < 0) || ears[ears.length - 1];

    for (const cell of ear.path) cells[cell] = TILE;
    // Garde-fou : l'oreille doit rester un chemin simple, sans contact avec le reste
    const clean = ear.path.every(cell => exits(cell).length === 2)
      && exits(anchor).length === 3 && exits(ear.to).length === 3
      && new Set(ear.path).size === ear.path.length;
    if (clean) return true;
    for (const cell of ear.path) cells[cell] = EMPTY;
  }
  return false;
}

// Coin coupé : la case d'angle d'un couloir passe dans le creux du virage, ce qui dessine un
// escalier et casse l'allure trop rectangulaire des boucles (le nombre de cases ne change pas)
function cutCorner(skeleton, rng) {
  const { side, cells, step, exits, occupiedAround, tiles } = skeleton;
  const tileAt = (cell, dir) => {
    const next = step(cell, dir);
    return next !== -1 && cells[next] === TILE ? next : -1;
  };

  for (const corner of rng.shuffle(tiles())) {
    if (exits(corner).length !== 2) continue;
    const vertical = [0, 1].map(dir => tileAt(corner, dir)).filter(cell => cell !== -1);
    const horizontal = [2, 3].map(dir => tileAt(corner, dir)).filter(cell => cell !== -1);
    if (vertical.length !== 1 || horizontal.length !== 1) continue;
    // Creux du virage : sur la rangée de la voisine verticale et la colonne de la voisine horizontale
    const inner = Math.floor(vertical[0] / side) * side + (horizontal[0] % side);
    if (cells[inner] !== EMPTY || occupiedAround(inner).length !== 2) continue;
    cells[corner] = EMPTY;
    cells[inner] = TILE;
    return true;
  }
  return false;
}

// Pont : remplace 1 à 3 cases alignées d'un couloir droit par un téléporteur
function addBridge(skeleton, rng, maxLength) {
  const { cells, step, exits, tiles } = skeleton;
  // Axe (0 : vertical, 2 : horizontal) d'une case de couloir droit dégagée sur les côtés, sinon -1
  const axisOf = (cell) => {
    if (cells[cell] !== TILE || exits(cell).length !== 2) return -1;
    for (const dir of [0, 2]) {
      const ahead = step(cell, dir);
      const behind = step(cell, REVERSE[dir]);
      if (ahead === -1 || behind === -1 || cells[ahead] !== TILE || cells[behind] !== TILE) continue;
      const sides = isVertical(dir) ? [2, 3] : [0, 1];
      if (sides.every(side => step(cell, side) === -1 || cells[step(cell, side)] === EMPTY)) return dir;
    }
    return -1;
  };

  for (const first of rng.shuffle(tiles().filter(cell => axisOf(cell) !== -1))) {
    const axis = axisOf(first);
    const run = [first];
    const wanted = 1 + rng.int(maxLength);
    for (let next = step(first, axis); run.length < wanted && next !== -1 && axisOf(next) === axis; next = step(next, axis)) {
      run.push(next);
    }
    for (const cell of run) cells[cell] = isVertical(axis) ? LINK_V : LINK_H;
    return run.length;
  }
  return 0;
}

// Raccourci : téléporteur entre deux cases de couloir qui se font face à travers du vide
function addShortcut(skeleton, rng) {
  const { cells, step, tiles, distancesFrom, canBranch } = skeleton;

  for (const loose of [false, true]) {
    const options = [];
    for (const from of tiles()) {
      if (!canBranch(from, loose)) continue;
      const apart = distancesFrom(from);
      for (const dir of [1, 2]) { // sud et est : chaque paire de cases n'est examinée qu'une fois
        const sides = isVertical(dir) ? [2, 3] : [0, 1];
        const run = [];
        let cell = step(from, dir);
        while (cell !== -1 && cells[cell] === EMPTY && run.length < MAX_LINK
          && sides.every(side => step(cell, side) === -1 || cells[step(cell, side)] === EMPTY)) {
          run.push(cell);
          cell = step(cell, dir);
        }
        if (run.length === 0 || cell === -1 || cells[cell] !== TILE || !canBranch(cell, loose)) continue;
        // Un vrai raccourci : il doit faire gagner nettement plus de pas qu'il n'est long
        if (apart[cell] < Math.max(6, run.length * 2 + 2)) continue;
        options.push({ run, dir, gain: apart[cell] });
      }
    }
    if (options.length === 0) continue;

    let draw = rng.next() * options.reduce((sum, option) => sum + option.gain, 0);
    const chosen = options.find(option => (draw -= option.gain) < 0) || options[options.length - 1];
    for (const cell of chosen.run) cells[cell] = isVertical(chosen.dir) ? LINK_V : LINK_H;
    return true;
  }
  return false;
}

// Charpente complète -> grille (cases commande et téléporteurs) recadrée, ou null si le nombre
// de cases visé n'a pas pu être atteint
function buildLayout(rng, preset) {
  const skeleton = createSkeleton(preset.side);
  const { cells, side, tiles } = skeleton;
  const [minTiles, maxTiles] = preset.tiles;
  const target = between(rng, preset.tiles);
  const shortcuts = between(rng, preset.shortcuts);
  const bridges = between(rng, preset.bridges);

  drawCore(skeleton, rng, target);

  // Oreilles en cases, jusqu'au nombre de cases visé ; deux de plus au besoin, si les oreilles
  // prévues ont été trop courtes pour atteindre le minimum
  let planned = between(rng, preset.ears);
  let extra = 2;
  while (planned > 0 || (extra > 0 && tiles().length < minTiles)) {
    if (planned > 0) planned--;
    else extra--;
    const missing = target - tiles().length;
    if (missing < MIN_EAR) break;
    const ideal = Math.max(MIN_EAR, Math.round(missing / (planned + 1)));
    if (!addEar(skeleton, rng, ideal, missing + 2)) break;
  }

  for (let cuts = between(rng, preset.cuts); cuts > 0; cuts--) {
    if (!cutCorner(skeleton, rng)) break;
  }
  for (let i = 0; i < bridges; i++) {
    const room = tiles().length - minTiles;
    if (room < 1) break;
    addBridge(skeleton, rng, Math.min(3, room));
  }
  for (let i = 0; i < shortcuts; i++) {
    if (!addShortcut(skeleton, rng)) break;
  }

  const count = tiles().length;
  if (count < minTiles || count > maxTiles) return null;

  // Recadrage : grille carrée, le plateau au milieu avec une cellule de marge
  const used = [];
  for (let cell = 0; cell < cells.length; cell++) if (cells[cell] !== EMPTY) used.push(cell);
  const rows = used.map(cell => Math.floor(cell / side));
  const cols = used.map(cell => cell % side);
  const top = Math.min(...rows);
  const left = Math.min(...cols);
  const height = Math.max(...rows) - top + 1;
  const width = Math.max(...cols) - left + 1;
  const size = Math.max(height, width) + 2;
  const rowShift = Math.floor((size - height) / 2) - top;
  const colShift = Math.floor((size - width) / 2) - left;

  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => ({})));
  for (const cell of used) {
    const kind = cells[cell];
    grid[Math.floor(cell / side) + rowShift][(cell % side) + colShift] = kind === TILE
      ? { type: 'command' }
      : { type: 'teleporter', direction: kind === LINK_H ? 'horizontal' : 'vertical' };
  }
  return grid;
}

// === 3. Habillage ===

// Donne son rôle à chaque case de la grille (modifiée sur place)
function dressBoard(grid, rng, preset, profile) {
  const { tiles } = parseBoardJSON(grid);
  const total = tiles.length;
  const neighbours = tiles.map(t => Object.values(t.adjacencies).filter(Boolean).map(exit => exit.tileId));
  const role = new Array(total).fill(null);
  const freeIds = () => tiles.map(t => t.id).filter(id => role[id] === null);
  const drawShare = (key) => profile[key].min + rng.next() * (profile[key].max - profile[key].min);

  // Case libre choisie parmi les plus éloignées des repères déjà posés
  const pickFar = (marks, keep) => {
    const dist = distancesTo(tiles, marks);
    const free = freeIds().filter(id => dist[id] > 0);
    const farthest = Math.max(...free.map(id => dist[id]));
    return rng.pick(free.filter(id => dist[id] >= farthest * keep));
  };

  // Départ : une case centrale, de préférence un carrefour
  let start = 0;
  let bestScore = -Infinity;
  for (const tile of tiles) {
    const reach = Math.max(...distancesTo(tiles, [tile.id]));
    const score = -reach + (neighbours[tile.id].length >= 3 ? 1.5 : 0) + rng.next() * 2;
    if (score > bestScore) {
      bestScore = score;
      start = tile.id;
    }
  }
  role[start] = { type: 'start' };
  tiles[start].type = TileType.START;

  // Checkpoints : chacun loin du Départ et des précédents, pour que le tour traverse le plateau.
  // Plusieurs tirages, plus ou moins écartés : on garde celui dont le tour complet a la longueur
  // la plus proche du milieu de la fourchette de référence.
  const lapGoal = total * (profile.lapShare.min + profile.lapShare.max) / 2;
  let marks = null;
  let bestMiss = Infinity;
  for (let draw = 0; draw < 6; draw++) {
    const picked = [start];
    const keep = 0.45 + rng.next() * 0.5;
    CHECKPOINT_COLORS.forEach((color) => {
      const id = pickFar(picked, keep);
      tiles[id].type = `checkpoint_${color}`;
      picked.push(id);
    });
    const miss = Math.abs(lapLength({ tiles, startTileId: start }) - lapGoal);
    for (const id of picked.slice(1)) tiles[id].type = TileType.NORMAL;
    if (miss < bestMiss) {
      bestMiss = miss;
      marks = picked;
    }
  }
  rng.shuffle(CHECKPOINT_COLORS).forEach((color, i) => {
    role[marks[i + 1]] = { type: 'checkpoint', color };
  });

  // Pistes de dégâts : des portions de couloir (cases à deux sorties), chacune avec son Prize Cube
  const blocked = new Set();
  const corridors = () => {
    const inCorridor = id => role[id] === null && neighbours[id].length === 2 && !blocked.has(id);
    const seen = new Set();
    const paths = [];
    for (const tile of tiles) {
      if (!inCorridor(tile.id) || seen.has(tile.id)) continue;
      const group = new Set([tile.id]);
      const stack = [tile.id];
      while (stack.length > 0) {
        for (const next of neighbours[stack.pop()]) {
          if (inCorridor(next) && !group.has(next)) {
            group.add(next);
            stack.push(next);
          }
        }
      }
      for (const id of group) seen.add(id);
      // Ranger les cases dans l'ordre du chemin, en partant d'un bout
      const inside = id => neighbours[id].filter(next => group.has(next));
      let current = [...group].find(id => inside(id).length <= 1);
      if (current === undefined) current = tile.id;
      const path = [current];
      const walked = new Set(path);
      for (;;) {
        const next = inside(current).find(id => !walked.has(id));
        if (next === undefined) break;
        path.push(next);
        walked.add(next);
        current = next;
      }
      paths.push(path);
    }
    return paths;
  };

  const trackRange = profile.trackLength;
  let damageLeft = Math.round(total * (profile.damageShare.min + (0.15 + rng.next() * 0.7) * (profile.damageShare.max - profile.damageShare.min)));
  for (let tracks = between(rng, preset.tracks); tracks > 0; tracks--) {
    const wanted = clamp(Math.round(damageLeft / tracks + (rng.next() - 0.5) * 2), trackRange.min, trackRange.max);
    const paths = corridors().filter(path => path.length >= trackRange.min);
    if (paths.length === 0) break;
    const fitting = paths.filter(path => path.length >= wanted);
    const path = fitting.length > 0 ? rng.pick(fitting) : paths.reduce((a, b) => (b.length > a.length ? b : a));
    const length = Math.min(wanted, path.length);
    // Une piste part de préférence d'un bout du couloir
    const slack = path.length - length;
    const offset = rng.chance(0.6) ? rng.pick([0, slack]) : rng.int(slack + 1);
    const track = path.slice(offset, offset + length);
    for (const id of track) role[id] = { type: 'damage', noBox: true };
    const cube = rng.chance(0.6) ? rng.pick([track[0], track[length - 1]]) : rng.pick(track);
    role[cube] = { type: 'damage', hasDice: true };
    // Deux pistes ne se touchent pas
    for (const id of [path[offset - 1], path[offset + length]]) if (id !== undefined) blocked.add(id);
    damageLeft -= length;
  }

  // Cases spéciales, réparties sur le plateau. On garde assez de cases commande pour rester
  // dans les proportions de référence.
  let spare = freeIds().length - Math.ceil(total * (profile.commandShare.min + 0.03));
  const place = (count, cell) => {
    for (let i = 0; i < count && spare > 0; i++, spare--) {
      const id = pickFar(marks, 0.6);
      role[id] = { ...cell };
      marks.push(id);
    }
  };
  place(clamp(Math.round(total * drawShare('eventShare')), 2, 4), { type: 'special' });
  place(total >= 50 && rng.chance(0.4) ? 2 : 1, { type: 'booster' });
  // Bonus : le plus souvent un ou deux, parfois un plateau qui en regorge
  place(Math.max(1, Math.round(total * (rng.chance(0.6) ? profile.bonusShare.min : drawShare('bonusShare')))), { type: 'bonus' });

  // Zones : des graines éloignées les unes des autres grossissent à tour de rôle, de proche en
  // proche, la plus petite d'abord. Une zone passe à travers les cases spéciales, pas à travers
  // les cases d'une autre zone.
  const command = freeIds();
  const isCommand = id => role[id] === null;
  const zoneCount = command.length < 9
    ? Math.max(1, Math.floor(command.length / 3))
    : clamp(Math.ceil(command.length / 5.5), 3, ZONE_IDS.length);
  const zoneOf = new Array(total).fill(-1);
  const seeds = [];
  for (let i = 0; i < zoneCount; i++) {
    const dist = distancesTo(tiles, seeds.length > 0 ? seeds : [start]);
    const free = command.filter(id => zoneOf[id] === -1);
    const farthest = Math.max(...free.map(id => dist[id]));
    const seed = rng.pick(free.filter(id => dist[id] >= farthest * 0.8));
    zoneOf[seed] = i;
    seeds.push(seed);
  }
  const queues = seeds.map(seed => [seed]);
  const heads = seeds.map(() => 0);
  const seen = seeds.map(seed => new Set([seed]));
  const sizes = seeds.map(() => 1);
  const growOne = (zone) => {
    const queue = queues[zone];
    while (heads[zone] < queue.length) {
      for (const next of neighbours[queue[heads[zone]]]) {
        if (seen[zone].has(next)) continue;
        seen[zone].add(next);
        if (!isCommand(next)) {
          queue.push(next);
        } else if (zoneOf[next] === -1) {
          zoneOf[next] = zone;
          sizes[zone]++;
          queue.push(next);
          return true;
        }
      }
      heads[zone]++;
    }
    return false;
  };
  const growing = new Set(seeds.map((_, zone) => zone));
  while (growing.size > 0) {
    const zone = [...growing].reduce((a, b) => (sizes[b] < sizes[a] ? b : a));
    if (!growOne(zone)) growing.delete(zone);
  }
  // Une zone d'une seule case rejoint la zone la plus proche
  for (const id of command) {
    if (sizes[zoneOf[id]] !== 1 || zoneCount === 1) continue;
    const dist = distancesTo(tiles, [id]);
    const others = command.filter(other => zoneOf[other] !== zoneOf[id]);
    const nearest = others.reduce((a, b) => (dist[b] < dist[a] ? b : a));
    sizes[zoneOf[id]]--;
    zoneOf[id] = zoneOf[nearest];
    sizes[zoneOf[id]]++;
  }

  // Écriture dans la grille ; les zones sont nommées A, B, C… dans l'ordre de lecture
  const letters = new Map();
  for (const tile of tiles) {
    if (role[tile.id]) {
      grid[tile.row][tile.col] = role[tile.id];
      continue;
    }
    if (!letters.has(zoneOf[tile.id])) letters.set(zoneOf[tile.id], ZONE_IDS[letters.size]);
    grid[tile.row][tile.col] = { type: 'command', zone: letters.get(zoneOf[tile.id]) };
  }
}

// === 4. Contrôle ===

// Parties d'essai entre IA sur un plateau -> { games, finished, turns } (turns : durée médiane)
export function playtestBoard(board, { games = 3, seed = 1, players = 3, goal = 7500, maxTurns = 300 } = {}) {
  const turns = [];
  let finished = 0;
  for (let i = 0; i < games; i++) {
    const game = new Game({
      boardEntry: board,
      players: Array.from({ length: players }, (_, p) => ({ name: `IA ${p + 1}`, isHuman: false })),
      gpGoal: goal,
      seed: seed + i,
    });
    game.journal.enabled = false;
    if (runHeadless(game, { maxTurns })) finished++;
    turns.push(game.turnNumber);
  }
  turns.sort((a, b) => a - b);
  return { games, finished, turns: turns[Math.floor(turns.length / 2)] };
}

// Génère un plateau.
//   seed       graine : la même graine redonne le même plateau
//   size       'small' | 'medium' | 'large' (voir BOARD_SIZES)
//   reference  plateaux servant de modèle ({ nom: entrée }), par défaut ceux d'origine
//   tries      nombre de plateaux valides comparés avant de garder le meilleur
//   playtest   nombre de parties d'essai entre IA que le plateau retenu doit mener à leur terme
// -> { board: { grid, zones }, seed, size, metrics, gap, playtest }
export function generateBoard({ seed = 1, size = 'medium', reference = null, tries = 6, playtest = 0 } = {}) {
  const preset = BOARD_SIZES[size];
  if (!preset) throw new Error(`Taille de plateau inconnue : ${size}`);
  // Le profil d'un même jeu de plateaux de référence n'est mesuré qu'une fois
  if (reference && !profiles.has(reference)) profiles.set(reference, referenceProfile(reference));
  const profile = (reference && profiles.get(reference)) || DEFAULT_PROFILE;
  const rng = createRng(seed);

  const candidates = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS && candidates.length < tries; attempt++) {
    const grid = buildLayout(rng, preset);
    if (!grid) continue;
    dressBoard(grid, rng, preset, profile);
    const board = { grid, zones: zoneDefsOf(grid) };
    const check = checkBoard(board);
    if (!check.ok || check.warnings.length > 0) continue;
    const metrics = measureBoard(board);
    const gap = styleGap(metrics, profile);
    candidates.push({ board, metrics, gap });
    if (gap === 0) break;
  }

  candidates.sort((a, b) => a.gap - b.gap);
  for (const candidate of candidates) {
    const trial = playtest > 0 ? playtestBoard(candidate.board, { games: playtest, seed }) : null;
    if (trial && trial.finished < trial.games) continue;
    return { ...candidate, seed, size, playtest: trial };
  }
  throw new Error(`Aucun plateau valide trouvé pour la graine ${seed}.`);
}
