// Plateau en grille avec liens (téléporteurs) : lecture de boards.json, déplacements,
// valeurs et péages. Module pur : aucun accès au DOM.

import { RULES } from './config.js';

export const TileType = {
  START: 'start',
  NORMAL: 'normal',
  CHECKPOINT_RED: 'checkpoint_red',
  CHECKPOINT_BLUE: 'checkpoint_blue',
  CHECKPOINT_YELLOW: 'checkpoint_yellow',
  CHECKPOINT_GREEN: 'checkpoint_green',
  BONUS: 'bonus',
  DAMAGE: 'damage',
  EVENT: 'event',
  BOOSTER: 'booster',
};

export const CHECKPOINT_COLORS = ['red', 'blue', 'yellow', 'green'];

// Libellés affichés dans l'interface (infobulles, choix de case, etc.)
export const TILE_TYPE_NAMES = {
  [TileType.START]: 'Départ',
  [TileType.NORMAL]: 'Commande',
  [TileType.CHECKPOINT_RED]: 'Checkpoint rouge',
  [TileType.CHECKPOINT_BLUE]: 'Checkpoint bleu',
  [TileType.CHECKPOINT_YELLOW]: 'Checkpoint jaune',
  [TileType.CHECKPOINT_GREEN]: 'Checkpoint vert',
  [TileType.BONUS]: 'Bonus',
  [TileType.DAMAGE]: 'Dégâts',
  [TileType.EVENT]: 'Événement',
  [TileType.BOOSTER]: 'GP Booster',
};

export const OPPOSITE_DIR = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const DIR_OFFSETS = {
  north: [-1, 0],
  south: [1, 0],
  east: [0, 1],
  west: [0, -1],
};

// === Lecture du JSON (boards.json ou plateau de l'éditeur) ===

function mapCellType(cell) {
  switch (cell.type) {
    case 'start': return TileType.START;
    case 'command': return TileType.NORMAL;
    case 'checkpoint':
      switch (cell.color) {
        case 'red': return TileType.CHECKPOINT_RED;
        case 'blue': return TileType.CHECKPOINT_BLUE;
        case 'yellow': return TileType.CHECKPOINT_YELLOW;
        case 'green': return TileType.CHECKPOINT_GREEN;
      }
      return TileType.NORMAL;
    case 'bonus': return TileType.BONUS;
    case 'damage': return TileType.DAMAGE;
    case 'special': return TileType.EVENT;
    case 'booster': return TileType.BOOSTER;
    default: return TileType.NORMAL;
  }
}

export function parseBoardJSON(boardEntry) {
  // Ancien format (tableau direct) et nouveau format ({ grid, zones })
  const gridData = boardEntry.grid || boardEntry;
  const zoneDefs = boardEntry.zones || [];

  const rows = gridData.length;
  const cols = Math.max(...gridData.map(row => row.length));

  const tiles = [];
  const posToId = {};
  let startTileId = 0;

  // 1. Cases (les cellules vides et les téléporteurs n'en sont pas)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < (gridData[r]?.length || 0); c++) {
      const cell = gridData[r][c];
      if (!cell || !cell.type || cell.type === 'teleporter') continue;

      const tileType = mapCellType(cell);
      const id = tiles.length;

      tiles.push({
        id,
        row: r,
        col: c,
        type: tileType,
        adjacencies: { north: null, south: null, east: null, west: null },
        owner: null,
        cardPlaced: null,
        presetCard: null,   // case Bonus : carte déjà posée, fixée en début de partie
        baseValue: RULES.baseTileCost,
        currentValue: 0,
        level: 0,
        tollValue: 0,
        zone: cell.zone || null,
        hasDice: cell.hasDice || false,
        noBox: cell.noBox || false,
      });

      if (tileType === TileType.START) startTileId = id;
      posToId[`${r},${c}`] = id;
    }
  }

  // 2. Zones déclarées à part (boards.json)
  for (const zone of zoneDefs) {
    if (!zone.tiles) continue;
    for (const [r, c] of zone.tiles) {
      const id = posToId[`${r},${c}`];
      if (id !== undefined) tiles[id].zone = zone.id;
    }
  }

  // 3. Voisins orthogonaux
  for (const tile of tiles) {
    for (const [dir, [dr, dc]] of Object.entries(DIR_OFFSETS)) {
      const key = `${tile.row + dr},${tile.col + dc}`;
      if (key in posToId) {
        tile.adjacencies[dir] = { tileId: posToId[key], isLink: false };
      }
    }
  }

  // 4. Liens : chaînes de téléporteurs entre deux cases
  const links = detectLinks(gridData, rows, cols, posToId, tiles);

  return { tiles, links, rows, cols, startTileId, posToId, zones: zoneDefs, _rawGrid: gridData };
}

