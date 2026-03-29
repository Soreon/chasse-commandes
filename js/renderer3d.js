// Renderer 3D CSS - Vue principale du plateau
// Genere un DOM 3D avec des cubes CSS (6 faces) pour chaque case

import { MOVE_STEP_DURATION } from './gameManager.js';

const COLORED_PANEL_COUNT = 16;

function getZonePanelIndices(count) {
  if (count <= 0) return [];
  const step = COLORED_PANEL_COUNT / count;
  const indices = [];
  for (let i = 0; i < count; i++) {
    indices.push(Math.floor(1 + i * step));
  }
  return indices;
}

export class Renderer3D {
  constructor() {
    this.wrapper = null;     // #board-3d-wrapper
    this.container = null;   // #board-3d-container
    this.view = null;        // #board-3d-view
    this.board = null;       // .board-3d
    this.cellElements = {};  // { tileId: element }
    this.tilePositions = {}; // { tileId: { row, col } }
    this.diceContainers = {}; // { cubeId: { container, element, tileId } }

    this.cameraTilt = 60;
    this.cameraPan = 0;
    this.translateX = 0;
    this.translateY = 0;
    this.isMiddleDown = false;

    this.zonePanelMap = {};
    this.rows = 0;
    this.cols = 0;
    this.selectedTileId = null;
  }

  init(wrapperEl) {
    this.wrapper = wrapperEl;

    // Create DOM structure
    this.container = document.createElement('div');
    this.container.id = 'board-3d-container';

    this.view = document.createElement('div');
    this.view.id = 'board-3d-view';

    this.board = document.createElement('div');
    this.board.className = 'board-3d';

    this.view.appendChild(this.board);
    this.container.appendChild(this.view);
    this.wrapper.appendChild(this.container);

    this._setupCameraControls();
  }

  // === Generation du plateau ===

