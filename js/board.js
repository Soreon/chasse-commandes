// Definition du plateau et des types de cases

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

// Couleurs d'affichage par type de case
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

// Symboles pour les types de cases
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

// Prix de base pour acheter une case normale
export const BASE_TILE_COST = 100;

// Multiplicateur de peage (% de la valeur de la case)
export const TOLL_RATE = 0.2;

// Multiplicateur de rachat force
export const BUYOUT_MULTIPLIER = 5;

// Bonus par checkpoint traverse
export const CHECKPOINT_BONUS_GP = 50;

// Bonus de tour (lap) quand les 4 checkpoints sont actives
export const LAP_BONUS_GP = 500;

// Bonus en passant par la case depart
export const START_PASS_BONUS = 100;

// Bonus supplementaire en s'arretant sur la case depart
export const START_STOP_BONUS = 200;

// Bonus de synergy par case adjacente possedee
export const CHAIN_BONUS_RATE = 0.25; // +25% par case adjacente de meme proprietaire

// Cree un plateau "Keyblade Board"
export function createKeybladeBoard() {
  // Layout en forme de keyblade / circuit avec intersections
  // Coordonnees en % pour le rendu responsive
  const tiles = [
    // === Boucle principale ===
    { id: 0, type: TileType.START, x: 50, y: 85, connections: [1, 25] },
    { id: 1, type: TileType.NORMAL, x: 40, y: 80, connections: [0, 2] },
    { id: 2, type: TileType.NORMAL, x: 30, y: 75, connections: [1, 3] },
    { id: 3, type: TileType.CHECKPOINT_RED, x: 22, y: 68, connections: [2, 4] },
    { id: 4, type: TileType.NORMAL, x: 18, y: 58, connections: [3, 5] },
    { id: 5, type: TileType.BONUS, x: 15, y: 48, connections: [4, 6] },
    // Intersection gauche haute
    { id: 6, type: TileType.NORMAL, x: 18, y: 38, connections: [5, 7, 18] },
    { id: 7, type: TileType.NORMAL, x: 22, y: 28, connections: [6, 8] },
    { id: 8, type: TileType.CHECKPOINT_BLUE, x: 28, y: 20, connections: [7, 9] },
    { id: 9, type: TileType.NORMAL, x: 36, y: 15, connections: [8, 10] },
    { id: 10, type: TileType.DAMAGE, x: 44, y: 12, connections: [9, 11] },
    // Sommet - intersection
    { id: 11, type: TileType.NORMAL, x: 50, y: 10, connections: [10, 12, 20] },
    { id: 12, type: TileType.NORMAL, x: 56, y: 12, connections: [11, 13] },
    { id: 13, type: TileType.JOKER, x: 64, y: 15, connections: [12, 14] },
    { id: 14, type: TileType.CHECKPOINT_YELLOW, x: 72, y: 20, connections: [13, 15] },
    { id: 15, type: TileType.NORMAL, x: 78, y: 28, connections: [14, 16] },
    // Intersection droite haute
    { id: 16, type: TileType.NORMAL, x: 82, y: 38, connections: [15, 17, 22] },
    { id: 17, type: TileType.NORMAL, x: 85, y: 48, connections: [16, 26] },

    // === Branche interieure gauche (depuis intersection 6) ===
    { id: 18, type: TileType.NORMAL, x: 30, y: 40, connections: [6, 19] },
    { id: 19, type: TileType.EVENT, x: 40, y: 42, connections: [18, 20] },

    // === Branche interieure centre (rejoint intersection 11) ===
    { id: 20, type: TileType.NORMAL, x: 50, y: 35, connections: [11, 19, 21] },
    { id: 21, type: TileType.NORMAL, x: 60, y: 42, connections: [20, 22] },

    // === Branche interieure droite (depuis intersection 16) ===
    { id: 22, type: TileType.BONUS, x: 70, y: 40, connections: [16, 21] },

    // === Retour cote droit ===
    // { id: 17 deja defini, continue vers: }
    { id: 23, type: TileType.CHECKPOINT_GREEN, x: 82, y: 58, connections: [26, 24] },
    { id: 24, type: TileType.NORMAL, x: 78, y: 68, connections: [23, 25] },
    { id: 25, type: TileType.DAMAGE, x: 70, y: 75, connections: [24, 27] },

    // Connexion du 17 au checkpoint vert via case intermediaire
    { id: 26, type: TileType.NORMAL, x: 85, y: 53, connections: [17, 23] },

    // Retour vers depart
    { id: 27, type: TileType.NORMAL, x: 60, y: 80, connections: [25, 0] },
  ];

  // Initialiser les proprietes de jeu pour chaque case
  return tiles.map(tile => ({
    ...tile,
    owner: null,         // ID du joueur proprietaire
    cardPlaced: null,    // Carte placee sur la case
    baseValue: BASE_TILE_COST,
    currentValue: 0,     // Valeur actuelle (baseValue + cardValue + upgrades)
    level: 0,            // Niveau d'amelioration (0 = non achete)
    tollValue: 0,        // Peage actuel
  }));
}

// Calcule le peage d'une case en tenant compte des chaines
export function calculateToll(board, tileId) {
  const tile = board[tileId];
  if (!tile.owner || tile.level === 0) return 0;

  let baseToll = Math.floor(tile.currentValue * TOLL_RATE);

  // Bonus de chaine : compter les cases adjacentes du meme proprietaire
  let chainCount = 0;
  for (const connId of tile.connections) {
    if (board[connId].owner === tile.owner) {
      chainCount++;
    }
  }
  const chainMultiplier = 1 + chainCount * CHAIN_BONUS_RATE;
  return Math.floor(baseToll * chainMultiplier);
}

// Met a jour la valeur et le peage d'une case
export function updateTileValue(board, tileId) {
  const tile = board[tileId];
  if (tile.level === 0) {
    tile.currentValue = 0;
    tile.tollValue = 0;
    return;
  }
  const cardValue = tile.cardPlaced ? tile.cardPlaced.value * 50 : 0;
  const upgradeValue = (tile.level - 1) * 100;
  tile.currentValue = tile.baseValue + cardValue + upgradeValue;
  tile.tollValue = calculateToll(board, tileId);
}

// Met a jour tous les peages (utile apres un achat qui change les chaines)
export function updateAllTolls(board) {
  for (let i = 0; i < board.length; i++) {
    if (board[i].owner !== null) {
      updateTileValue(board, i);
    }
  }
}

// Calcule le cout de rachat force
export function getBuyoutCost(tile) {
  return tile.currentValue * BUYOUT_MULTIPLIER;
}

// Calcule le cout d'amelioration d'une case
export function getUpgradeCost(tile) {
  return 100 + tile.level * 50;
}

// Verifie si une case est un checkpoint
export function isCheckpoint(type) {
  return type.startsWith('checkpoint_');
}

// Obtient la couleur du checkpoint
export function getCheckpointColor(type) {
  if (type === TileType.CHECKPOINT_RED) return 'red';
  if (type === TileType.CHECKPOINT_BLUE) return 'blue';
  if (type === TileType.CHECKPOINT_YELLOW) return 'yellow';
  if (type === TileType.CHECKPOINT_GREEN) return 'green';
  return null;
}
