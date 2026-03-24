// Systeme de plateau en grille avec liens (teleporteurs)

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
};

// Caractere -> type de case
const TILE_CHARS = {
  'S': TileType.START,
  'N': TileType.NORMAL,
  'R': TileType.CHECKPOINT_RED,
  'B': TileType.CHECKPOINT_BLUE,
  'Y': TileType.CHECKPOINT_YELLOW,
  'G': TileType.CHECKPOINT_GREEN,
  '+': TileType.BONUS,
  '!': TileType.DAMAGE,
  '?': TileType.JOKER,
  'E': TileType.EVENT,
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

// === Layout du Keyblade Board ===
// Grille 9 lignes x 11 colonnes
// Chaque caractere est une cellule. '.' = vide, lettres = types de cases
const KEYBLADE_LAYOUT = [
  '. . N N ? N N N N . .',
  '. . N . . . . . N . .',
  'N B N N N . N N N R N',
  'N . N . . . . . N . N',
  '! . N . . . . . N . +',
  'N . N . . . . . N . N',
  'N G N N N E N N N Y N',
  '. . N . . . . . N . .',
  '. . N ? N S N N N . .',
];

// Liens (ponts/teleporteurs) entre cases non adjacentes
// from/to = [row, col], cells = cellules intermediaires (pour le rendu)
const KEYBLADE_LINKS = [
  // Lien vertical gauche : traverse le centre du haut vers le bas
  { from: [2, 4], to: [6, 4], cells: [[3, 4], [4, 4], [5, 4]], direction: 'vertical' },
  // Lien vertical droit
  { from: [2, 6], to: [6, 6], cells: [[3, 6], [4, 6], [5, 6]], direction: 'vertical' },
  // Lien horizontal central
  { from: [4, 2], to: [4, 8], cells: [[4, 3], [4, 4], [4, 5], [4, 6], [4, 7]], direction: 'horizontal' },
];

// === Création du plateau ===

export function createKeybladeBoard() {
  return createBoardFromLayout(KEYBLADE_LAYOUT, KEYBLADE_LINKS);
}

function createBoardFromLayout(layoutLines, linkDefs) {
  const grid = layoutLines.map(line => line.split(' '));
  const rows = grid.length;
  const cols = grid[0].length;

  const tiles = [];
  const posToId = {}; // "row,col" -> tileId
  let startTileId = 0;

  // Creer les cases
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      const tileType = TILE_CHARS[ch];
      if (!tileType) continue;

      const id = tiles.length;
      tiles.push({
        id,
        row: r,
        col: c,
        type: tileType,
        // Adjacences dans les 4 directions : { tileId, isLink } ou null
        adjacencies: { north: null, south: null, east: null, west: null },
        // Proprietes de jeu
        owner: null,
        cardPlaced: null,
        baseValue: BASE_TILE_COST,
        currentValue: 0,
        level: 0,
        tollValue: 0,
      });

      if (tileType === TileType.START) startTileId = id;
      posToId[`${r},${c}`] = id;
    }
  }

  // Calculer les adjacences orthogonales (cases directement voisines)
  for (const tile of tiles) {
    for (const [dir, [dr, dc]] of Object.entries(DIR_OFFSETS)) {
      const key = `${tile.row + dr},${tile.col + dc}`;
      if (key in posToId) {
        tile.adjacencies[dir] = { tileId: posToId[key], isLink: false };
      }
    }
  }

  // Ajouter les liens (teleporteurs entre cases non adjacentes)
  const links = [];
  for (const def of linkDefs) {
    const fromId = posToId[`${def.from[0]},${def.from[1]}`];
    const toId = posToId[`${def.to[0]},${def.to[1]}`];
    if (fromId === undefined || toId === undefined) continue;

    // Determiner la direction d'entree dans le lien
    let fromDir;
    if (def.direction === 'vertical') {
      fromDir = def.from[0] < def.to[0] ? 'south' : 'north';
    } else {
      fromDir = def.from[1] < def.to[1] ? 'east' : 'west';
    }
    const toDir = OPPOSITE_DIR[fromDir];

    // Connecter les deux extremites
    tiles[fromId].adjacencies[fromDir] = { tileId: toId, isLink: true };
    tiles[toId].adjacencies[toDir] = { tileId: fromId, isLink: true };

    links.push({
      from: fromId,
      to: toId,
      cells: def.cells,
      direction: def.direction,
    });
  }

  return { tiles, links, rows, cols, startTileId, posToId };
}

// === Mouvement ===

// Retourne les deplacements possibles depuis une case, en respectant le non-demi-tour
export function getAvailableMoves(tiles, tileId, lastDirection) {
  const tile = tiles[tileId];
  const blocked = lastDirection ? OPPOSITE_DIR[lastDirection] : null;
  const moves = [];

  for (const [dir, adj] of Object.entries(tile.adjacencies)) {
    if (adj && dir !== blocked) {
      moves.push({ direction: dir, tileId: adj.tileId, isLink: adj.isLink });
    }
  }

  // Fallback si aucun mouvement (ne devrait pas arriver sur un bon plateau)
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

  // Bonus de chaine : cases adjacentes (non-lien) du meme proprietaire
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