function detectLinks(gridData, rows, cols, posToId, tiles) {
  const links = [];
  const visited = new Set();

  // Liens horizontaux
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = gridData[r]?.[c];
      if (!cell || cell.type !== 'teleporter' || cell.direction !== 'horizontal') continue;
      if (visited.has(`${r},${c}`)) continue;

      const chainCells = [];
      let cc = c;
      while (cc < cols) {
        const cur = gridData[r]?.[cc];
        if (!cur || cur.type !== 'teleporter' || cur.direction !== 'horizontal') break;
        chainCells.push([r, cc]);
        visited.add(`${r},${cc}`);
        cc++;
      }

      const fromId = posToId[`${r},${c - 1}`];
      const toId = posToId[`${r},${cc}`];

      if (fromId !== undefined && toId !== undefined) {
        tiles[fromId].adjacencies.east = { tileId: toId, isLink: true };
        tiles[toId].adjacencies.west = { tileId: fromId, isLink: true };
        links.push({ from: fromId, to: toId, cells: chainCells, direction: 'horizontal' });
      }
    }
  }

  // Liens verticaux
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cell = gridData[r]?.[c];
      if (!cell || cell.type !== 'teleporter' || cell.direction !== 'vertical') continue;
      if (visited.has(`${r},${c}`)) continue;

      const chainCells = [];
      let rr = r;
      while (rr < rows) {
        const cur = gridData[rr]?.[c];
        if (!cur || cur.type !== 'teleporter' || cur.direction !== 'vertical') break;
        chainCells.push([rr, c]);
        visited.add(`${rr},${c}`);
        rr++;
      }

      const fromId = posToId[`${r - 1},${c}`];
      const toId = posToId[`${rr},${c}`];

      if (fromId !== undefined && toId !== undefined) {
        tiles[fromId].adjacencies.south = { tileId: toId, isLink: true };
        tiles[toId].adjacencies.north = { tileId: fromId, isLink: true };
        links.push({ from: fromId, to: toId, cells: chainCells, direction: 'vertical' });
      }
    }
  }

  return links;
}

// === Déplacement ===

// Mouvements possibles depuis une case, demi-tour interdit (sauf cul-de-sac)
export function getAvailableMoves(tiles, tileId, lastDirection) {
  const tile = tiles[tileId];
  const blocked = lastDirection ? OPPOSITE_DIR[lastDirection] : null;
  const all = [];
  const allowed = [];

  for (const [dir, adj] of Object.entries(tile.adjacencies)) {
    if (!adj) continue;
    const move = { direction: dir, tileId: adj.tileId, isLink: adj.isLink };
    all.push(move);
    if (dir !== blocked) allowed.push(move);
  }

  return allowed.length > 0 ? allowed : all;
}

// Distance (en pas) de chaque case à la plus proche des cases cibles, demi-tours ignorés.
// Retourne un tableau indexé par id de case (Infinity si inatteignable).
export function distancesTo(tiles, targetIds) {
  const dist = new Array(tiles.length).fill(Infinity);
  const queue = [];
  for (const id of targetIds) {
    dist[id] = 0;
    queue.push(id);
  }
  for (let i = 0; i < queue.length; i++) {
    const tile = tiles[queue[i]];
    for (const adj of Object.values(tile.adjacencies)) {
      if (adj && dist[adj.tileId] === Infinity) {
        dist[adj.tileId] = dist[tile.id] + 1;
        queue.push(adj.tileId);
      }
    }
  }
  return dist;
}

const DIRECTION_INDEX = { north: 0, south: 1, east: 2, west: 3 };
const DIRECTIONS = ['north', 'south', 'east', 'west', null];

