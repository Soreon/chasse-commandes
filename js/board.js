// Systeme de plateau en grille avec liens (teleporteurs)
// Supporte le chargement depuis boards.json (format { grid, zones })

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
export const BUYOUT_MULTIPLIER = 5;
export const CHECKPOINT_BONUS_GP = 300;
export const LAP_BONUS_GP = 500;
export const START_PASS_BONUS = 100;
export const START_STOP_BONUS = 200;

// Taux de peage par niveau (40% LV1 -> 60% LV5)
export const TOLL_RATES = [0, 0.40, 0.45, 0.50, 0.55, 0.60];

// Multiplicateur de valeur par niveau
export const LEVEL_MULTIPLIERS = [0, 1.0, 1.5, 2.5, 4.0, 6.0];

// Cout d'upgrade relatif au cout de base (LV2 -> LV5)
export const UPGRADE_COST_MULTIPLIERS = [0, 0, 0.5, 1.5, 2.0, 3.0];

// Bonus de chaine par case possedee dans la meme zone (en %)
export const CHAIN_BONUS_PER_TILE = 0.15;

// Bonus d'exclusivite quand on possede TOUTE une zone
export const EXCLUSIVITY_BONUS = 1.5;

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

export function parseBoardJSON(boardEntry) {
  // Support ancien format (tableau direct) et nouveau format ({ grid, zones })
  const gridData = boardEntry.grid || boardEntry;
  const zoneDefs = boardEntry.zones || [];

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
        zone: cell.zone || null,
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

  return { tiles, links, rows, cols, startTileId, posToId, zones: zoneDefs };
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

// === Zones : calculs de bonus ===

// Compte les cases possedees par un joueur dans la meme zone
export function countOwnedInZone(tiles, zone, ownerId) {
  if (!zone) return 0;
  return tiles.filter(t => t.zone === zone && t.owner === ownerId).length;
}

// Compte le nombre total de cases dans une zone
export function countTilesInZone(tiles, zone) {
  if (!zone) return 0;
  return tiles.filter(t => t.zone === zone && t.type === TileType.NORMAL).length;
}

// Verifie si un joueur possede toute une zone (monopole)
export function hasZoneMonopoly(tiles, zone, ownerId) {
  if (!zone) return false;
  const zoneTiles = tiles.filter(t => t.zone === zone && t.type === TileType.NORMAL);
  return zoneTiles.length > 0 && zoneTiles.every(t => t.owner === ownerId);
}

// === Peage et valeur (formules fideles au Command Board) ===

// Valeur d'une case = base x multiplicateur_niveau x bonus_chaine x bonus_exclusivite
export function calculateTileValue(tiles, tileId) {
  const tile = tiles[tileId];
  if (!tile.owner || tile.level === 0) return 0;

  const cardBonus = tile.cardPlaced ? tile.cardPlaced.value * 50 : 0;
  const base = tile.baseValue + cardBonus;

  // Multiplicateur de niveau
  const levelMult = LEVEL_MULTIPLIERS[tile.level] || 1;

  // Bonus de chaine (cases de la meme zone possedees par le meme joueur)
  const ownedInZone = countOwnedInZone(tiles, tile.zone, tile.owner);
  const chainMult = 1 + Math.max(0, ownedInZone - 1) * CHAIN_BONUS_PER_TILE;

  // Bonus d'exclusivite (monopole complet de la zone)
  const exclusivityMult = hasZoneMonopoly(tiles, tile.zone, tile.owner) ? EXCLUSIVITY_BONUS : 1;

  return Math.floor(base * levelMult * chainMult * exclusivityMult);
}

// Peage = valeur x taux_de_peage[niveau]
export function calculateToll(tiles, tileId) {
  const tile = tiles[tileId];
  if (!tile.owner || tile.level === 0) return 0;

  const value = tile.currentValue;
  const tollRate = TOLL_RATES[tile.level] || 0;

  return Math.floor(value * tollRate);
}

export function updateTileValue(tiles, tileId) {
  const tile = tiles[tileId];
  tile.currentValue = calculateTileValue(tiles, tileId);
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

// Cout d'upgrade relatif au cout de base de la case
export function getUpgradeCost(tile) {
  const nextLevel = tile.level + 1;
  if (nextLevel > 5) return Infinity;
  return Math.floor(tile.baseValue * UPGRADE_COST_MULTIPLIERS[nextLevel]);
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
