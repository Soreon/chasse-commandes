// Rendu du plateau en grille sur Canvas

import { TILE_COLORS, TILE_SYMBOLS, TileType } from './board.js';

const PLAYER_RADIUS = 10;
const PLAYER_OFFSETS = [
  { dx: -12, dy: -12 },
  { dx: 12, dy: -12 },
  { dx: 0, dy: 12 },
];

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
    // Derniers parametres de rendu pour redessiner au resize
    this._lastRenderArgs = null;
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      if (this._lastRenderArgs) {
        this.render(...this._lastRenderArgs);
      }
    });
  }

  resize() {
    const container = this.canvas.parentElement;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
  }

  // Recalcule la taille et le centrage de la grille
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

  // Centre pixel d'une cellule de la grille (row, col)
  getCellCenter(row, col) {
    return {
      x: this.offsetX + col * this.cellSize + this.cellSize / 2,
      y: this.offsetY + row * this.cellSize + this.cellSize / 2,
    };
  }

  // Centre pixel d'une case (tile)
  getTileCenter(tile) {
    return this.getCellCenter(tile.row, tile.col);
  }

  // === Rendu principal ===
  render(boardData, players, currentPlayerId, animState) {
    this._lastRenderArgs = [boardData, players, currentPlayerId, animState];
    const { tiles, links, rows, cols } = boardData;
    const ctx = this.ctx;

    this.updateLayout(rows, cols);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. Liens (teleporteurs)
    this.drawLinks(links, tiles);

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

  // Dessiner les liens (ponts/teleporteurs)
  drawLinks(links, tiles) {
    const ctx = this.ctx;

    for (const link of links) {
      const fromTile = tiles[link.from];
      const toTile = tiles[link.to];
      const from = this.getTileCenter(fromTile);
      const to = this.getTileCenter(toTile);

      // Chemin en pointilles a travers les cellules intermediaires
      ctx.strokeStyle = '#00e0ff';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 5]);
      ctx.globalAlpha = 0.5;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      for (const [r, c] of link.cells) {
        const p = this.getCellCenter(r, c);
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Petits losanges sur les cellules de lien
      for (const [r, c] of link.cells) {
        const p = this.getCellCenter(r, c);
        const s = 5;
        ctx.fillStyle = '#00e0ff';
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x + s, p.y);
        ctx.lineTo(p.x, p.y + s);
        ctx.lineTo(p.x - s, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Fleches aux extremites du lien
      this.drawLinkArrow(from, link.cells[0], link.direction);
      this.drawLinkArrow(to, link.cells[link.cells.length - 1], link.direction);
    }
  }

  drawLinkArrow(tilePos, firstCell, direction) {
    const ctx = this.ctx;
    const cell = this.getCellCenter(firstCell[0], firstCell[1]);
    const midX = (tilePos.x + cell.x) / 2;
    const midY = (tilePos.y + cell.y) / 2;

    ctx.fillStyle = '#00e0ff';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    const s = 4;
    if (direction === 'vertical') {
      const dy = cell.y > tilePos.y ? 1 : -1;
      ctx.moveTo(midX - s, midY - s * dy);
      ctx.lineTo(midX + s, midY - s * dy);
      ctx.lineTo(midX, midY + s * dy);
    } else {
      const dx = cell.x > tilePos.x ? 1 : -1;
      ctx.moveTo(midX - s * dx, midY - s);
      ctx.lineTo(midX - s * dx, midY + s);
      ctx.lineTo(midX + s * dx, midY);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Dessiner une case
  drawTile(tile, players) {
    const ctx = this.ctx;
    const { x, y } = this.getTileCenter(tile);
    const half = this.tileSize / 2;
    const r = 5;

    const ownerPlayer = tile.owner !== null
      ? players.find(p => p.id === tile.owner)
      : null;
    const fillColor = TILE_COLORS[tile.type] || '#3a4060';

    // Rectangle arrondi
    ctx.beginPath();
    ctx.roundRect(x - half, y - half, this.tileSize, this.tileSize, r);

    if (tile.type === TileType.NORMAL && ownerPlayer) {
      // Case possedee
      ctx.fillStyle = ownerPlayer.color;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ownerPlayer.color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      // Case libre ou speciale
      ctx.fillStyle = fillColor;
      ctx.globalAlpha = tile.type === TileType.NORMAL ? 0.2 : 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Indicateur de case de (dice) sur les damage tracks
    if (tile.type === TileType.DAMAGE && tile.hasDice) {
      ctx.fillStyle = '#ffd700';
      ctx.font = `bold ${Math.max(14, this.tileSize * 0.4)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u2B22', x, y); // hexagone comme symbole de
      // Contour dore
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - half, y - half, this.tileSize, this.tileSize, r);
      ctx.stroke();
    } else {
      // Symbole normal
      const symbol = TILE_SYMBOLS[tile.type];
      if (symbol) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(12, this.tileSize * 0.32)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(symbol, x, y);
      }
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

    // Decaler si plusieurs joueurs sur la meme case
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
