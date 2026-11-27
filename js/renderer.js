// Minimap 2D du plateau, dessinée sur un canvas.

import { TileType } from './engine/board.js';

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

// 16 cadres colorés : le cadre indique la zone, le centre le propriétaire
const COLORED_PANEL_COUNT = 16;

// Indices de cadres espacés pour bien distinguer les zones
export function getZonePanelIndices(zoneCount) {
  if (zoneCount <= 0) return [];
  const step = COLORED_PANEL_COUNT / zoneCount;
  return Array.from({ length: zoneCount }, (_, i) => Math.floor(1 + i * step));
}

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

    this.tileImages = {};
    this.diceImage = null;
    this.teleporterImages = { horizontal: null, vertical: null };
    this.coloredPanels = {};
    this.imagesLoaded = false;
    this.zonePanelMap = {};

    this._last = null;          // dernier appel à render(), rejoué au redimensionnement
    this.pickableTiles = null;  // Set des cases cliquables pendant un choix de case

    // Branchés par l'interface
    this.onTileHover = null;    // (tileId | null, clientX, clientY)
    this.onTileClick = null;    // (tileId)

    // Tous les écouteurs partent avec dispose()
    this._listeners = new AbortController();
    const signal = this._listeners.signal;

    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this._redraw();
    }, { signal });

    const tileUnder = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      return this.getTileAtPixel(mx, my);
    };
    canvas.addEventListener('mousemove', (e) => {
      if (this.onTileHover) this.onTileHover(tileUnder(e), e.clientX, e.clientY);
    }, { signal });
    canvas.addEventListener('mouseleave', (e) => {
      if (this.onTileHover) this.onTileHover(null, e.clientX, e.clientY);
    }, { signal });
    canvas.addEventListener('click', (e) => {
      const tileId = tileUnder(e);
      if (tileId !== null && this.onTileClick) this.onTileClick(tileId);
    }, { signal });
  }

  dispose() {
    this._listeners.abort();
    this._last = null;
  }

  getTileAtPixel(px, py) {
    const tiles = this._last?.game.tiles;
    if (!tiles) return null;
    const half = this.cellSize / 2;
    for (const tile of tiles) {
      const { x, y } = this.getTileCenter(tile);
      if (px >= x - half && px <= x + half && py >= y - half && py <= y + half) return tile.id;
    }
    return null;
  }

  // Cases à mettre en évidence pendant un choix (null pour arrêter)
  setPickable(tileIds) {
    this.pickableTiles = tileIds ? new Set(tileIds) : null;
    this._redraw();
  }

  async loadImages() {
    const entries = Object.entries(TILE_IMAGE_PATHS);
    const results = await Promise.all(entries.map(([, src]) => loadImage(src)));
    entries.forEach(([type], i) => { this.tileImages[type] = results[i]; });

    const [dice, hTele, vTele] = await Promise.all([
      loadImage('images/dice.png'),
      loadImage('images/horizontalTeleporter.png'),
      loadImage('images/verticalTeleporter.png'),
    ]);
    this.diceImage = dice;
    this.teleporterImages.horizontal = hTele;
    this.teleporterImages.vertical = vTele;

    const panels = await Promise.all(
      Array.from({ length: COLORED_PANEL_COUNT }, (_, i) => loadImage(`images/coloredCommandPanel/${i + 1}.png`)),
    );
    panels.forEach((img, i) => { this.coloredPanels[i + 1] = img; });

    this.imagesLoaded = true;
    this._redraw();
  }

  getZonePanelImage(tile) {
    const panelIndex = tile.zone ? this.zonePanelMap[tile.zone] : null;
    return (panelIndex && this.coloredPanels[panelIndex]) || this.tileImages[TileType.NORMAL];
  }

  resize() {
    const container = this.canvas.parentElement;
    // Dessin à 3× la taille affichée, pour rester net
    const scale = 3;
    this.canvas.width = container.clientWidth * scale;
    this.canvas.height = container.clientHeight * scale;
  }

  updateLayout(rows, cols) {
    const pad = 10;
    this.cellSize = Math.min(
      (this.canvas.width - pad * 2) / cols,
      (this.canvas.height - pad * 2) / rows,
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

  _redraw() {
    if (this._last) this.render(this._last.game, this._last.anim);
  }

  // anim (facultatif) : { playerId, from, to, progress, withCube } pour un pion en déplacement
  render(game, anim = null) {
    this._last = { game, anim };
    if (!this.imagesLoaded || this.canvas.width === 0) return;

    const { tiles, links, rows, cols, zones } = game.boardData;
    const ctx = this.ctx;

    if (zones && zones.length > 0 && Object.keys(this.zonePanelMap).length === 0) {
      const indices = getZonePanelIndices(zones.length);
      zones.forEach((zone, i) => { this.zonePanelMap[zone.id] = indices[i]; });
    }

    this.updateLayout(rows, cols);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false; // pixel art

    this.drawLinks(links);
    for (const tile of tiles) this.drawTile(tile, game);

    if (this.pickableTiles) {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = Math.max(2, this.tileSize * 0.12);
      for (const tileId of this.pickableTiles) {
        const { x, y } = this.getTileCenter(tiles[tileId]);
        ctx.strokeRect(x - this.tileSize / 2, y - this.tileSize / 2, this.tileSize, this.tileSize);
      }
    }

    // Pots de miel
    for (const pot of game.honeyPots) {
      const p = this.getTileCenter(tiles[pot.tileId]);
      ctx.font = `${Math.max(10, this.tileSize * 0.6)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🍯', p.x, p.y);
    }

    const currentId = game.over ? null : game.currentPlayer.id;
    for (const player of game.players) {
      if (player.eliminated) continue;
      if (anim && anim.playerId === player.id) continue;
      this.drawPlayer(player, game, currentId);
    }
    if (anim) this.drawMovingPlayer(anim, game);
  }

  drawLinks(links) {
    const ctx = this.ctx;
    const gap = this.cellSize - this.tileSize;

    for (const link of links) {
      const teleImg = this.teleporterImages[link.direction];
      if (!teleImg) continue;

      const cellSet = new Set(link.cells.map(([r, c]) => `${r},${c}`));
      const isHorizontal = link.direction === 'horizontal';

      for (const [r, c] of link.cells) {
        const p = this.getCellCenter(r, c);
        const scale = this.tileSize / (isHorizontal ? teleImg.naturalWidth : teleImg.naturalHeight);
        let w = teleImg.naturalWidth * scale;
        let h = teleImg.naturalHeight * scale;

        // Le lien déborde jusqu'aux cases voisines
        if (isHorizontal) {
          const before = cellSet.has(`${r},${c - 1}`) ? gap / 2 : gap;
          const after = cellSet.has(`${r},${c + 1}`) ? gap / 2 : gap;
          w += before + after;
          ctx.drawImage(teleImg, p.x - w / 2 + (after - before) / 2, p.y - h / 2, w, h);
        } else {
          const before = cellSet.has(`${r - 1},${c}`) ? gap / 2 : gap;
          const after = cellSet.has(`${r + 1},${c}`) ? gap / 2 : gap;
          h += before + after;
          ctx.drawImage(teleImg, p.x - w / 2, p.y - h / 2 + (after - before) / 2, w, h);
        }
      }
    }
  }

  drawTile(tile, game) {
    const ctx = this.ctx;
    const { x, y } = this.getTileCenter(tile);
    const half = this.tileSize / 2;

    if (tile.type === TileType.NORMAL) {
      // Fond : blanc si libre, couleur du propriétaire sinon ; le cadre de zone vient par-dessus
      ctx.fillStyle = tile.owner !== null ? game.players[tile.owner].color : '#ffffff';
      ctx.fillRect(x - half, y - half, this.tileSize, this.tileSize);
      const panelImg = this.getZonePanelImage(tile);
      if (panelImg) ctx.drawImage(panelImg, x - half, y - half, this.tileSize, this.tileSize);
    } else {
      const img = this.tileImages[tile.type];
      if (img) ctx.drawImage(img, x - half, y - half, this.tileSize, this.tileSize);
      // Case Bonus achetée : pastille à la couleur du propriétaire
      if (tile.owner !== null) {
        const size = this.tileSize * 0.44;
        ctx.fillStyle = game.players[tile.owner].color;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, this.tileSize * 0.05);
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
      }
    }

    if (game.freeCubeAt(tile.id)) this.drawDiceAt(x, y);
  }

  drawDiceAt(x, y) {
    if (!this.diceImage) return;
    const half = this.tileSize / 2;
    this.ctx.drawImage(this.diceImage, x - half, y - half, this.tileSize, this.tileSize);
  }

  _playerRadius() {
    return Math.max(6, this.tileSize * 0.3);
  }

  _drawToken(x, y, player, highlighted) {
    const ctx = this.ctx;
    const radius = this._playerRadius();

    if (highlighted) {
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.4, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = Math.max(2, radius * 0.25);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, radius * 0.15);
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(radius * 1.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.name[0] || '?', x, y);
  }

  drawPlayer(player, game, currentId) {
    const tile = game.tiles[player.position];
    const { x, y } = this.getTileCenter(tile);
    const radius = this._playerRadius();

    // Décalage quand plusieurs pions partagent la case
    const here = game.players.filter(p => !p.eliminated && p.position === player.position);
    let dx = 0;
    let dy = 0;
    if (here.length > 1) {
      const angle = (here.indexOf(player) / here.length) * Math.PI * 2 - Math.PI / 2;
      dx = Math.cos(angle) * radius * 0.9;
      dy = Math.sin(angle) * radius * 0.9;
    }

    if (game.cubeOf(player.id)) this.drawDiceAt(x, y);
    this._drawToken(x + dx, y + dy, player, player.id === currentId);
  }

  drawMovingPlayer(anim, game) {
    const from = this.getTileCenter(game.tiles[anim.from]);
    const to = this.getTileCenter(game.tiles[anim.to]);
    const x = from.x + (to.x - from.x) * anim.progress;
    const y = from.y + (to.y - from.y) * anim.progress;

    if (anim.withCube) this.drawDiceAt(x, y);
    this._drawToken(x, y, game.players[anim.playerId], true);
  }
}
