// Vérification et mesure d'un plateau (grille de l'éditeur ou entrée de boards.json).
// Sert au bouton « Valider » de l'éditeur et au générateur de plateaux. Module pur.

import {
  parseBoardJSON, TileType, CHECKPOINT_COLORS, getAvailableMoves, distancesTo, isCheckpoint, getCheckpointColor,
} from './engine/board.js';

const COLOR_NAMES = { red: 'rouge', blue: 'bleu', yellow: 'jaune', green: 'vert' };
const DIRECTIONS = ['north', 'south', 'east', 'west'];

const exitsOf = tile => Object.values(tile.adjacencies).filter(Boolean);
const at = tile => `(${tile.row}, ${tile.col})`;

// Nombre de pas du plus court tour complet : partir du Départ, passer par les quatre checkpoints
// et revenir au Départ, sans demi-tour (règle de déplacement du jeu). Infinity s'il n'existe pas.
export function lapLength(board) {
  const { tiles, startTileId } = board;
  if (tiles.length === 0 || tiles[startTileId].type !== TileType.START) return Infinity;

  const stamp = tiles.map(t => (isCheckpoint(t.type) ? 1 << CHECKPOINT_COLORS.indexOf(getCheckpointColor(t.type)) : 0));
  const ALL = (1 << CHECKPOINT_COLORS.length) - 1;
  // État : case, direction d'arrivée (4 = aucune) et checkpoints déjà validés
  const stateOf = (id, dir, mask) => (id * 5 + dir) * (ALL + 1) + mask;
  const dist = new Int32Array(tiles.length * 5 * (ALL + 1)).fill(-1);
  const queue = [[startTileId, 4, 0]];
  dist[stateOf(startTileId, 4, 0)] = 0;

  for (let i = 0; i < queue.length; i++) {
    const [id, dir, mask] = queue[i];
    const steps = dist[stateOf(id, dir, mask)] + 1;
    for (const move of getAvailableMoves(tiles, id, dir === 4 ? null : DIRECTIONS[dir])) {
      const nextMask = mask | stamp[move.tileId];
      if (move.tileId === startTileId && nextMask === ALL) return steps;
      const next = stateOf(move.tileId, DIRECTIONS.indexOf(move.direction), nextMask);
      if (dist[next] === -1) {
        dist[next] = steps;
        queue.push([move.tileId, DIRECTIONS.indexOf(move.direction), nextMask]);
      }
    }
  }
  return Infinity;
}

