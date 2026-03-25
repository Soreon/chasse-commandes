// Systeme de plateau en grille avec liens (teleporteurs)
// Supporte le chargement depuis boards.json

export const TileType = {
  START: 'start',
  NORMAL: 'normal',
  CHECKPOINT_RED: 'checkpoint_red',
  CHECKPOINT_BLUE: 'checkpoint_blue',
  CHECKPOINT_YELLOW: 'checkpoint_yellow',
  CHECKPOINT_GREEN: 'checkpoint_green',
  BONUS: 'bonus',
  DAMAGE: 'damage',
  JOKER: 'joker',
  EVENT: 'event',
  BOOSTER: 'booster',
};

export const TILE_COLORS = {
  [TileType.START]: '#ffd700',
  [TileType.NORMAL]: '#3a4060',
  [TileType.CHECKPOINT_RED]: '#ff4a4a',
  [TileType.CHECKPOINT_BLUE]: '#4a9eff',
  [TileType.CHECKPOINT_YELLOW]: '#ffd700',
  [TileType.CHECKPOINT_GREEN]: '#4aff7a',
  [TileType.BONUS]: '#a040ff',
  [TileType.DAMAGE]: '#ff2020',
  [TileType.JOKER]: '#ff8c00',
  [TileType.EVENT]: '#00c8ff',
  [TileType.BOOSTER]: '#00ff90',
};

export const TILE_SYMBOLS = {
  [TileType.START]: 'S',
  [TileType.NORMAL]: '',
  [TileType.CHECKPOINT_RED]: 'R',
  [TileType.CHECKPOINT_BLUE]: 'B',
  [TileType.CHECKPOINT_YELLOW]: 'J',
  [TileType.CHECKPOINT_GREEN]: 'V',
  [TileType.BONUS]: '+',
  [TileType.DAMAGE]: '!',
  [TileType.JOKER]: '?',
  [TileType.EVENT]: 'E',
  [TileType.BOOSTER]: 'X',
};

// Directions et oppositions
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

// === Constantes de jeu ===
export const BASE_TILE_COST = 100;
export const TOLL_RATE = 0.2;
export const BUYOUT_MULTIPLIER = 5;
export const CHECKPOINT_BONUS_GP = 50;
export const LAP_BONUS_GP = 500;
export const START_PASS_BONUS = 100;
export const START_STOP_BONUS = 200;
export const CHAIN_BONUS_RATE = 0.25;

// === Mapping des types JSON -> TileType ===

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

// === Création du plateau depuis le JSON (boards.json) ===

export function parseBoardJSON(gridData) {
  const rows = gridData.length;
  const cols = Math.max(...gridData.map(row => row.length));

  const tiles = [];
  const posToId = {};
  let startTileId = 0;

  // Phase 1 : creer les cases (ignorer les cellules vides et les teleporters)
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
        baseValue: BASE_TILE_COST,
        currentValue: 0,
        level: 0,
        tollValue: 0,
        // Metadonnees du JSON
        hasDice: cell.hasDice || false,
        noBox: cell.noBox || false,
      });

      if (tileType === TileType.START) startTileId = id;
      posToId[`${r},${c}`] = id;
    }
  }

  // Phase 2 : calculer les adjacences orthogonales
  for (const tile of tiles) {
    for (const [dir, [dr, dc]] of Object.entries(DIR_OFFSETS)) {
      const key = `${tile.row + dr},${tile.col + dc}`;
      if (key in posToId) {
        tile.adjacencies[dir] = { tileId: posToId[key], isLink: false };
      }
    }
  }

  // Phase 3 : detecter et ajouter les liens depuis les chaines de teleporters
  const links = detectLinks(gridData, rows, cols, posToId, tiles);

  return { tiles, links, rows, cols, startTileId, posToId };
}

// === Detection automatique des liens ===

function detectLinks(gridData, rows, cols, posToId, tiles) {
  const links = [];
  const visited = new Set();

  // Liens horizontaux
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = gridData[r]?.[c];
      if (!cell || cell.type !== 'teleporter' || cell.direction !== 'horizontal') continue;
      if (visited.has(`${r},${c}`)) continue;

      // Trouver toute la chaine horizontale
      const chainCells = [];
      let cc = c;
      while (cc < cols) {
        const cur = gridData[r]?.[cc];
        if (!cur || cur.type !== 'teleporter' || cur.direction !== 'horizontal') break;
        chainCells.push([r, cc]);
        visited.add(`${r},${cc}`);
        cc++;
      }

      // Trouver les cases aux extremites
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

// === Mouvement ===

export function getAvailableMoves(tiles, tileId, lastDirection) {
  const tile = tiles[tileId];
  const blocked = lastDirection ? OPPOSITE_DIR[lastDirection] : null;
  const moves = [];

  for (const [dir, adj] of Object.entries(tile.adjacencies)) {
    if (adj && dir !== blocked) {
      moves.push({ direction: dir, tileId: adj.tileId, isLink: adj.isLink });
    }
  }

  // Fallback si aucun mouvement
  if (moves.length === 0) {
    for (const [dir, adj] of Object.entries(tile.adjacencies)) {
      if (adj) {
        moves.push({ direction: dir, tileId: adj.tileId, isLink: adj.isLink });
      }
    }
  }

  return moves;
}

// === Peage et valeur ===

export function calculateToll(tiles, tileId) {
  const tile = tiles[tileId];
  if (!tile.owner || tile.level === 0) return 0;

  let baseToll = Math.floor(tile.currentValue * TOLL_RATE);

  let chainCount = 0;
  for (const adj of Object.values(tile.adjacencies)) {
    if (adj && !adj.isLink && tiles[adj.tileId].owner === tile.owner) {
      chainCount++;
    }
  }

  return Math.floor(baseToll * (1 + chainCount * CHAIN_BONUS_RATE));
}

export function updateTileValue(tiles, tileId) {
  const tile = tiles[tileId];
  if (tile.level === 0) {
    tile.currentValue = 0;
    tile.tollValue = 0;
    return;
  }
  const cardValue = tile.cardPlaced ? tile.cardPlaced.value * 50 : 0;
  const upgradeValue = (tile.level - 1) * 100;
  tile.currentValue = tile.baseValue + cardValue + upgradeValue;
  tile.tollValue = calculateToll(tiles, tileId);
}

export function updateAllTolls(tiles) {
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i].owner !== null) {
      updateTileValue(tiles, i);
    }
  }
}

export function getBuyoutCost(tile) {
  return tile.currentValue * BUYOUT_MULTIPLIER;
}

export function getUpgradeCost(tile) {
  return 100 + tile.level * 50;
}

export function isCheckpoint(type) {
  return type.startsWith('checkpoint_');
}

export function getCheckpointColor(type) {
  if (type === TileType.CHECKPOINT_RED) return 'red';
  if (type === TileType.CHECKPOINT_BLUE) return 'blue';
  if (type === TileType.CHECKPOINT_YELLOW) return 'yellow';
  if (type === TileType.CHECKPOINT_GREEN) return 'green';
  return null;
}
