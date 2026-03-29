// Renderer 3D Three.js - Vue principale du plateau
// Remplace le rendu CSS 3D par un vrai rendu WebGL via Three.js

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MOVE_STEP_DURATION } from './gameManager.js';

const COLORED_PANEL_COUNT = 16;

// 3D dimensions
const TILE_SIZE = 1;
const TILE_HEIGHT = 1;
const GAP = 0.1;
const SPACING = TILE_SIZE + GAP;
const DAMAGE_TILE_HEIGHT = 0.05;

// Colored panel side-face colors (from CSS)
const PANEL_COLORS = {
  1: 0xdfc473, 2: 0xc2d565, 3: 0xa4e277, 4: 0x99e199,
  5: 0x8fe2b1, 6: 0x82e2d1, 7: 0x9fd1e1, 8: 0xb6c4e1,
  9: 0xc1bfe1, 10: 0xcdb9e1, 11: 0xddb1e1, 12: 0xe1b1d3,
  13: 0xe1b5c1, 14: 0xe1b8b0, 15: 0xe0bf93, 16: 0xd0ce6a,
};

const TILE_TEXTURES = {
  start: 'images/startPanel.png',
  checkpoint_red: 'images/redCheckpoint.png',
  checkpoint_blue: 'images/blueCheckpoint.png',
  checkpoint_yellow: 'images/yellowCheckpoint.png',
  checkpoint_green: 'images/greenCheckpoint.png',
  bonus: 'images/bonusPanel.png',
  damage: 'images/damagePanel.png',
  event: 'images/specialPanel.png',
  joker: 'images/specialPanel.png',
  booster: 'images/gpBoosterPanel.png',
  normal: 'images/commandPanel.png',
  teleporter_h: 'images/horizontalTeleporter.png',
  teleporter_v: 'images/verticalTeleporter.png',
  dice: 'images/dice.png',
};

