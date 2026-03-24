// Rendu du plateau sur Canvas

import { TILE_COLORS, TILE_SYMBOLS, TileType } from './board.js';

const TILE_RADIUS = 22;
const PLAYER_RADIUS = 8;
const PLAYER_OFFSETS = [
  { dx: -10, dy: -10 },
  { dx: 10, dy: -10 },
  { dx: 0, dy: 10 },
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const container = this.canvas.parentElement;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    // Marges pour ne pas coller aux bords
    this.marginX = 60;
    this.marginY = 30;
  }

  // Convertit les coordonnees % en pixels
  toPixel(xPct, yPct) {
    return {
      px: this.marginX + (xPct / 100) * (this.width - 2 * this.marginX),
      py: this.marginY + (yPct / 100) * (this.height - 2 * this.marginY),
    };
  }

  // Rendu complet
  render(board, players, currentPlayerId, animState) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Dessiner les connexions
    this.drawConnections(board);

    // Dessiner les cases
    for (const tile of board) {
      this.drawTile(tile, players);
    }

    // Dessiner les joueurs
    for (const player of players) {
      this.drawPlayer(player, board, players, currentPlayerId);
    }

    // Animation de deplacement
    if (animState && animState.active) {
      this.drawMovingPlayer(animState, board);
    }
  }

  drawConnections(board) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#2a3050';
    ctx.lineWidth = 2;

    const drawn = new Set();
    for (const tile of board) {
      for (const connId of tile.connections) {
        const key = [Math.min(tile.id, connId), Math.max(tile.id, connId)].join('-');
        if (drawn.has(key)) continue;
        drawn.add(key);

        const from = this.toPixel(tile.x, tile.y);
        const conn = board[connId];
        const to = this.toPixel(conn.x, conn.y);

        ctx.beginPath();
        ctx.moveTo(from.px, from.py);
        ctx.lineTo(to.px, to.py);
        ctx.stroke();
      }
    }
  }

  drawTile(tile, players) {
    const ctx = this.ctx;
    const { px, py } = this.toPixel(tile.x, tile.y);
    const r = TILE_RADIUS;

    // Fond de la case
    let fillColor = TILE_COLORS[tile.type] || '#3a4060';

    // Si la case a un proprietaire, bordure de sa couleur
    const ownerPlayer = tile.owner !== null ? players.find(p => p.id === tile.owner) : null;

    // Case hexagonale simplifiee (cercle)
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);

    if (tile.type === TileType.NORMAL && tile.owner !== null) {
      ctx.fillStyle = ownerPlayer ? ownerPlayer.color : fillColor;
      ctx.globalAlpha = 0.4;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ownerPlayer ? ownerPlayer.color : '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = tile.type === TileType.NORMAL ? 0.3 : 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Symbole de la case
    const symbol = TILE_SYMBOLS[tile.type];
    if (symbol) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbol, px, py);
    }

    // Niveau / valeur si possedee
    if (tile.owner !== null && tile.level > 0) {
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Lv${tile.level}`, px, py + r + 10);

      ctx.fillStyle = '#ccc';
      ctx.font = '9px sans-serif';
      ctx.fillText(`${tile.tollValue}G`, px, py - r - 6);
    }
  }

  drawPlayer(player, board, players, currentPlayerId) {
    const ctx = this.ctx;
    const tile = board[player.position];
    const { px, py } = this.toPixel(tile.x, tile.y);

    // Decaler si plusieurs joueurs sur la meme case
    const playersHere = players.filter(p => p.position === player.position);
    const idx = playersHere.indexOf(player);
    const offset = playersHere.length > 1 ? PLAYER_OFFSETS[idx] || { dx: 0, dy: 0 } : { dx: 0, dy: 0 };

    const ppx = px + offset.dx;
    const ppy = py + offset.dy;

    // Halo pour le joueur actif
    if (player.id === currentPlayerId) {
      ctx.beginPath();
      ctx.arc(ppx, ppy, PLAYER_RADIUS + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Pion du joueur
    ctx.beginPath();
    ctx.arc(ppx, ppy, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Initiale
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.name[0], ppx, ppy);

    // Indicateurs d'etat
    if (player.stunned) {
      ctx.fillStyle = '#ff0';
      ctx.font = '12px sans-serif';
      ctx.fillText('*', ppx + PLAYER_RADIUS, ppy - PLAYER_RADIUS);
    }
    if (player.hasJustice) {
      ctx.fillStyle = '#0f0';
      ctx.font = '10px sans-serif';
      ctx.fillText('J', ppx - PLAYER_RADIUS - 4, ppy);
    }
    if (player.hasDark) {
      ctx.fillStyle = '#f00';
      ctx.font = '10px sans-serif';
      ctx.fillText('D', ppx - PLAYER_RADIUS - 4, ppy);
    }
  }

  drawMovingPlayer(animState, board) {
    const ctx = this.ctx;
    const { fromTile, toTile, progress, color, name } = animState;
    const from = this.toPixel(board[fromTile].x, board[fromTile].y);
    const to = this.toPixel(board[toTile].x, board[toTile].y);

    const x = from.px + (to.px - from.px) * progress;
    const y = from.py + (to.py - from.py) * progress;

    ctx.beginPath();
    ctx.arc(x, y, PLAYER_RADIUS + 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name[0], x, y);
  }

  // Obtenir la case sous le curseur (pour debug/interaction)
  getTileAtPoint(board, mx, my) {
    for (const tile of board) {
      const { px, py } = this.toPixel(tile.x, tile.y);
      const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
      if (dist <= TILE_RADIUS) return tile;
    }
    return null;
  }
}