// Groupes de cases reliées entre elles parmi celles que `keep` retient -> [[id, ...], ...]
function groupsOf(tiles, keep) {
  const seen = new Set();
  const groups = [];
  for (const tile of tiles) {
    if (!keep(tile) || seen.has(tile.id)) continue;
    const group = [];
    const stack = [tile.id];
    seen.add(tile.id);
    while (stack.length > 0) {
      const id = stack.pop();
      group.push(id);
      for (const exit of exitsOf(tiles[id])) {
        if (keep(tiles[exit.tileId]) && !seen.has(exit.tileId)) {
          seen.add(exit.tileId);
          stack.push(exit.tileId);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

// Plateau jouable ? -> { ok, errors, warnings }. Une erreur empêche de jouer correctement,
// un avertissement signale un plateau jouable mais bancal. Les messages sont affichés tels quels.
export function checkBoard(entry) {
  const grid = entry.grid || entry;
  const errors = [];
  const warnings = [];
  const board = parseBoardJSON(entry);
  const { tiles, links } = board;

  if (tiles.length === 0) {
    return { ok: false, errors: ['Le plateau est vide.'], warnings };
  }

  const starts = tiles.filter(t => t.type === TileType.START);
  if (starts.length === 0) errors.push('Il manque la case Départ.');
  if (starts.length > 1) errors.push(`Il y a ${starts.length} cases Départ (une seule attendue).`);

  for (const color of CHECKPOINT_COLORS) {
    const count = tiles.filter(t => t.type === `checkpoint_${color}`).length;
    if (count === 0) errors.push(`Il manque le checkpoint ${COLOR_NAMES[color]}.`);
    if (count > 1) errors.push(`Il y a ${count} checkpoints ${COLOR_NAMES[color]}s (un seul attendu).`);
  }

  if (!tiles.some(t => t.type === TileType.NORMAL)) errors.push('Il n\'y a aucune case commande à acheter.');

  // Téléporteurs qui ne forment pas une ligne droite entre deux cases
  const linked = new Set(links.flatMap(link => link.cells.map(([r, c]) => `${r},${c}`)));
  grid.forEach((row, r) => row.forEach((cell, c) => {
    if (cell && cell.type === 'teleporter' && !linked.has(`${r},${c}`)) {
      errors.push(`Téléporteur en (${r}, ${c}) qui ne relie pas deux cases.`);
    }
  }));

  for (const tile of tiles) {
    const exits = exitsOf(tile).length;
    if (exits === 0) errors.push(`Case isolée en ${at(tile)}.`);
    else if (exits === 1) errors.push(`Cul-de-sac en ${at(tile)} : la case n'a qu'une sortie.`);

    if (tile.type === TileType.DAMAGE && tile.hasDice
      && !exitsOf(tile).some(exit => tiles[exit.tileId].type === TileType.DAMAGE)) {
      errors.push(`Prize Cube en ${at(tile)} sans case de dégâts voisine.`);
    }
  }

  if (starts.length === 1) {
    const fromStart = distancesTo(tiles, [starts[0].id]);
    const lost = tiles.filter(t => fromStart[t.id] === Infinity);
    if (lost.length > 0) {
      errors.push(`${lost.length} case(s) ne sont pas reliées au Départ (par exemple ${at(lost[0])}).`);
    } else if (errors.length === 0 && lapLength(board) === Infinity) {
      errors.push('Impossible de faire un tour complet (les quatre checkpoints puis le Départ).');
    }
  }

  const unzoned = tiles.filter(t => t.type === TileType.NORMAL && !t.zone).length;
  if (unzoned > 0) warnings.push(`${unzoned} case(s) commande sans zone : elles ne donnent aucun bonus de zone.`);
  const zoneSizes = {};
  for (const tile of tiles) {
    if (tile.type === TileType.NORMAL && tile.zone) zoneSizes[tile.zone] = (zoneSizes[tile.zone] || 0) + 1;
  }
  for (const [zone, size] of Object.entries(zoneSizes)) {
    if (size === 1) warnings.push(`La zone ${zone} n'a qu'une case : son premier acheteur en a aussitôt l'exclusivité.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// Mesures de structure d'un plateau, pour le comparer aux plateaux de référence
export function measureBoard(entry) {
  const board = parseBoardJSON(entry);
  const { tiles, links } = board;
  const total = tiles.length;
  const count = keep => tiles.filter(keep).length;

  const command = count(t => t.type === TileType.NORMAL);
  const damage = count(t => t.type === TileType.DAMAGE);
  const bonus = count(t => t.type === TileType.BONUS);
  const events = count(t => t.type === TileType.EVENT);
  const boosters = count(t => t.type === TileType.BOOSTER);
  const junctions = count(t => exitsOf(t).length >= 3);
  const edges = tiles.reduce((sum, t) => sum + exitsOf(t).length, 0) / 2;
  const parts = groupsOf(tiles, () => true).length;

  // Pistes de dégâts (cases de dégâts qui se touchent) et couloirs (cases sans choix de direction)
  const tracks = groupsOf(tiles, t => t.type === TileType.DAMAGE).map(g => g.length).sort((a, b) => a - b);
  const corridor = Math.max(0, ...groupsOf(tiles, t => exitsOf(t).length <= 2).map(g => g.length));

  const zoneSizes = {};
  for (const tile of tiles) {
    if (tile.type === TileType.NORMAL && tile.zone) zoneSizes[tile.zone] = (zoneSizes[tile.zone] || 0) + 1;
  }
  const zones = Object.values(zoneSizes).sort((a, b) => a - b);

  const lap = lapLength(board);
  const share = value => (total > 0 ? value / total : 0);

  return {
    tiles: total,
    command, damage, bonus, events, boosters,
    cubes: count(t => t.type === TileType.DAMAGE && t.hasDice),
    junctions,
    loops: edges - total + parts,
    links: links.length,
    tracks,
    zones,
    lap,
    corridor,
    commandShare: share(command),
    damageShare: share(damage),
    bonusShare: share(bonus),
    eventShare: share(events),
    junctionShare: share(junctions),
    corridorShare: share(corridor),
    lapShare: share(lap),
  };
}

// Proportions comparées à celles des plateaux de référence
export const STYLE_METRICS = ['commandShare', 'damageShare', 'bonusShare', 'eventShare', 'junctionShare', 'corridorShare', 'lapShare'];

// Plateaux de référence -> pour chaque proportion, l'intervalle { min, max } qu'ils couvrent
export function referenceProfile(boards) {
  const measures = Object.values(boards || {})
    .filter(entry => checkBoard(entry).ok)
    .map(measureBoard);
  if (measures.length === 0) return null;

  const profile = { boards: measures.length };
  for (const key of STYLE_METRICS) {
    const values = measures.map(m => m[key]);
    profile[key] = { min: Math.min(...values), max: Math.max(...values) };
  }
  const tracks = measures.flatMap(m => m.tracks);
  profile.trackLength = { min: Math.min(...tracks), max: Math.max(...tracks) };
  return profile;
}

// Écart de style : 0 si toutes les proportions du plateau tombent dans les intervalles de
// référence ; sinon la somme des dépassements, comptés en largeurs d'intervalle.
export function styleGap(metrics, profile) {
  let gap = 0;
  for (const key of STYLE_METRICS) {
    const { min, max } = profile[key];
    const width = Math.max(max - min, 0.01);
    const value = metrics[key];
    if (value < min) gap += (min - value) / width;
    else if (value > max) gap += (value - max) / width;
  }
  return gap;
}

// Dessin du plateau en caractères (une ligne par rangée), pour les outils en ligne de commande
export function boardToText(entry) {
  const grid = entry.grid || entry;
  const symbol = (cell) => {
    if (!cell || !cell.type) return '.';
    switch (cell.type) {
      case 'start': return 'S';
      case 'command': return cell.zone ? cell.zone.toLowerCase() : 'c';
      case 'checkpoint': return { red: 'R', blue: 'B', yellow: 'Y', green: 'G' }[cell.color] || '!';
      case 'bonus': return '+';
      case 'damage': return cell.hasDice ? 'D' : 'x';
      case 'special': return '?';
      case 'booster': return '$';
      case 'teleporter': return cell.direction === 'horizontal' ? '-' : '|';
      default: return '!';
    }
  };
  return grid.map(row => row.map(symbol).join('')).join('\n');
}