  generateBoard(boardData) {
    const { tiles, rows, cols, zones, posToId, _rawGrid } = boardData;

    this.rows = rows;
    this.cols = cols;
    this.cellElements = {};
    this.tilePositions = {};
    this.diceContainers = {};

    // Store tile positions
    for (const tile of tiles) {
      this.tilePositions[tile.id] = { row: tile.row, col: tile.col };
    }

    // Setup zone mapping
    if (zones && zones.length > 0) {
      const indices = getZonePanelIndices(zones.length);
      this.zonePanelMap = {};
      for (let i = 0; i < zones.length; i++) {
        this.zonePanelMap[zones[i].id] = indices[i];
      }
    }

    // Set grid template
    this.board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    this.board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    this.board.innerHTML = '';

    // Generate cells using rawGrid for full picture (including teleporters)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cellEl = document.createElement('div');
        cellEl.className = 'cell3d';

        const rawCell = _rawGrid?.[r]?.[c];
        const tileId = posToId[`${r},${c}`];
        const tile = tileId !== undefined ? tiles[tileId] : null;

        if (!rawCell || !rawCell.type) {
          // Empty cell
          cellEl.classList.add('empty');
          this.board.appendChild(cellEl);
          continue;
        }

        if (rawCell.type === 'teleporter') {
          // Teleporter cell
          if (rawCell.direction === 'horizontal') {
            cellEl.classList.add('t-horizontal-teleporter');
          } else {
            cellEl.classList.add('t-vertical-teleporter');
          }
          this._applyNeighborClasses(cellEl, _rawGrid, r, c, rows, cols);
          this._createFaces(cellEl);
          this.board.appendChild(cellEl);
          continue;
        }

        if (!tile) {
          cellEl.classList.add('empty');
          this.board.appendChild(cellEl);
          continue;
        }

        // Real tile - apply type class
        this._applyTypeClass(cellEl, tile);

        // Apply neighbor shading classes (using rawGrid for teleporter awareness)
        this._applyNeighborClasses(cellEl, _rawGrid, r, c, rows, cols);

        // Create 6 faces
        this._createFaces(cellEl);

        // Store reference
        cellEl.dataset.tileId = tileId;
        this.cellElements[tileId] = cellEl;

        // Click to select
        cellEl.addEventListener('click', () => {
          this.selectCell(tileId);
        });

        this.board.appendChild(cellEl);
      }
    }

    // Create initial dice for hasDice tiles (like old viewer)
    const cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-size')) || 80;
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grid-gap')) || 8;
    for (const tile of tiles) {
      if (tile.type === 'damage' && tile.hasDice) {
        const pos = this.tilePositions[tile.id];
        if (!pos) continue;
        const { container, element } = this._createDiceContainer();
        const targetX = pos.col * (cellSize + gap);
        const targetY = pos.row * (cellSize + gap);
        container.style.transform = `translate(${targetX}px, ${targetY}px)`;
        this.board.appendChild(container);
        this.initialDice = this.initialDice || {};
        this.initialDice[tile.id] = { container, element };
      }
    }

    // Center on start tile
    const startTile = tiles.find(t => t.type === 'start');
    if (startTile) {
      setTimeout(() => this.selectCell(startTile.id), 100);
    }
  }

  _applyTypeClass(cellEl, tile) {
    switch (tile.type) {
      case 'start':
        cellEl.classList.add('t-start-panel');
        break;
      case 'normal': {
        const panelIndex = tile.zone ? this.zonePanelMap[tile.zone] : null;
        if (panelIndex) {
          cellEl.classList.add(`t-colored-command-panel-${panelIndex}`);
        } else {
          cellEl.classList.add('t-command-panel');
        }
        break;
      }
      case 'checkpoint_red':
        cellEl.classList.add('t-red-checkpoint');
        break;
      case 'checkpoint_blue':
        cellEl.classList.add('t-blue-checkpoint');
        break;
      case 'checkpoint_yellow':
        cellEl.classList.add('t-yellow-checkpoint');
        break;
      case 'checkpoint_green':
        cellEl.classList.add('t-green-checkpoint');
        break;
      case 'bonus':
        cellEl.classList.add('t-bonus-panel');
        break;
      case 'damage':
        cellEl.classList.add('t-damage-panel');
        cellEl.classList.add('no-box');
        break;
      case 'event':
        cellEl.classList.add('t-special-panel');
        break;
      case 'booster':
        cellEl.classList.add('t-gp-booster-panel');
        break;
      case 'joker':
        cellEl.classList.add('t-special-panel');
        break;
    }
  }

  _applyNeighborClasses(cellEl, rawGrid, r, c, rows, cols) {
    const hasNeighbor = (dr, dc) => {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return false;
      const n = rawGrid?.[nr]?.[nc];
      return n && n.type && !['teleporter', 'damage'].includes(n.type);
    };

    if (hasNeighbor(-1, 0)) cellEl.classList.add('tn');
    if (hasNeighbor(1, 0)) cellEl.classList.add('bn');
    if (hasNeighbor(0, -1)) cellEl.classList.add('ln');
    if (hasNeighbor(0, 1)) cellEl.classList.add('rn');
  }

  _createFaces(cellEl) {
    const faces = ['Xplus', 'Xminus', 'Yplus', 'Yminus', 'Zplus', 'Zminus'];
    for (const f of faces) {
      const face = document.createElement('div');
      face.className = `face ${f}`;
      cellEl.appendChild(face);
    }
  }

  // === Selection et camera ===

  selectCell(tileId) {
    // Deselect previous
    if (this.selectedTileId !== null && this.cellElements[this.selectedTileId]) {
      this.cellElements[this.selectedTileId].classList.remove('selected');
    }

    this.selectedTileId = tileId;
    const cellEl = this.cellElements[tileId];
    if (!cellEl) return;

    cellEl.classList.add('selected');

    // Center camera on this cell
    const cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-size')) || 80;
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grid-gap')) || 8;

    const pos = this.tilePositions[tileId];
    if (!pos) return;

    const offsetX = pos.col * (cellSize + gap) + cellSize / 2;
    const offsetY = pos.row * (cellSize + gap) + cellSize / 2;

    this.translateX = offsetX;
    this.translateY = offsetY;
    this._updateCameraTransform();
  }

  setCameraTilt(deg) { this.cameraTilt = deg; this._updateCameraTransform(); }
  setCameraPan(deg) { this.cameraPan = deg; this._updateCameraTransform(); }

  _updateCameraTransform() {
    if (!this.view) return;
    this.view.style.transform =
      `perspective(1000px) rotateX(${this.cameraTilt}deg) rotateZ(${this.cameraPan}deg) translateX(${-this.translateX}px) translateY(${-this.translateY}px)`;
  }

  // === Camera controls ===

  _setupCameraControls() {
    // Middle-click drag to rotate
    this.wrapper.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        this.isMiddleDown = true;
        e.preventDefault();
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 1) this.isMiddleDown = false;
    });

    document.addEventListener('mouseleave', () => {
      this.isMiddleDown = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isMiddleDown) return;
      const sensitivity = 0.5;
      const maxDelta = 2;
      const deltaX = Math.max(-maxDelta, Math.min(-e.movementX, maxDelta));
      this.cameraPan += deltaX * sensitivity;
      this.cameraPan = ((this.cameraPan % 360) + 360) % 360;
      this._updateCameraTransform();
    });
  }

  // === Mise a jour de l'etat du jeu ===

  updateGameState(players, currentPlayerId, prizeCubes, tiles) {
    if (!this.board) return;

    // Remove old dynamic elements (except dice containers which persist)
    this.board.querySelectorAll('.player-token-3d').forEach(el => el.remove());
    this.board.querySelectorAll('.owner-ring').forEach(el => el.remove());
    this.board.querySelectorAll('.level-indicator').forEach(el => el.remove());

    // Update tile ownership and levels
    if (tiles) {
      for (const tile of tiles) {
        const cellEl = this.cellElements[tile.id];
        if (!cellEl) continue;

        if (tile.owner !== null) {
          const ownerPlayer = players.find(p => p.id === tile.owner);
          if (ownerPlayer) {
            const ring = document.createElement('div');
            ring.className = 'owner-ring';
            ring.style.borderColor = ownerPlayer.color;
            const zplus = cellEl.querySelector('.face.Zplus');
            if (zplus) zplus.appendChild(ring);
          }

          if (tile.level > 0) {
            const lvl = document.createElement('div');
            lvl.className = 'level-indicator';
            lvl.textContent = `LV${tile.level}`;
            const zplus = cellEl.querySelector('.face.Zplus');
            if (zplus) zplus.appendChild(lvl);
          }
        }
      }
    }

    // Prize Cubes (real 3D dice cubes)
    if (prizeCubes) {
      this._updatePrizeCubes(prizeCubes);
    }

    // Player tokens
    if (players) {
      // Group players by tile for stacking
      const playersByTile = {};
      for (const player of players) {
        const tid = player.position;
        if (!playersByTile[tid]) playersByTile[tid] = [];
        playersByTile[tid].push(player);
      }

      for (const [tileId, tilePlayers] of Object.entries(playersByTile)) {
        const cellEl = this.cellElements[tileId];
        if (!cellEl) continue;

        tilePlayers.forEach((player, idx) => {
          const token = document.createElement('div');
          token.className = 'player-token-3d';
          const isCurrent = player.id === currentPlayerId;
          if (isCurrent) token.classList.add('current');

          // 4 triangular faces + 1 base for the inverted pyramid
          for (let i = 0; i < 4; i++) {
            const face = document.createElement('div');
            face.className = `pyramid-face pf-${i}`;
            face.style.borderBottomColor = player.color;
            token.appendChild(face);
          }
          const base = document.createElement('div');
          base.className = 'pyramid-base';
          base.style.backgroundColor = player.color;
          token.appendChild(base);

          // Stack offset for multiple players on same tile (centered when alone)
          const count = tilePlayers.length;
          let ox = 0, oy = 0;
          if (count > 1) {
            ox = (idx % 2) * 20 - 10;
            oy = Math.floor(idx / 2) * 20 - 10;
          }
          token.style.left = `calc(50% + ${ox}px)`;
          token.style.top = `calc(50% + ${oy}px)`;

          // If player rides a prize cube, place token on the container (not the rotating element)
          const riddenDc = player.prizeCube && this.diceContainers[player.prizeCube.cubeId];
          if (riddenDc) {
            token.style.left = 'calc(var(--cell-size) / 2)';
            token.style.top = 'calc(var(--cell-size) / 2)';
            riddenDc.container.appendChild(token);
            return;
          }

          const zplus = cellEl.querySelector('.face.Zplus');
          if (zplus) zplus.appendChild(token);
        });
      }
    }

    // Center camera on current player
    if (currentPlayerId !== undefined && currentPlayerId !== null) {
      const currentPlayer = players?.find(p => p.id === currentPlayerId);
      if (currentPlayer) {
        this.selectCell(currentPlayer.position);
      }
    }
  }

  // === Prize Cubes (real 3D dice) ===

  _updatePrizeCubes(prizeCubes) {
    const cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-size')) || 80;
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grid-gap')) || 8;

    // On first call, adopt initial dice containers created at board generation
    if (this.initialDice && Object.keys(this.initialDice).length > 0) {
      for (const cube of prizeCubes) {
        if (this.initialDice[cube.sourceTileId]) {
          const init = this.initialDice[cube.sourceTileId];
          this.diceContainers[cube.id] = { container: init.container, element: init.element, tileId: cube.sourceTileId };
          delete this.initialDice[cube.sourceTileId];
        }
      }
      // Remove any leftover initial dice not matched to a prize cube
      for (const [tileId, init] of Object.entries(this.initialDice)) {
        init.container.remove();
      }
      this.initialDice = {};
    }

    // Track which cubes still exist
    const activeCubeIds = new Set();

    for (const cube of prizeCubes) {
      activeCubeIds.add(cube.id);
      const pos = this.tilePositions[cube.tileId];
      if (!pos) continue;

      const targetX = pos.col * (cellSize + gap);
      const targetY = pos.row * (cellSize + gap);

      if (!this.diceContainers[cube.id]) {
        // Create new 3D dice
        const { container, element } = this._createDiceContainer();
        container.style.transform = `translate(${targetX}px, ${targetY}px)`;
        this.board.appendChild(container);
        this.diceContainers[cube.id] = { container, element, tileId: cube.tileId };
      } else {
        const dc = this.diceContainers[cube.id];
        dc.container.style.display = '';

        // If tile changed, roll animation
        if (dc.tileId !== cube.tileId) {
          const oldPos = this.tilePositions[dc.tileId];
          if (oldPos) {
            this._rollDiceTo(dc, oldPos, pos, cellSize, gap);
          } else {
            dc.container.style.transform = `translate(${targetX}px, ${targetY}px)`;
          }
          dc.tileId = cube.tileId;
        }
      }
    }

    // Remove dice for cubes that no longer exist
    for (const id of Object.keys(this.diceContainers)) {
      if (!activeCubeIds.has(parseInt(id))) {
        this.diceContainers[id].container.remove();
        delete this.diceContainers[id];
      }
    }
  }

  _createDiceContainer() {
    const container = document.createElement('div');
    container.className = 'dice-container-3d';

    const element = document.createElement('div');
    element.className = 'cell3d t-dice';
    this._createFaces(element);

    container.appendChild(element);
    return { container, element };
  }

  _rollDiceTo(dc, fromPos, toPos, cellSize, gap) {
    const dr = toPos.row - fromPos.row;
    const dc2 = toPos.col - fromPos.col;

    // Determine roll direction
    let direction = null;
    if (dc2 > 0) direction = 'XPlus';
    else if (dc2 < 0) direction = 'XMinus';
    else if (dr > 0) direction = 'YPlus';
    else if (dr < 0) direction = 'YMinus';

    if (!direction) return;

    const el = dc.element;

    // Remove old rotation classes
    const rotClasses = ['rotatingTowardsXPlus', 'rotatingTowardsXMinus', 'rotatingTowardsYPlus', 'rotatingTowardsYMinus',
                        'willRotateTowardsXPlus', 'willRotateTowardsXMinus', 'willRotateTowardsYPlus', 'willRotateTowardsYMinus'];
    el.classList.remove(...rotClasses);

    // Set will-rotate (transform-origin) then rotate
    el.classList.add(`willRotateTowards${direction}`);
    // Force reflow so the transform-origin applies before the rotation
    void el.offsetWidth;
    el.classList.add(`rotatingTowards${direction}`);

    // Move container immediately so translation and roll happen in parallel
    const targetX = toPos.col * (cellSize + gap);
    const targetY = toPos.row * (cellSize + gap);
    dc.container.style.transform = `translate(${targetX}px, ${targetY}px)`;

    // After animation, remove rotation classes
    setTimeout(() => {
      el.classList.remove(...rotClasses);
    }, MOVE_STEP_DURATION);
  }
}