const TILE_SIDE_COLORS = {
  start: 0xffd700,
  normal: 0x3a4060,
  bonus: 0x292929,
  damage: 0xff2020,
  event: 0x00c8ff,
  joker: 0xff8c00,
  booster: 0x00ff90,
  checkpoint_red: 0xff4040,
  checkpoint_blue: 0x4080ff,
  checkpoint_yellow: 0xffff40,
  checkpoint_green: 0x40ff40,
};

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
    this.wrapper = null;
    this.scene = null;
    this.camera = null;
    this.webglRenderer = null;
    this.controls = null;

    this.tileMeshes = {};
    this.tilePositions = {};
    this.diceObjects = {};
    this.initialDice = {};

    this.dynamicGroup = null;
    this.diceGroup = null;
    this.boardGroup = null;

    this.zonePanelMap = {};
    this.rows = 0;
    this.cols = 0;
    this.selectedTileId = null;
    this.selectedHighlight = null;

    this.textureLoader = new THREE.TextureLoader();
    this.textureCache = {};

    this.clock = new THREE.Clock();
    this.animationId = null;

    this.cameraTilt = 60;
    this.cameraPan = 0;
    this.cameraDistance = 10;

    this._cameraTarget = null;
    this._cameraOffset = null; // Camera-to-target offset (preserved during auto-pan)
    this.activeRolls = [];

    // Shared geometries (reused across frames)
    this._tokenGeom = null;
    this._ringGeom = null;

    // Click vs drag detection
    this._clickStart = null;
  }

  // === Initialisation ===

  init(wrapperEl) {
    this.wrapper = wrapperEl;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

    // WebGL Renderer
    this.webglRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.webglRenderer.setPixelRatio(window.devicePixelRatio);
    this.webglRenderer.shadowMap.enabled = true;
    this.webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webglRenderer.domElement.style.display = 'block';
    wrapperEl.appendChild(this.webglRenderer.domElement);

    // OrbitControls — left drag to orbit, right/middle to pan, scroll to zoom
    this.controls = new OrbitControls(this.camera, this.webglRenderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 50;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // Ground plane (receives shadows)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x12122a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Groups
    this.dynamicGroup = new THREE.Group();
    this.scene.add(this.dynamicGroup);
    this.diceGroup = new THREE.Group();
    this.scene.add(this.diceGroup);

    // Shared geometries
    this._tokenGeom = new THREE.ConeGeometry(0.2, 0.4, 4);
    this._tokenGeom.rotateY(Math.PI / 4);
    this._tokenGeom.rotateX(Math.PI); // Invert → point down

    this._ringGeom = new THREE.RingGeometry(TILE_SIZE * 0.35, TILE_SIZE * 0.48, 4);
    this._ringGeom.rotateZ(Math.PI / 4);

    // Raycaster
    this.raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();

    // Click detection (distinguish click from drag)
    const canvas = this.webglRenderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this._clickStart = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 0 && this._clickStart) {
        const dx = e.clientX - this._clickStart.x;
        const dy = e.clientY - this._clickStart.y;
        if (dx * dx + dy * dy < 25) this._onClick(e);
        this._clickStart = null;
      }
    });

    // Resize
    this._resize();
    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(wrapperEl);

    // Start render loop
    this._animate();
  }

  _resize() {
    const w = this.wrapper.clientWidth;
    const h = this.wrapper.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.webglRenderer.setSize(w, h);
  }

  // === Render loop ===

  _animate() {
    this.animationId = requestAnimationFrame(() => this._animate());
    const dt = this.clock.getDelta();
    this._elapsed = (this._elapsed || 0) + dt;
    const time = this._elapsed;

    // Smooth camera translation (moves both target and camera to preserve viewing angle)
    if (this._cameraTarget && this._cameraOffset) {
      this.controls.target.lerp(this._cameraTarget, 0.08);
      this.camera.position.copy(this.controls.target).add(this._cameraOffset);
      if (this.controls.target.distanceTo(this._cameraTarget) < 0.01) {
        this.controls.target.copy(this._cameraTarget);
        this.camera.position.copy(this.controls.target).add(this._cameraOffset);
        this._cameraTarget = null;
      }
    }

    // Floating player tokens
    for (const child of this.dynamicGroup.children) {
      if (child.userData.isToken) {
        child.position.y = child.userData.baseY + Math.sin(time * 2 + child.userData.floatPhase) * 0.12;
      }
    }

    // Selection highlight pulse
    if (this.selectedHighlight) {
      this.selectedHighlight.material.opacity = 0.2 + Math.sin(time * 5) * 0.12;
    }

    // Dice rolling animations
    this._updateRolls(dt);

    this.controls.update();
    this.webglRenderer.render(this.scene, this.camera);
  }

  // === Texture loading (cached, pixel-art filter) ===

  _loadTexture(path) {
    if (this.textureCache[path]) return this.textureCache[path];
    const tex = this.textureLoader.load(path);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textureCache[path] = tex;
    return tex;
  }

  // === Generation du plateau ===

  generateBoard(boardData) {
    const { tiles, rows, cols, zones, posToId, _rawGrid } = boardData;
    this.rows = rows;
    this.cols = cols;
    this.tileMeshes = {};
    this.tilePositions = {};
    this.diceObjects = {};
    this.initialDice = {};

    // Remove old board
    if (this.boardGroup) {
      this.boardGroup.removeFromParent();
      this.boardGroup.traverse((c) => {
        if (c.isMesh) {
          c.geometry?.dispose();
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach((m) => m?.dispose());
        }
      });
    }

    // Store tile positions
    for (const tile of tiles) {
      this.tilePositions[tile.id] = { row: tile.row, col: tile.col };
    }

    // Zone mapping
    if (zones && zones.length > 0) {
      const indices = getZonePanelIndices(zones.length);
      this.zonePanelMap = {};
      for (let i = 0; i < zones.length; i++) {
        this.zonePanelMap[zones[i].id] = indices[i];
      }
    }

    this.boardGroup = new THREE.Group();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rawCell = _rawGrid?.[r]?.[c];
        if (!rawCell || !rawCell.type) continue;

        const x = c * SPACING;
        const z = r * SPACING;

        // --- Teleporter ---
        if (rawCell.type === 'teleporter') {
          this._createTeleporter(rawCell, x, z);
          continue;
        }

        const tileId = posToId[`${r},${c}`];
        const tile = tileId !== undefined ? tiles[tileId] : null;
        if (!tile) continue;

        // --- Damage panel (flat) ---
        if (tile.type === 'damage') {
          const tex = this._loadTexture(TILE_TEXTURES.damage);
          const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE, DAMAGE_TILE_HEIGHT, TILE_SIZE), mat);
          mesh.position.set(x, DAMAGE_TILE_HEIGHT / 2, z);
          mesh.receiveShadow = true;
          mesh.userData.tileId = tileId;
          this.tileMeshes[tileId] = mesh;
          this.boardGroup.add(mesh);
          continue;
        }

        // --- Normal 3D cube tile ---
        const { texturePath, sideColor } = this._getTileVisuals(tile);
        const tex = texturePath ? this._loadTexture(texturePath) : null;

        const topMat = new THREE.MeshStandardMaterial({
          map: tex, color: tex ? 0xffffff : sideColor, roughness: 0.6,
        });
        const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.8 });
        const bottomMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 1 });

        // Material order: [+x, -x, +y, -y, +z, -z]
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE),
          [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat],
        );
        mesh.position.set(x, TILE_HEIGHT / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.tileId = tileId;
        this.tileMeshes[tileId] = mesh;
        this.boardGroup.add(mesh);
      }
    }

    this.scene.add(this.boardGroup);

    // Initial dice on hasDice damage tiles
    for (const tile of tiles) {
      if (tile.type === 'damage' && tile.hasDice) {
        const pos = this.tilePositions[tile.id];
        if (!pos) continue;
        const diceMesh = this._createDiceMesh();
        diceMesh.position.set(pos.col * SPACING, TILE_SIZE / 2 + DAMAGE_TILE_HEIGHT, pos.row * SPACING);
        this.diceGroup.add(diceMesh);
        this.initialDice[tile.id] = diceMesh;
      }
    }

    // Setup camera & lighting for the board
    const cx = (cols - 1) * SPACING / 2;
    const cz = (rows - 1) * SPACING / 2;
    const extent = Math.max(rows, cols) * SPACING;
    this.cameraDistance = extent * 0.7;

    this.controls.target.set(cx, 0, cz);
    this._cameraTarget = null;
    this._updateCameraFromAngles();

    this.dirLight.position.set(cx + extent * 0.4, extent * 0.8, cz - extent * 0.4);
    this.dirLight.target.position.set(cx, 0, cz);
    const s = extent * 0.7;
    Object.assign(this.dirLight.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.1, far: extent * 3 });
    this.dirLight.shadow.camera.updateProjectionMatrix();

    // Center on start tile
    const startTile = tiles.find((t) => t.type === 'start');
    if (startTile) setTimeout(() => this.selectCell(startTile.id), 100);
  }

  _createTeleporter(rawCell, x, z) {
    const isH = rawCell.direction === 'horizontal';
    const sx = isH ? 1.2 : 0.3;
    const sy = 0.3;
    const sz = isH ? 0.3 : 1.2;

    const tex = this._loadTexture(isH ? TILE_TEXTURES.teleporter_h : TILE_TEXTURES.teleporter_v);
    const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    const cyanMat = new THREE.MeshStandardMaterial({ color: 0x71dff8, roughness: 0.8 });

    // Material order: [+x, -x, +y, -y, +z, -z]
    const materials = isH
      ? [cyanMat, cyanMat, topMat, topMat, topMat, topMat]
      : [topMat, topMat, topMat, topMat, cyanMat, cyanMat];

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), materials);
    mesh.position.set(x, sy / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.boardGroup.add(mesh);
  }

  _getTileVisuals(tile) {
    let texturePath = TILE_TEXTURES[tile.type] || null;
    let sideColor = TILE_SIDE_COLORS[tile.type] || 0xffffff;

    if (tile.type === 'normal' && tile.zone) {
      const idx = this.zonePanelMap[tile.zone];
      if (idx) {
        texturePath = `images/coloredCommandPanel/${idx}.png`;
        sideColor = PANEL_COLORS[idx] || 0x3a4060;
      }
    }
    return { texturePath, sideColor };
  }

  // === Selection et camera ===

  selectCell(tileId) {
    this.selectedTileId = tileId;

    // Remove old highlight
    if (this.selectedHighlight) {
      this.selectedHighlight.removeFromParent();
      this.selectedHighlight.geometry.dispose();
      this.selectedHighlight.material.dispose();
      this.selectedHighlight = null;
    }

    const tileMesh = this.tileMeshes[tileId];
    if (!tileMesh) return;

    // Highlight plane on top of tile
    const geom = new THREE.PlaneGeometry(TILE_SIZE * 1.02, TILE_SIZE * 1.02);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.3,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.selectedHighlight = new THREE.Mesh(geom, mat);
    this.selectedHighlight.rotation.x = -Math.PI / 2;

    const tileTop = tileMesh.position.y + (tileMesh.geometry.parameters?.height || TILE_HEIGHT) / 2;
    this.selectedHighlight.position.set(tileMesh.position.x, tileTop + 0.02, tileMesh.position.z);
    this.scene.add(this.selectedHighlight);

    // Smooth camera translation (preserve viewing angle)
    const pos = this.tilePositions[tileId];
    if (pos) {
      this._cameraTarget = new THREE.Vector3(pos.col * SPACING, 0, pos.row * SPACING);
      this._cameraOffset = this.camera.position.clone().sub(this.controls.target);
    }
  }

  setCameraTilt(deg) {
    this.cameraTilt = deg;
    this._updateCameraFromAngles();
  }

  setCameraPan(deg) {
    this.cameraPan = deg;
    this._updateCameraFromAngles();
  }

  _updateCameraFromAngles() {
    const spherical = new THREE.Spherical();
    spherical.setFromVector3(this.camera.position.clone().sub(this.controls.target));
    spherical.phi = this.cameraTilt * Math.PI / 180;
    spherical.theta = -this.cameraPan * Math.PI / 180;
    spherical.radius = this.cameraDistance;

    const offset = new THREE.Vector3().setFromSpherical(spherical);
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  // === Click (raycasting) ===

  _onClick(e) {
    const rect = this.webglRenderer.domElement.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this._mouse, this.camera);
    const hits = this.raycaster.intersectObjects(Object.values(this.tileMeshes), false);
    if (hits.length > 0) {
      const tid = hits[0].object.userData.tileId;
      if (tid !== undefined) this.selectCell(tid);
    }
  }

  // === Mise a jour de l'etat du jeu ===

  updateGameState(players, currentPlayerId, prizeCubes, tiles) {
    if (!this.scene) return;

    // Clear dynamic elements (tokens, rings, indicators)
    this._clearDynamicGroup();

    // Ownership rings & level indicators
    if (tiles) {
      for (const tile of tiles) {
        if (tile.owner === null) continue;
        const owner = players.find((p) => p.id === tile.owner);
        if (owner) this._addOwnerRing(tile.id, owner.color);
        if (tile.level > 0) this._addLevelIndicator(tile.id, tile.level);
      }
    }

    // Prize cubes
    if (prizeCubes) this._updatePrizeCubes(prizeCubes);

    // Player tokens
    if (players) {
      const byTile = {};
      for (const p of players) {
        (byTile[p.position] ??= []).push(p);
      }
      for (const [tid, list] of Object.entries(byTile)) {
        list.forEach((p, i) => this._addPlayerToken(p, +tid, i, list.length, p.id === currentPlayerId));
      }
    }

    // Center camera on current player
    if (currentPlayerId != null) {
      const cp = players?.find((p) => p.id === currentPlayerId);
      if (cp) this.selectCell(cp.position);
    }
  }

  _clearDynamicGroup() {
    while (this.dynamicGroup.children.length) {
      const c = this.dynamicGroup.children[0];
      this.dynamicGroup.remove(c);
      // Dispose materials only (geometry is shared/pooled)
      if (c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m) => {
          if (m.map && m.map.source?.data instanceof HTMLCanvasElement) m.map.dispose();
          m.dispose();
        });
      }
    }
  }

  _addPlayerToken(player, tileId, stackIdx, stackCount, isCurrent) {
    const color = new THREE.Color(player.color);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 });
    const mesh = new THREE.Mesh(this._tokenGeom, mat);
    mesh.castShadow = true;

    // If riding a prize cube, place on the dice
    if (player.prizeCube) {
      const dc = this.diceObjects[player.prizeCube.cubeId];
      if (dc) {
        const p = dc.mesh.position;
        mesh.position.set(p.x, p.y + TILE_SIZE / 2 + 0.3, p.z);
        mesh.userData = { isToken: true, baseY: p.y + TILE_SIZE / 2 + 0.3, floatPhase: stackIdx * 1.5 };
        this.dynamicGroup.add(mesh);
        return;
      }
    }

    const pos = this.tilePositions[tileId];
    if (!pos) return;

    let ox = 0, oz = 0;
    if (stackCount > 1) {
      ox = (stackIdx % 2) * 0.3 - 0.15;
      oz = Math.floor(stackIdx / 2) * 0.3 - 0.15;
    }

    const baseY = TILE_HEIGHT + 0.3;
    mesh.position.set(pos.col * SPACING + ox, baseY, pos.row * SPACING + oz);
    mesh.userData = { isToken: true, baseY, floatPhase: stackIdx * 1.5 };
    this.dynamicGroup.add(mesh);
  }

  _addOwnerRing(tileId, colorStr) {
    const tileMesh = this.tileMeshes[tileId];
    if (!tileMesh) return;

    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorStr),
      side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false,
    });
    const ring = new THREE.Mesh(this._ringGeom, mat);
    ring.rotation.x = -Math.PI / 2;

    const top = tileMesh.position.y + (tileMesh.geometry.parameters?.height || TILE_HEIGHT) / 2;
    ring.position.set(tileMesh.position.x, top + 0.02, tileMesh.position.z);
    this.dynamicGroup.add(ring);
  }

  _addLevelIndicator(tileId, level) {
    const tileMesh = this.tileMeshes[tileId];
    if (!tileMesh) return;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.roundRect(0, 0, 64, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`LV${level}`, 32, 16);

    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(0.4, 0.2, 1);

    const top = tileMesh.position.y + (tileMesh.geometry.parameters?.height || TILE_HEIGHT) / 2;
    sprite.position.set(tileMesh.position.x + TILE_SIZE * 0.25, top + 0.15, tileMesh.position.z + TILE_SIZE * 0.25);
    this.dynamicGroup.add(sprite);
  }

  // === Prize Cubes (3D dice) ===

  _updatePrizeCubes(prizeCubes) {
    // Adopt initial dice created during board generation
    if (Object.keys(this.initialDice).length > 0) {
      for (const cube of prizeCubes) {
        const init = this.initialDice[cube.sourceTileId];
        if (init) {
          this.diceObjects[cube.id] = { mesh: init, tileId: cube.sourceTileId };
          delete this.initialDice[cube.sourceTileId];
        }
      }
      for (const mesh of Object.values(this.initialDice)) {
        this.diceGroup.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      this.initialDice = {};
    }

    const activeIds = new Set();

    for (const cube of prizeCubes) {
      activeIds.add(cube.id);
      const pos = this.tilePositions[cube.tileId];
      if (!pos) continue;

      const tx = pos.col * SPACING;
      const tz = pos.row * SPACING;
      const ty = TILE_SIZE / 2 + DAMAGE_TILE_HEIGHT;

      if (!this.diceObjects[cube.id]) {
        const mesh = this._createDiceMesh();
        mesh.position.set(tx, ty, tz);
        this.diceGroup.add(mesh);
        this.diceObjects[cube.id] = { mesh, tileId: cube.tileId };
      } else {
        const dc = this.diceObjects[cube.id];
        dc.mesh.visible = true;

        if (dc.tileId !== cube.tileId) {
          const oldPos = this.tilePositions[dc.tileId];
          if (oldPos) {
            this._startDiceRoll(dc, oldPos, pos);
          } else {
            dc.mesh.position.set(tx, ty, tz);
          }
          dc.tileId = cube.tileId;
        }
      }
    }

    // Remove disappeared cubes
    for (const id of Object.keys(this.diceObjects)) {
      if (!activeIds.has(parseInt(id))) {
        const dc = this.diceObjects[id];
        this.activeRolls = this.activeRolls.filter((r) => r.mesh !== dc.mesh);
        this.diceGroup.remove(dc.mesh);
        dc.mesh.geometry.dispose();
        dc.mesh.material.dispose();
        delete this.diceObjects[id];
      }
    }
  }

  _createDiceMesh() {
    const tex = this._loadTexture(TILE_TEXTURES.dice);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE), mat);
    mesh.castShadow = true;
    return mesh;
  }

  // === Dice rolling animation (edge-pivot) ===

  _startDiceRoll(dc, fromPos, toPos) {
    this.activeRolls = this.activeRolls.filter((r) => r.mesh !== dc.mesh);

    const S = TILE_SIZE;
    const from = new THREE.Vector3(fromPos.col * SPACING, dc.mesh.position.y, fromPos.row * SPACING);
    const to = new THREE.Vector3(toPos.col * SPACING, dc.mesh.position.y, toPos.row * SPACING);

    const dx = toPos.col - fromPos.col;
    const dz = toPos.row - fromPos.row;

    // Pivot = bottom edge between current bottom face and next bottom face
    // Offset = vector from pivot to cube center before roll
    let pivot, offset, axis;

    if (dx > 0) {        // rolling +X (right)
      pivot = new THREE.Vector3(from.x + S / 2, from.y - S / 2, from.z);
      offset = new THREE.Vector3(-S / 2, S / 2, 0);
      axis = new THREE.Vector3(0, 0, -1);
    } else if (dx < 0) { // rolling -X (left)
      pivot = new THREE.Vector3(from.x - S / 2, from.y - S / 2, from.z);
      offset = new THREE.Vector3(S / 2, S / 2, 0);
      axis = new THREE.Vector3(0, 0, 1);
    } else if (dz > 0) { // rolling +Z (down in rows)
      pivot = new THREE.Vector3(from.x, from.y - S / 2, from.z + S / 2);
      offset = new THREE.Vector3(0, S / 2, -S / 2);
      axis = new THREE.Vector3(1, 0, 0);
    } else {              // rolling -Z (up in rows)
      pivot = new THREE.Vector3(from.x, from.y - S / 2, from.z - S / 2);
      offset = new THREE.Vector3(0, S / 2, S / 2);
      axis = new THREE.Vector3(-1, 0, 0);
    }

    this.activeRolls.push({
      mesh: dc.mesh,
      pivot,
      offset,
      axis,
      startQuat: dc.mesh.quaternion.clone(),
      to,
      progress: 0,
      duration: MOVE_STEP_DURATION / 1000,
    });
  }

  _updateRolls(dt) {
    for (let i = this.activeRolls.length - 1; i >= 0; i--) {
      const r = this.activeRolls[i];
      r.progress += dt / r.duration;

      if (r.progress >= 1) {
        // Snap to final position and apply full 90° rotation
        r.mesh.position.copy(r.to);
        const q = new THREE.Quaternion().setFromAxisAngle(r.axis, Math.PI / 2);
        r.mesh.quaternion.copy(q.multiply(r.startQuat));
        this.activeRolls.splice(i, 1);
      } else {
        // Arc: rotate the center-to-pivot offset, producing a circular trajectory
        const angle = (Math.PI / 2) * r.progress;
        const rotatedOffset = r.offset.clone().applyAxisAngle(r.axis, angle);
        r.mesh.position.copy(r.pivot).add(rotatedOffset);

        // Orientation follows the same rotation
        const q = new THREE.Quaternion().setFromAxisAngle(r.axis, angle);
        r.mesh.quaternion.copy(q.multiply(r.startQuat.clone()));
      }
    }
  }

  // === Cleanup ===

  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this._resizeObs) this._resizeObs.disconnect();
    this.controls.dispose();
    this.webglRenderer.dispose();
  }
}