// Comme distancesTo, mais en respectant l'interdiction de demi-tour : la distance dépend de la
// direction par laquelle on est arrivé sur la case. Dans un cul-de-sac ou une boucle, on peut être
// tout près de sa cible à vol d'oiseau et très loin par le seul chemin permis.
// Retourne une fonction (tileId, dernièreDirection) -> nombre de pas (Infinity si inatteignable).
export function directedDistances(tiles, targetIds) {
  const stateOf = (tileId, dir) => tileId * 5 + (dir === null || dir === undefined ? 4 : DIRECTION_INDEX[dir]);
  const count = tiles.length * 5;
  const predecessors = Array.from({ length: count }, () => []);
  for (const tile of tiles) {
    for (const dir of DIRECTIONS) {
      const from = stateOf(tile.id, dir);
      for (const move of getAvailableMoves(tiles, tile.id, dir)) {
        predecessors[stateOf(move.tileId, move.direction)].push(from);
      }
    }
  }

  const dist = new Array(count).fill(Infinity);
  const queue = [];
  for (const id of targetIds) {
    for (const dir of DIRECTIONS) {
      const state = stateOf(id, dir);
      if (dist[state] !== 0) {
        dist[state] = 0;
        queue.push(state);
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    for (const prev of predecessors[queue[i]]) {
      if (dist[prev] === Infinity) {
        dist[prev] = dist[queue[i]] + 1;
        queue.push(prev);
      }
    }
  }
  return (tileId, lastDirection) => dist[stateOf(tileId, lastDirection)];
}

// === Zones ===

export function countOwnedInZone(tiles, zone, ownerId) {
  if (!zone) return 0;
  return tiles.filter(t => t.zone === zone && t.owner === ownerId).length;
}

export function countTilesInZone(tiles, zone) {
  if (!zone) return 0;
  return tiles.filter(t => t.zone === zone && t.type === TileType.NORMAL).length;
}

export function hasZoneMonopoly(tiles, zone, ownerId) {
  if (!zone) return false;
  const zoneTiles = tiles.filter(t => t.zone === zone && t.type === TileType.NORMAL);
  return zoneTiles.length > 0 && zoneTiles.every(t => t.owner === ownerId);
}

// === Valeur et péage ===

// Valeur propre d'une case à un niveau donné, hors bonus de zone
export function intrinsicValue(tile, level = tile.level) {
  const cardBonus = tile.cardPlaced ? tile.cardPlaced.value * RULES.cardValueGP : 0;
  return (tile.baseValue + cardBonus) * (RULES.levelMultipliers[level] || 0);
}

// Valeur = (base + carte) x niveau x bonus de chaîne x bonus d'exclusivité
export function calculateTileValue(tiles, tileId) {
  const tile = tiles[tileId];
  // `owner` vaut 0 pour le premier joueur : ne jamais le tester avec `!tile.owner`
  if (tile.owner === null || tile.level === 0) return 0;

  const ownedInZone = countOwnedInZone(tiles, tile.zone, tile.owner);
  const chainMult = 1 + Math.max(0, ownedInZone - 1) * RULES.chainBonusPerTile;
  const exclusivityMult = hasZoneMonopoly(tiles, tile.zone, tile.owner) ? RULES.exclusivityBonus : 1;

  return Math.floor(intrinsicValue(tile) * chainMult * exclusivityMult);
}

export function calculateToll(tiles, tileId) {
  const tile = tiles[tileId];
  if (tile.owner === null || tile.level === 0) return 0;
  return Math.floor(tile.currentValue * (RULES.tollRates[tile.level] || 0));
}

export function updateTileValue(tiles, tileId) {
  const tile = tiles[tileId];
  tile.currentValue = calculateTileValue(tiles, tileId);
  tile.tollValue = calculateToll(tiles, tileId);
}

export function updateAllTolls(tiles) {
  for (const tile of tiles) {
    if (tile.owner !== null) {
      updateTileValue(tiles, tile.id);
    } else {
      tile.currentValue = 0;
      tile.tollValue = 0;
    }
  }
}

// Prix d'achat d'une case libre en y posant `card`
export function getBuyCost(tile, card) {
  if (!RULES.buyCostIncludesCard || !card) return tile.baseValue;
  return tile.baseValue + card.value * RULES.cardValueGP;
}

export function getBuyoutCost(tile) {
  return tile.currentValue * RULES.buyoutMultiplier;
}

export function getUpgradeCost(tile) {
  const nextLevel = tile.level + 1;
  if (nextLevel > RULES.maxLevel) return Infinity;
  if (RULES.upgradeCostFollowsValue) {
    return Math.floor(intrinsicValue(tile, nextLevel) - intrinsicValue(tile, tile.level));
  }
  return Math.floor(tile.baseValue * RULES.upgradeCostMultipliers[nextLevel]);
}

export function isCheckpoint(type) {
  return type.startsWith('checkpoint_');
}

export function getCheckpointColor(type) {
  return isCheckpoint(type) ? type.slice('checkpoint_'.length) : null;
}
