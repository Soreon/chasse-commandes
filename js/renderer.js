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

// 16 images de command panels colores (cadre = zone, centre blanc = proprietaire)
const COLORED_PANEL_COUNT = 16;

// Espacement des indices pour maximiser le contraste visuel entre zones adjacentes
// Pour N zones, on pioche des indices espaces dans 1..16
function getZonePanelIndices(zoneCount) {
  if (zoneCount <= 0) return [];
  const step = COLORED_PANEL_COUNT / zoneCount;
  const indices = [];
  for (let i = 0; i < zoneCount; i++) {
    indices.push(Math.floor(1 + i * step));
  }
  return indices;
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
    this.boardRows = 0;
    this.boardCols = 0;
    this._lastRenderArgs = null;

    // Images prechargees
    this.tileImages = {};
    this.diceImage = null;
    this.teleporterImages = { horizontal: null, vertical: null };
    this.coloredPanels = {}; // { "1": Image, "2": Image, ... }
    this.imagesLoaded = false;

    // Mapping zone -> indice de panel colore
    this.zonePanelMap = {}; // { "A": 1, "B": 5, ... }

    // Tooltip HTML
    this.tooltipEl = document.getElementById('tile-tooltip');
    this.hoveredTileId = null;

    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      if (this._lastRenderArgs) {
        this.render(...this._lastRenderArgs);
      }
    });

    // Tracking souris pour tooltip
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      this.hoveredTileId = this.getTileAtPixel(mx, my);
      this.updateTooltip(e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', () => {
      this.hoveredTileId = null;
      this.hideTooltip();
    });
  }

  // Trouve l'ID de la case sous un pixel du canvas
  getTileAtPixel(px, py) {
    if (!this._lastRenderArgs) return null;
    const tiles = this._lastRenderArgs[0]?.tiles;
    if (!tiles) return null;
    const half = this.tileSize / 2;
    for (const tile of tiles) {
      const { x, y } = this.getTileCenter(tile);
      if (px >= x - half && px <= x + half && py >= y - half && py <= y + half) {
        return tile.id;
      }
    }
    return null;
  }

  hideTooltip() {
    if (this.tooltipEl) this.tooltipEl.classList.add('hidden');
  }

  updateTooltip(mouseX, mouseY) {
    if (this.hoveredTileId === null || !this._lastRenderArgs) {
      this.hideTooltip();
      return;
    }

    const [boardData, players, , , prizeCubes] = this._lastRenderArgs;
    const tile = boardData.tiles[this.hoveredTileId];
    if (!tile) { this.hideTooltip(); return; }

    const lines = [];

    // Nom du type de case
    const typeNames = {
      start: 'Depart', normal: 'Commande', bonus: 'Bonus',
      damage: 'Degats', event: 'Special', booster: 'GP Booster',
      checkpoint_red: 'Checkpoint Rouge', checkpoint_blue: 'Checkpoint Bleu',
      checkpoint_yellow: 'Checkpoint Jaune', checkpoint_green: 'Checkpoint Vert',
    };
    lines.push(`<div class="tt-title">${typeNames[tile.type] || tile.type} #${tile.id}</div>`);

    // Zone
    if (tile.zone) {
      const zoneDef = boardData.zones?.find(z => z.id === tile.zone);
      lines.push(`<div class="tt-zone">Zone : ${zoneDef?.name || tile.zone}</div>`);
    }

    // Proprietaire et stats
    if (tile.owner !== null && tile.level > 0) {
      const owner = players.find(p => p.id === tile.owner);
      lines.push(`<div class="tt-owner">Proprio : <span style="color:${owner?.color}">${owner?.name}</span></div>`);
      lines.push(`<div class="tt-level">Niveau ${tile.level} — Valeur : ${tile.currentValue} GP</div>`);
      lines.push(`<div class="tt-toll">Peage : ${tile.tollValue} GP</div>`);
    } else if (tile.type === 'normal' && tile.owner === null) {
      lines.push(`<div class="tt-value">Libre — Cout : ${tile.baseValue} GP</div>`);
    }

    // Prize Cube
    const cube = prizeCubes?.find(c => c.tileId === tile.id && c.riderId === null);
    if (cube) {
      lines.push(`<div class="tt-cube">Prize Cube : ${cube.counter} pas — ${cube.accumulatedGP} GP</div>`);
    }

    // Rien d'interessant a afficher pour les cases basiques sans info
    if (lines.length <= 1 && !cube) {
      this.hideTooltip();
      return;
    }

    this.tooltipEl.innerHTML = lines.join('');
    this.tooltipEl.classList.remove('hidden');

    // Positionner la tooltip pres de la souris
    const offset = 14;
    let tx = mouseX + offset;
    let ty = mouseY + offset;

    // Eviter de sortir de l'ecran
    const tw = this.tooltipEl.offsetWidth;
    const th = this.tooltipEl.offsetHeight;
    if (tx + tw > window.innerWidth - 8) tx = mouseX - tw - offset;
    if (ty + th > window.innerHeight - 8) ty = mouseY - th - offset;

    this.tooltipEl.style.left = tx + 'px';
    this.tooltipEl.style.top = ty + 'px';
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

    // Charger les 16 panels colores
    const panelPromises = [];
    for (let i = 1; i <= COLORED_PANEL_COUNT; i++) {
      panelPromises.push(loadImage(`images/coloredCommandPanel/${i}.png`));
    }
    const panelResults = await Promise.all(panelPromises);
    for (let i = 0; i < panelResults.length; i++) {
      this.coloredPanels[i + 1] = panelResults[i];
    }

    this.imagesLoaded = true;

    // Re-render si des donnees sont deja en attente
    if (this._lastRenderArgs) {
      this.render(...this._lastRenderArgs);
    }
  }

  // Configure le mapping zone -> panel colore pour le plateau courant
  setupZonePanelMap(zones) {
    this.zonePanelMap = {};
    if (!zones || zones.length === 0) return;

    const indices = getZonePanelIndices(zones.length);
    for (let i = 0; i < zones.length; i++) {
      this.zonePanelMap[zones[i].id] = indices[i];
    }
  }

  // Obtenir l'image du panel colore pour une case (selon sa zone)
  getZonePanelImage(tile) {
    const panelIndex = tile.zone ? this.zonePanelMap[tile.zone] : null;
    if (panelIndex && this.coloredPanels[panelIndex]) {
      return this.coloredPanels[panelIndex];
    }
    return this.tileImages[TileType.NORMAL];
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
  render(boardData, players, currentPlayerId, animState, prizeCubes, honeyPots) {
    this._lastRenderArgs = [boardData, players, currentPlayerId, animState, prizeCubes, honeyPots];
    if (!this.imagesLoaded) return;

    const { tiles, links, rows, cols, zones } = boardData;
    const ctx = this.ctx;

    // Setup zone mapping au premier render
    if (zones && Object.keys(this.zonePanelMap).length === 0) {
      this.setupZonePanelMap(zones);
    }

    this.updateLayout(rows, cols);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Pixel art : pas de lissage
    ctx.imageSmoothingEnabled = false;

    // 1. Liens (teleporteurs)
    this.drawLinks(links);

    // 2. Cases
    for (const tile of tiles) {
      this.drawTile(tile, players, prizeCubes);
    }

    // 2b. Pots de miel (Hunny Hunt)
    if (honeyPots && honeyPots.length > 0) {
      for (const pot of honeyPots) {
        const potTile = tiles[pot.tileId];
        if (potTile) {
          const p = this.getTileCenter(potTile);
          const fontSize = Math.max(10, this.tileSize * 0.35);
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🍯', p.x, p.y);
        }
      }
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
  drawTile(tile, players, prizeCubes) {
    const ctx = this.ctx;
    const { x, y } = this.getTileCenter(tile);
    const half = this.tileSize / 2;

    const ownerPlayer = tile.owner !== null
      ? players.find(p => p.id === tile.owner)
      : null;

    if (tile.type === TileType.NORMAL) {
      // Fond derriere le panel : blanc si libre, couleur joueur si possedee
      ctx.fillStyle = ownerPlayer ? ownerPlayer.color : '#ffffff';
      ctx.fillRect(x - half, y - half, this.tileSize, this.tileSize);

      // Panel colore par-dessus (cadre colore selon la zone, centre transparent)
      const panelImg = this.getZonePanelImage(tile);
      if (panelImg) {
        ctx.drawImage(panelImg, x - half, y - half, this.tileSize, this.tileSize);
      }
    } else {
      // Autres types de cases : image standard
      const img = this.tileImages[tile.type];
      if (img) {
        ctx.drawImage(img, x - half, y - half, this.tileSize, this.tileSize);
      }
    }

    // Prize Cube sur une case damage (libre, non chevauche)
    const cubeHere = prizeCubes?.find(c => c.tileId === tile.id && c.riderId === null);
    if (cubeHere && this.diceImage) {
      ctx.drawImage(this.diceImage, x - half, y - half, this.tileSize, this.tileSize);
    }
  }

  // Dessine l'image dice.png centree sur une position
  drawDiceAt(x, y) {
    if (!this.diceImage) return;
    const size = this.tileSize;
    const half = size / 2;
    this.ctx.drawImage(this.diceImage, x - half, y - half, size, size);
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

    // Prize Cube : dessiner l'image dice au centre de la case (pas a l'offset du joueur)
    if (player.prizeCube) {
      this.drawDiceAt(x, y);
    }

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

    // Indicateurs d'etat (badge avec fond)
    const badges = [];
    if (player.stunned) badges.push({ text: 'STUN', bg: '#cc9900', fg: '#000' });
    if (player.justiceTurns > 0) badges.push({ text: `J${player.justiceTurns}`, bg: '#0a6e0a', fg: '#4cff8d' });
    if (player.darkTurns > 0) badges.push({ text: `D${player.darkTurns}`, bg: '#6e0a0a', fg: '#ff6b6b' });

    for (let i = 0; i < badges.length; i++) {
      const b = badges[i];
      const bx = px;
      const by = py - PLAYER_RADIUS - 8 - i * 16;
      ctx.font = 'bold 11px sans-serif';
      const tw = ctx.measureText(b.text).width;
      const padX = 3, padY = 2;
      ctx.fillStyle = b.bg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(bx - tw / 2 - padX, by - 6 - padY, tw + padX * 2, 12 + padY * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = b.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.text, bx, by);
    }
  }

  // Animation de deplacement
  drawMovingPlayer(animState, tiles) {
    const ctx = this.ctx;
    const { fromTileId, toTileId, progress, color, name, hasPrizeCube } = animState;
    const from = this.getTileCenter(tiles[fromTileId]);
    const to = this.getTileCenter(tiles[toTileId]);

    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;

    // Dessiner le Prize Cube sous le joueur s'il en chevauche un
    if (hasPrizeCube) {
      this.drawDiceAt(x, y);
    }

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
