// Rendu du plateau en grille sur Canvas

import { TileType } from './board.js';

const PLAYER_RADIUS = 10;
const PLAYER_OFFSETS = [
  { dx: -12, dy: -12 },
  { dx: 12, dy: -12 },
  { dx: 0, dy: 12 },
];

// Mapping type de case -> image
const TILE_IMAGE_PATHS = {
  [TileType.START]: 'images/startPanel.png',
  [TileType.NORMAL]: 'images/commandPanel.png',
  [TileType.CHECKPOINT_RED]: 'images/redCheckpoint.png',
  [TileType.CHECKPOINT_BLUE]: 'images/blueCheckpoint.png',
  [TileType.CHECKPOINT_YELLOW]: 'images/yellowCheckpoint.png',
  [TileType.CHECKPOINT_GREEN]: 'images/greenCheckpoint.png',
  [TileType.BONUS]: 'images/bonusPanel.png',
  [TileType.DAMAGE]: 'images/damagePanel.png',
  [TileType.EVENT]: 'images/specialPanel.png',
  [TileType.BOOSTER]: 'images/gpBoosterPanel.png',
};

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cellSize = 0;
    this.tileSize = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.boardRows = 0;
    this.boardCols = 0;
    this._lastRenderArgs = null;

    // Images precharges
    this.tileImages = {};
    this.diceImage = null;
    this.teleporterImages = { horizontal: null, vertical: null };
    this.imagesLoaded = false;

    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      if (this._lastRenderArgs) {
        this.render(...this._lastRenderArgs);
      }
    });
  }

  async loadImages() {
    const entries = Object.entries(TILE_IMAGE_PATHS);
    const results = await Promise.all(entries.map(([, src]) => loadImage(src)));
    for (let i = 0; i < entries.length; i++) {
      this.tileImages[entries[i][0]] = results[i];
    }

    const [dice, hTele, vTele] = await Promise.all([
      loadImage('images/dice.png'),
      loadImage('images/horizontalTeleporter.png'),
      loadImage('images/verticalTeleporter.png'),
    ]);
    this.diceImage = dice;
    this.teleporterImages.horizontal = hTele;
    this.teleporterImages.vertical = vTele;
    this.imagesLoaded = true;

    // Re-render si des donnees sont deja en attente
    if (this._lastRenderArgs) {
      this.render(...this._lastRenderArgs);
    }
  }

  resize() {
    const container = this.canvas.parentElement;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
  }

  updateLayout(rows, cols) {
    this.boardRows = rows;
    this.boardCols = cols;
    const padX = 80;
    const padY = 40;
    this.cellSize = Math.min(
      (this.canvas.width - padX * 2) / cols,
      (this.canvas.height - padY * 2) / rows
    );
    this.tileSize = this.cellSize * 0.78;
    this.offsetX = (this.canvas.width - cols * this.cellSize) / 2;
    this.offsetY = (this.canvas.height - rows * this.cellSize) / 2;
  }

  getCellCenter(row, col) {
    return {
      x: this.offsetX + col * this.cellSize + this.cellSize / 2,
      y: this.offsetY + row * this.cellSize + this.cellSize / 2,
    };
  }

  getTileCenter(tile) {
    return this.getCellCenter(tile.row, tile.col);
  }

  // === Rendu principal ===
  render(boardData, players, currentPlayerId, animState) {
    this._lastRenderArgs = [boardData, players, currentPlayerId, animState];
    if (!this.imagesLoaded) return;

    const { tiles, links, rows, cols } = boardData;
    const ctx = this.ctx;

    this.updateLayout(rows, cols);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Pixel art : pas de lissage
    ctx.imageSmoothingEnabled = false;

    // 1. Liens (teleporteurs)
    this.drawLinks(links);

    // 2. Cases
    for (const tile of tiles) {
      this.drawTile(tile, players);
    }

    // 3. Joueurs (sauf celui en animation)
    for (const player of players) {
      if (animState?.active && animState.playerId === player.id) continue;
      this.drawPlayer(player, tiles, players, currentPlayerId);
    }

    // 4. Animation de deplacement
    if (animState?.active) {
      this.drawMovingPlayer(animState, tiles);
    }
  }

  // Dessiner les teleporteurs (images uniquement, avec depassement)
  drawLinks(links) {
    const ctx = this.ctx;
    const gap = this.cellSize - this.tileSize;

    for (const link of links) {
      const teleImg = this.teleporterImages[link.direction];
      if (!teleImg) continue;

      const cellSet = new Set(link.cells.map(([r, c]) => `${r},${c}`));
      const isHorizontal = link.direction === 'horizontal';

      for (let i = 0; i < link.cells.length; i++) {
        const [r, c] = link.cells[i];
        const p = this.getCellCenter(r, c);

        // Calcul du ratio de base (axe long = tileSize, axe court proportionnel)
        const scale = this.tileSize / (isHorizontal ? teleImg.naturalWidth : teleImg.naturalHeight);
        let w = teleImg.naturalWidth * scale;
        let h = teleImg.naturalHeight * scale;

        // Depassements sur l'axe du lien
        let extBefore = 0;
        let extAfter = 0;

        if (isHorizontal) {
          const hasLeft = cellSet.has(`${r},${c - 1}`);
          const hasRight = cellSet.has(`${r},${c + 1}`);
          extBefore = hasLeft ? gap / 2 : gap;
          extAfter = hasRight ? gap / 2 : gap;
          w += extBefore + extAfter;
          ctx.drawImage(teleImg, p.x - w / 2 + (extAfter - extBefore) / 2, p.y - h / 2, w, h);
        } else {
          const hasUp = cellSet.has(`${r - 1},${c}`);
          const hasDown = cellSet.has(`${r + 1},${c}`);
          extBefore = hasUp ? gap / 2 : gap;
          extAfter = hasDown ? gap / 2 : gap;
          h += extBefore + extAfter;
          ctx.drawImage(teleImg, p.x - w / 2, p.y - h / 2 + (extAfter - extBefore) / 2, w, h);
        }
      }
    }
  }

  // Dessiner une case
  drawTile(tile, players) {
    const ctx = this.ctx;
    const { x, y } = this.getTileCenter(tile);
    const half = this.tileSize / 2;

    const ownerPlayer = tile.owner !== null
      ? players.find(p => p.id === tile.owner)
      : null;

    // Fond blanc pour les cases commande
    if (tile.type === TileType.NORMAL) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - half, y - half, this.tileSize, this.tileSize);
    }

    // Image de la case
    const img = this.tileImages[tile.type];
    if (img) {
      ctx.drawImage(img, x - half, y - half, this.tileSize, this.tileSize);
    }

    // Surcouche pour case possedee
    if (tile.type === TileType.NORMAL && ownerPlayer) {
      const r = 5;
      ctx.beginPath();
      ctx.roundRect(x - half, y - half, this.tileSize, this.tileSize, r);
      ctx.fillStyle = ownerPlayer.color;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ownerPlayer.color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Dice recouvre la case damage
    if (tile.type === TileType.DAMAGE && tile.hasDice && this.diceImage) {
      ctx.drawImage(this.diceImage, x - half, y - half, this.tileSize, this.tileSize);
    }

    // Niveau et peage pour les cases possedees
    if (tile.owner !== null && tile.level > 0) {
      const fontSize = Math.max(8, this.tileSize * 0.2);
      ctx.fillStyle = '#ffd700';
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`Lv${tile.level}`, x, y + half + fontSize + 2);

      ctx.fillStyle = '#aaa';
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillText(`${tile.tollValue}G`, x, y - half - 4);
    }
  }

  // Dessiner un joueur sur sa case
  drawPlayer(player, tiles, players, currentPlayerId) {
    const ctx = this.ctx;
    const tile = tiles[player.position];
    const { x, y } = this.getTileCenter(tile);

    const playersHere = players.filter(p => p.position === player.position);
    const idx = playersHere.indexOf(player);
    const offset = playersHere.length > 1
      ? (PLAYER_OFFSETS[idx] || { dx: 0, dy: 0 })
      : { dx: 0, dy: 0 };

    const px = x + offset.dx;
    const py = y + offset.dy;

    // Halo pour le joueur actif
    if (player.id === currentPlayerId) {
      ctx.beginPath();
      ctx.arc(px, py, PLAYER_RADIUS + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Cercle du joueur
    ctx.beginPath();
    ctx.arc(px, py, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Initiale
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.name[0], px, py);

    // Indicateurs d'etat
    if (player.stunned) {
      ctx.fillStyle = '#ff0';
      ctx.font = '12px sans-serif';
      ctx.fillText('*', px + PLAYER_RADIUS, py - PLAYER_RADIUS);
    }
    if (player.hasJustice) {
      ctx.fillStyle = '#0f0';
      ctx.font = '10px sans-serif';
      ctx.fillText('J', px - PLAYER_RADIUS - 6, py);
    }
    if (player.hasDark) {
      ctx.fillStyle = '#f00';
      ctx.font = '10px sans-serif';
      ctx.fillText('D', px - PLAYER_RADIUS - 6, py);
    }
  }

  // Animation de deplacement
  drawMovingPlayer(animState, tiles) {
    const ctx = this.ctx;
    const { fromTileId, toTileId, progress, color, name } = animState;
    const from = this.getTileCenter(tiles[fromTileId]);
    const to = this.getTileCenter(tiles[toTileId]);

    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;

    ctx.beginPath();
    ctx.arc(x, y, PLAYER_RADIUS + 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name[0], x, y);
  }
}
