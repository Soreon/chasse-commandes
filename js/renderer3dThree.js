// Vue 3D du plateau (Three.js / WebGL).
//
// La vue garde ses objets d'une image à l'autre (pions, marques de propriété, cubes, pots) et ne
// touche qu'à ce qui a changé quand on lui passe l'état du moteur avec sync(game).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TileType } from './engine/board.js';
import { getZonePanelIndices } from './renderer.js';
import { loadTileArt } from './tileArt.js';
import { buildEnvironment } from './environment.js';
import { buildBeam } from './teleportBeams.js';
import { pixelLabelCanvas } from './pixelLabel.js';
import { buildPawn, PAWN_HEIGHT } from './pawn.js';
import { buildLightning } from './lightning.js';

const TILE_SIZE = 1;
const TILE_HEIGHT = 1;
const GAP = 0.1;
const SPACING = TILE_SIZE + GAP;
const DAMAGE_TILE_HEIGHT = 0.05;
const CUBE_TOP = DAMAGE_TILE_HEIGHT + TILE_SIZE;

// Dessin creusé dans le dessus des cases d'après leur image. Les flancs du cube montent sur
// toute sa hauteur ; son dessus est le rebord de l'image, évidé en son centre, et le dessin est
// posé au fond de cette cuvette : fond au plus bas, motif à mi-hauteur.
// (`rim` est la profondeur de la cuvette ; les autres hauteurs sont mesurées depuis son fond)
const RELIEF = { rim: 0.09, bg: 0.02, motif: 0.055, slot: 0.006 };
const DICE_RELIEF_SCALE = 0.5;                       // creux moins profond sur le Prize Cube
// Les personnages se tiennent dans la cuvette, à la hauteur du motif (et non sur le rebord)
const TILE_STAND = TILE_HEIGHT - RELIEF.rim + RELIEF.motif;
const CURRENT_PAWN_SCALE = 1.15;  // le personnage du joueur dont c'est le tour est un peu plus grand
const CUBE_STAND = CUBE_TOP - (RELIEF.rim - RELIEF.motif) * DICE_RELIEF_SCALE;
const SLAB_HEIGHT = DAMAGE_TILE_HEIGHT / 2;          // corps d'une dalle de dégâts
const SLAB_RELIEF_SCALE = (DAMAGE_TILE_HEIGHT - SLAB_HEIGHT) / RELIEF.rim;
const FACE_MARGIN = 0.012;                           // retrait du dessin sur les dalles de dégâts
const TILE_CORNER_RADIUS = 0.045;                    // arrondi des arêtes verticales des cubes

// Images servant de modèle aux cases (voir js/tileArt.js) et textures restantes
const TILE_TEXTURES = {
  start: 'images/startPanel.png',
  checkpoint_red: 'images/redCheckpoint.png',
  checkpoint_blue: 'images/blueCheckpoint.png',
  checkpoint_yellow: 'images/yellowCheckpoint.png',
  checkpoint_green: 'images/greenCheckpoint.png',
  bonus: 'images/bonusPanel.png',
  damage: 'images/damagePanel.png',
  event: 'images/specialPanel.png',
  booster: 'images/gpBoosterPanel.png',
  normal: 'images/commandPanel.png',
  dice: 'images/dice.png',
};

// Couleur de secours d'une case dont l'image est illisible (sinon la couleur vient de l'image)
const TILE_SIDE_COLORS = {
  start: 0xffd700,
  normal: 0x3a4060,
  bonus: 0x292929,
  damage: 0xff2020,
  event: 0x00c8ff,
  booster: 0x00ff90,
  checkpoint_red: 0xff4040,
  checkpoint_blue: 0x4080ff,
  checkpoint_yellow: 0xffff40,
  checkpoint_green: 0x40ff40,
};

// Flèches selon l'angle à l'écran, de 0° (vers la droite) en tournant vers le haut
const SCREEN_ARROWS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];

// Ombrage « toon » : dégradé à 3 paliers
function createToonGradient() {
  const tex = new THREE.DataTexture(new Uint8Array([90, 160, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const easeInOut = k => (k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2);
const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Apparition puis disparition en douceur sur la durée d'un effet (0 -> 1 -> 0)
const envelope = t => clamp01(Math.min(t / 0.15, (1 - t) / 0.15));

// Stun : part de l'effet prise par la foudre, puis moment où les étoiles se mettent à tourner
const STRIKE_SHARE = 0.42;
const STUN_STARS_AT = 0.36;

// Déplacement toléré, en pixels, pour qu'un appui compte encore comme un clic
const TAP_SLACK_MOUSE = 5;
const TAP_SLACK_TOUCH = 12;
// Au doigt, distance (pixels) jusqu'à laquelle un appui à côté d'une case à choisir la désigne
const TOUCH_PICK_RADIUS = 34;
const INSET_SIDES = ['top', 'right', 'bottom', 'left'];

export class Renderer3D {
  constructor() {
    this.wrapper = null;
    this.scene = null;
    this.camera = null;
    this.webglRenderer = null;
    this.controls = null;
    this.game = null;

    this.tileMeshes = {};      // id de case -> mesh
    this.tileCenters = {};     // id de case -> { x, z, top }
    this.boardGroup = null;
    this.overlayGroup = null;  // marques de propriété, niveaux, pots, cubes, pions
    this.pickGroup = null;     // flèches et surbrillances pendant un choix

    this._ownKeys = {};        // id de case -> "propriétaire|niveau" déjà affiché
    this._ownObjects = {};     // id de case -> [objets]
    this.cubeObjs = {};        // id de cube -> { mesh, tileId, animating }
    this.potSprites = new Map();
    this.tokens = {};          // id de joueur -> { mesh, badge, badgeKey, baseY, animating }
    this.currentRing = null;
    this.currentPlayerId = null;
    this._lightFactor = 1; // la foudre du Stun assombrit puis illumine la scène

    this._textures = {};
    this._labelTextures = new Map();
    this._tileMaterials = new Map(); // dessus, flancs et contours des cases

    this.clock = new THREE.Clock();
    this.animationId = null;
    this._elapsed = 0;
    this._tweens = [];

    this.cameraTilt = 50;
    this.cameraPan = 0;
    this.cameraDistance = 12;
    this.follow = true;
    this.environment = null;      // décor autour du plateau (île en mini-cubes)
    this.environmentVisible = true;
    this.beams = [];              // rayons entre cases reliées
    this._focus = null;        // point suivi par la caméra (joueur dont c'est le tour)
    this._focusObject = null;  // objet suivi pendant une animation
    this._oncePoint = null;    // recentrage ponctuel demandé alors que le suivi est coupé

    this._pick = null;
    this._pointer = null;
    this._hoverTileId = null;
    this._clickStart = null;
    this._lastViewKey = '';

    // Branchés par l'interface
    this.onTileHover = null;    // (tileId | null, clientX, clientY)
    this.onTileClick = null;    // (tileId, clientX, clientY)
    this.onViewChange = null;   // la caméra a bougé
    this.onFollowChange = null; // (bool) le suivi a été coupé par un déplacement manuel

    // Place prise par l'interface sur chaque bord (pixels) : valeur affichée, et valeur à rejoindre
    this._insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this._insetsGoal = { top: 0, right: 0, bottom: 0, left: 0 };
  }

  // === Initialisation ===

  init(wrapperEl) {
    this.wrapper = wrapperEl;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

    this.webglRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webglRenderer.shadowMap.enabled = true;
    this.webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.webglRenderer.domElement;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    wrapperEl.appendChild(canvas);

    // Souris : clic gauche pour tourner, clic droit pour déplacer, molette pour zoomer.
    // Doigts : un doigt déplace le plateau, deux doigts le font tourner et zoomer.
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 80;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    // Déplacer la vue fait glisser le plateau sur son plan : le point visé reste au sol
    this.controls.screenSpacePanning = false;

    this._toonGradient = createToonGradient();

    this.ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    this.scene.add(this.ambientLight);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.bias = -0.002;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.overlayGroup = new THREE.Group();
    this.scene.add(this.overlayGroup);
    this.pickGroup = new THREE.Group();
    this.scene.add(this.pickGroup);
    this.fxGroup = new THREE.Group(); // effets visuels des mains de cartes
    this.scene.add(this.fxGroup);

    // Géométries partagées
    this._unitBox = new THREE.BoxGeometry(1, 1, 1); // plaques des propriétaires et personnages, mis à l'échelle
    this._highlightGeom = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
    this._highlightGeom.rotateX(-Math.PI / 2);
    // Cases et Prize Cubes : arêtes arrondies, une seule géométrie partagée par tous
    this._shellGeometries = new Map();
    this._hullGeom = this._extrudeTile(null);
    this._slabGeom = new THREE.BoxGeometry(TILE_SIZE, SLAB_HEIGHT, TILE_SIZE);
    this._cubeGeom = new RoundedBoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE, 3, 0.12); // Prize Cube sans image
    this._reliefMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this._toonGradient });
    this._reliefGeometries = new Map();
    this._arrowGeom = this._createArrowGeometry();

    // Anneau doré sous le pion du joueur dont c'est le tour
    const ringGeom = new THREE.RingGeometry(0.3, 0.4, 32);
    ringGeom.rotateX(-Math.PI / 2);
    this.currentRing = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({
      color: 0xffd700, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.currentRing.visible = false;
    this.scene.add(this.currentRing);

    this.raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();

    // Écouteurs (tous retirés par dispose)
    this._listeners = new AbortController();
    const signal = this._listeners.signal;
    this._activePointers = new Set();
    this._gesture = null; // appui en cours : { x, y, touch, moved, multi }

    canvas.addEventListener('pointerdown', (e) => {
      this._activePointers.add(e.pointerId);
      const touch = e.pointerType === 'touch';
      if (this._activePointers.size >= 2) {
        if (this._gesture) this._gesture.multi = true;
      } else if (e.button === 0) {
        this._gesture = { x: e.clientX, y: e.clientY, touch, moved: false, multi: false };
      }
      this._autoFrame = false; // la vue est désormais réglée à la main
      // Déplacer la vue à la main (clic droit) coupe le suivi automatique du joueur
      if (e.button === 2 && !touch) this._setFollow(false, true);
    }, { signal });
    canvas.addEventListener('pointerup', (e) => {
      this._activePointers.delete(e.pointerId);
      const gesture = this._gesture;
      if (!gesture || this._activePointers.size > 0) return;
      this._gesture = null;
      // Un appui sans glissement, d'un seul doigt, vaut un clic
      if (e.button === 0 && !gesture.moved && !gesture.multi) this._onClick(e);
    }, { signal });
    canvas.addEventListener('pointercancel', (e) => {
      this._activePointers.delete(e.pointerId);
      if (this._activePointers.size === 0) this._gesture = null;
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      const gesture = this._gesture;
      if (gesture && !gesture.moved) {
        const dx = e.clientX - gesture.x;
        const dy = e.clientY - gesture.y;
        const slack = gesture.touch ? TAP_SLACK_TOUCH : TAP_SLACK_MOUSE;
        if (dx * dx + dy * dy > slack * slack) {
          gesture.moved = true;
          // Au doigt, faire glisser le plateau coupe le suivi automatique du joueur
          if (gesture.touch && !gesture.multi) this._setFollow(false, true);
        }
      }
      // Pas de survol au doigt : les informations d'une case s'affichent à l'appui (_onClick)
      if (e.pointerType === 'touch') return;
      this._pointer = { clientX: e.clientX, clientY: e.clientY, dragging: e.buttons !== 0, dirty: true };
    }, { signal });
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      this._pointer = null;
      this._setHover(null, e.clientX, e.clientY);
    }, { signal });
    canvas.addEventListener('contextmenu', e => e.preventDefault(), { signal });
    canvas.addEventListener('wheel', () => { this._autoFrame = false; }, { signal, passive: true });

    this._resize();
    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(wrapperEl);

    this._animate();
  }

  _resize() {
    const w = this.wrapper.clientWidth;
    const h = this.wrapper.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.webglRenderer.setSize(w, h);
    this._applyViewOffset();
  }

  // Place prise par l'interface sur chaque bord de la vue, en pixels : la caméra vise alors le
  // centre de la zone restée libre. Le passage d'un réglage à l'autre est progressif, sauf si
  // `immediate`.
  setViewInsets(insets, immediate = false) {
    for (const side of INSET_SIDES) this._insetsGoal[side] = Math.max(0, insets[side] || 0);
    if (immediate) {
      Object.assign(this._insets, this._insetsGoal);
      this._applyViewOffset();
    }
  }

  // Décale l'image pour que le point visé tombe au centre de la zone libre, puis recadre le
  // plateau tant que le joueur n'a pas réglé la vue lui-même
  _applyViewOffset() {
    const w = this.wrapper.clientWidth;
    const h = this.wrapper.clientHeight;
    if (w === 0 || h === 0) return;
    const { top, right, bottom, left } = this._insets;
    const dx = (left - right) / 2;
    const dy = (top - bottom) / 2;
    if (dx === 0 && dy === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -dx, -dy, w, h);

    if (this._autoFrame && this._bounds) {
      this.cameraDistance = this._fitDistance();
      this._applyCameraAngles();
    }
  }

  // Flèche plate pointant vers +X, posée à l'horizontale
  _createArrowGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.3, -0.12);
    shape.lineTo(0.05, -0.12);
    shape.lineTo(0.05, -0.28);
    shape.lineTo(0.4, 0);
    shape.lineTo(0.05, 0.28);
    shape.lineTo(0.05, 0.12);
    shape.lineTo(-0.3, 0.12);
    shape.closePath();
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);
    return geom;
  }

  // === Boucle de rendu ===

  _animate() {
    this.animationId = requestAnimationFrame(() => this._animate());
    // Temps réel pour les animations (elles doivent finir à l'heure même si l'onglet rame),
    // temps plafonné pour le reste (flottement, caméra)
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.25);
    this._elapsed += dt;
    const time = this._elapsed;

    // Animations en cours
    for (let i = this._tweens.length - 1; i >= 0; i--) {
      const tween = this._tweens[i];
      tween.elapsed += rawDt;
      const k = Math.min(1, tween.elapsed / tween.duration);
      tween.update(k);
      if (k >= 1) {
        this._tweens.splice(i, 1);
        tween.resolve();
      }
    }

    // Décor : les nuages dérivent
    if (this.environment && this.environmentVisible) this.environment.update(dt);

    // Rayons entre cases reliées : le halo respire, les étincelles filent
    for (const beam of this.beams) beam.update(time);

    // Personnages : ils respirent au repos et balancent pieds et mains en avançant
    for (const token of Object.values(this.tokens)) {
      if (!token.mesh.visible) continue;
      token.pawn.pose(time + token.phase, token.stride);
      if (token.animating) continue;
      token.mesh.position.y = token.baseY;
      // Au repos, le personnage se tourne vers la caméra : de face, on voit ses deux mains
      const facing = Math.atan2(this.camera.position.x - token.mesh.position.x, this.camera.position.z - token.mesh.position.z);
      const turn = facing - token.mesh.rotation.y;
      token.mesh.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 5);
      this._placeBadge(token);
    }

    // Étiquette des Prize Cubes libres
    for (const cubeObj of Object.values(this.cubeObjs)) {
      if (!cubeObj.badge) continue;
      cubeObj.badge.visible = !cubeObj.animating;
      cubeObj.badge.position.set(cubeObj.mesh.position.x, cubeObj.mesh.position.y + TILE_SIZE / 2 + 0.22, cubeObj.mesh.position.z);
    }

    // Anneau du joueur courant
    const current = this.tokens[this.currentPlayerId];
    if (current && current.mesh.visible && !current.animating) {
      this.currentRing.visible = true;
      // Un peu au-dessus des pieds : sur une case, l'anneau passe ainsi par-dessus le rebord
      this.currentRing.position.set(current.mesh.position.x, current.baseY + 0.07, current.mesh.position.z);
      this.currentRing.scale.setScalar(1 + Math.sin(time * 4) * 0.08);
    } else {
      this.currentRing.visible = false;
    }

    // Flèches et surbrillances de choix
    if (this._pick) {
      const pulse = 0.5 + Math.sin(time * 5) * 0.5;
      for (const marker of this._pick.markers) {
        const hovered = marker.userData.tileId === this._hoverTileId;
        if (marker.userData.isArrow) {
          const { base, dir } = marker.userData;
          const slide = pulse * 0.12;
          marker.position.set(base.x + dir.x * slide, base.y, base.z + dir.z * slide);
          marker.scale.setScalar(hovered ? 1.35 : 1);
        } else {
          marker.material.opacity = hovered ? 0.85 : 0.25 + pulse * 0.3;
        }
      }
    }

    // Caméra : glisse vers le point suivi en gardant son angle et sa distance
    if (this._focusObject) {
      this._focus = this._focus || new THREE.Vector3();
      this._focus.set(this._focusObject.position.x, 0, this._focusObject.position.z);
    }
    // Une case à montrer passe avant le joueur suivi (si le suivi est actif)
    const goal = this.follow ? (this._spotPoint || this._focus) : this._oncePoint;
    if (goal) {
      const delta = this._tmp.copy(goal).sub(this.controls.target);
      delta.y = 0;
      if (delta.lengthSq() < 0.0001) {
        this._oncePoint = null;
      } else {
        delta.multiplyScalar(1 - Math.exp(-dt * 5));
        this.controls.target.add(delta);
        this.camera.position.add(delta);
      }
    }

    // Zone libre de l'écran : le décalage de la vue rejoint peu à peu sa cible
    let shifting = false;
    for (const side of INSET_SIDES) {
      const gap = this._insetsGoal[side] - this._insets[side];
      if (gap === 0) continue;
      this._insets[side] = Math.abs(gap) < 0.5 ? this._insetsGoal[side] : this._insets[side] + gap * (1 - Math.exp(-dt * 9));
      shifting = true;
    }
    if (shifting) this._applyViewOffset();

    this.controls.update();
    this._updateHover();
    this._notifyViewChange();
    this.webglRenderer.render(this.scene, this.camera);
  }

  _tmp = new THREE.Vector3();

  _tween(durationMs, update) {
    return new Promise((resolve) => {
      this._tweens.push({ elapsed: 0, duration: Math.max(durationMs, 1) / 1000, update, resolve });
    });
  }

  _notifyViewChange() {
    if (!this.onViewChange) return;
    const p = this.camera.position;
    const t = this.controls.target;
    const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)},${t.x.toFixed(2)},${t.z.toFixed(2)}`;
    if (key !== this._lastViewKey) {
      this._lastViewKey = key;
      this.onViewChange();
    }
  }

  // === Textures et matériaux partagés ===

  // Matériau uni (dessus et dessous du corps d'une case, plaque du propriétaire)
  _plainMaterial(colorHex) {
    const key = `plain|${colorHex}`;
    if (!this._tileMaterials.has(key)) {
      this._tileMaterials.set(key, new THREE.MeshToonMaterial({ color: colorHex, gradientMap: this._toonGradient }));
    }
    return this._tileMaterials.get(key);
  }

  // Corps d'un cube : contour carré aux coins arrondis, monté sur toute la hauteur de la case.
  // Avec `artSize`, le centre est évidé (tout sauf l'anneau extérieur de l'image) : le dessus du
  // corps est alors le rebord, et le dessin vient se loger dans le trou. Sans, le corps est plein.
  // Groupes de matériaux : 0 = dessus et dessous, 1 = flancs.
  _extrudeTile(artSize) {
    const h = TILE_SIZE / 2;
    const r = TILE_CORNER_RADIUS;
    const shape = new THREE.Shape();
    shape.moveTo(-h + r, -h);
    shape.lineTo(h - r, -h);
    shape.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(h, h - r);
    shape.absarc(h - r, h - r, r, 0, Math.PI / 2, false);
    shape.lineTo(-h + r, h);
    shape.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(-h, -h + r);
    shape.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false);

    const inner = artSize ? h - TILE_SIZE / artSize : 0;
    if (artSize) {
      const hole = new THREE.Path();
      hole.moveTo(-inner, -inner);
      hole.lineTo(-inner, inner);
      hole.lineTo(inner, inner);
      hole.lineTo(inner, -inner);
      hole.closePath();
      shape.holes.push(hole);
    }

    const geom = new THREE.ExtrudeGeometry(shape, { depth: TILE_HEIGHT, bevelEnabled: false, curveSegments: 4 });
    geom.rotateX(-Math.PI / 2);               // l'extrusion devient la hauteur
    geom.translate(0, -TILE_HEIGHT / 2, 0);   // centré, comme une boîte

    // Flancs : la texture couvre toute la face, du sol au sommet. Les parois de la cuvette
    // prennent la teinte claire du haut de la texture.
    const pos = geom.attributes.position;
    const normal = geom.attributes.normal;
    const uv = geom.attributes.uv;
    const innerLimit = (inner + h - r) / 2;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(normal.getY(i)) > 0.5) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (artSize && Math.max(Math.abs(x), Math.abs(z)) < innerLimit) {
        uv.setXY(i, 0.5, 0.9);
        continue;
      }
      const u = Math.abs(normal.getX(i)) > Math.abs(normal.getZ(i)) ? z + h : x + h;
      uv.setXY(i, u / TILE_SIZE, (pos.getY(i) + TILE_HEIGHT / 2) / TILE_HEIGHT);
    }
    uv.needsUpdate = true;
    return geom;
  }

  _shellGeometry(artSize) {
    if (!this._shellGeometries.has(artSize)) this._shellGeometries.set(artSize, this._extrudeTile(artSize));
    return this._shellGeometries.get(artSize);
  }

  // Dessin d'une face, sculpté d'après son image : un petit pavé par pixel, dont la hauteur dépend
  // de son rôle (fond, motif, emplacement en creux) et la couleur du pixel. Posé sur y = 0 et
  // centré ; partagé par toutes les cases de même image.
  // `withRim` : inclure l'anneau extérieur (dalles et Prize Cube). Sans lui, les pixels gardent
  // leur place sur la face : le rebord est fourni par le corps du cube.
  _reliefGeometry(key, art, faceSize, scale, withRim) {
    const cacheKey = `${key}|${faceSize}|${scale}|${withRim}`;
    if (this._reliefGeometries.has(cacheKey)) return this._reliefGeometries.get(cacheKey);

    const margin = withRim ? faceSize * FACE_MARGIN : 0;
    const unit = (faceSize - 2 * margin) / art.size;
    const origin = -faceSize / 2 + margin;
    const color = new THREE.Color();
    const parts = [];
    for (const cell of art.cells) {
      if (cell.kind === 'rim' && !withRim) continue;
      const height = RELIEF[cell.kind] * scale;
      const box = new THREE.BoxGeometry(unit, height, unit);
      box.translate(origin + (cell.x + 0.5) * unit, height / 2, origin + (cell.y + 0.5) * unit);
      color.setHex(cell.color);
      const colors = new Float32Array(box.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = color.r;
        colors[i + 1] = color.g;
        colors[i + 2] = color.b;
      }
      box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(box);
    }
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    this._reliefGeometries.set(cacheKey, merged);
    return merged;
  }

  // Emplacement en creux d'une image (pixels transparents) : centre et taille sur la face
  _slotOf(art) {
    let slots = art ? art.cells.filter(c => c.kind === 'slot') : [];
    // Pas d'emplacement en creux (case Bonus) : la plaque viendra recouvrir le motif central
    const overMotif = slots.length === 0;
    if (overMotif) slots = art ? art.cells.filter(c => c.kind === 'motif') : [];
    if (slots.length === 0) return null;
    const unit = TILE_SIZE / art.size;
    const xs = slots.map(c => c.x);
    const ys = slots.map(c => c.y);
    const mid = (min, max) => ((min + max + 1) / 2 - art.size / 2) * unit;
    return {
      x: mid(Math.min(...xs), Math.max(...xs)),
      z: mid(Math.min(...ys), Math.max(...ys)),
      width: (Math.max(...xs) - Math.min(...xs) + 1) * unit,
      depth: (Math.max(...ys) - Math.min(...ys) + 1) * unit,
      overMotif,
    };
  }

  // Flanc d'une case : dégradé par paliers et panneau en creux, dessinés en pixel art
  // à partir de la couleur de la case. `accentHex` : couleur du motif d'une case Bonus,
  // rappelée au milieu du panneau pour qu'on la reconnaisse aussi de côté.
  _sideMaterial(colorHex, accentHex = null) {
    const key = `side|${colorHex}|${accentHex}`;
    if (!this._tileMaterials.has(key)) {
      // Nuance d'une couleur : vers le blanc si amount > 0, vers le sombre sinon
      const tone = (hex, amount) => {
        const c = new THREE.Color(hex);
        if (amount >= 0) c.lerp(new THREE.Color(0xffffff), amount);
        else c.lerp(new THREE.Color(0x05061a), -amount);
        return `#${c.getHexString()}`;
      };
      const shade = amount => tone(colorHex, amount);
      const N = 16; // grille de 16 × 16 « pixels »
      const canvas = document.createElement('canvas');
      canvas.width = N;
      canvas.height = N;
      const ctx = canvas.getContext('2d');
      // Paliers du haut (clair) vers le bas (sombre)
      const bands = [[0, 1, 0.45], [1, 2, 0.2], [3, 6, 0], [9, 4, -0.14], [13, 2, -0.3], [15, 1, -0.5]];
      for (const [y, h, amount] of bands) {
        ctx.fillStyle = shade(amount);
        ctx.fillRect(0, y, N, h);
      }
      // Panneau en creux : bord sombre en haut et à gauche, reflet en bas et à droite
      ctx.fillStyle = shade(-0.22);
      ctx.fillRect(3, 4, 10, 8);
      ctx.fillStyle = shade(-0.4);
      ctx.fillRect(3, 4, 10, 1);
      ctx.fillRect(3, 4, 1, 8);
      ctx.fillStyle = shade(0.12);
      ctx.fillRect(4, 11, 9, 1);
      ctx.fillRect(12, 5, 1, 7);
      if (accentHex === null) {
        // Petit éclat lumineux dans le panneau
        ctx.fillStyle = shade(0.35);
        ctx.fillRect(5, 6, 2, 1);
        ctx.fillRect(5, 7, 1, 1);
      } else {
        // Pavé à la couleur du motif, avec son reflet en haut et son ombre en bas
        ctx.fillStyle = tone(accentHex, 0);
        ctx.fillRect(5, 6, 6, 4);
        ctx.fillStyle = tone(accentHex, 0.4);
        ctx.fillRect(5, 6, 6, 1);
        ctx.fillStyle = tone(accentHex, -0.22);
        ctx.fillRect(5, 9, 6, 1);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      this._textures[key] = tex;
      this._tileMaterials.set(key, new THREE.MeshToonMaterial({ map: tex, gradientMap: this._toonGradient }));
    }
    return this._tileMaterials.get(key);
  }

  // Contour façon dessin animé : la même forme, un peu plus grande, dont on ne voit que l'envers
  _outline(geometry, colorHex) {
    const key = `outline|${colorHex}`;
    if (!this._tileMaterials.has(key)) {
      const color = new THREE.Color(colorHex).lerp(new THREE.Color(0x05061a), 0.72);
      this._tileMaterials.set(key, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
    }
    const hull = new THREE.Mesh(geometry, this._tileMaterials.get(key));
    hull.scale.setScalar(1.045);
    hull.raycast = () => {}; // le contour ne compte pas pour les clics
    return hull;
  }

  // Étiquette en pixel art (police bitmap, icônes à la place des émojis, plaque à bord net),
  // rendue dans une texture et mise en cache par contenu. options : { bg, fg } ; bg: null
  // donne un dessin nu, sans plaque (symboles des effets, pot de miel).
  _labelMaterial(text, options = {}) {
    const key = `${text}|${options.bg}|${options.fg}`;
    if (!this._labelTextures.has(key)) {
      const canvas = pixelLabelCanvas(text, options);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      // De près, les points restent des carrés nets ; de loin, ils se fondent sans scintiller
      tex.magFilter = THREE.NearestFilter;
      const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
      material.userData.aspect = canvas.width / canvas.height;
      this._labelTextures.set(key, material);
    }
    return this._labelTextures.get(key);
  }

  _labelSprite(text, height, options) {
    const material = this._labelMaterial(text, options);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(height * material.userData.aspect, height, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  // === Génération du plateau ===

  // Asynchrone : attend la lecture des images qui servent de modèle aux cases
  async generateBoard(boardData) {
    const { tiles, rows, cols, zones, posToId, _rawGrid } = boardData;
    this.rows = rows;
    this.cols = cols;
    this.tileMeshes = {};
    this.tileCenters = {};

    const zonePanelMap = {};
    if (zones && zones.length > 0) {
      const indices = getZonePanelIndices(zones.length);
      zones.forEach((zone, i) => { zonePanelMap[zone.id] = indices[i]; });
    }

    // Image modèle de chaque case
    const artPathOf = (tile) => {
      const panelIndex = tile.type === TileType.NORMAL && tile.zone ? zonePanelMap[tile.zone] : null;
      return panelIndex ? `images/coloredCommandPanel/${panelIndex}.png` : (TILE_TEXTURES[tile.type] || null);
    };
    const paths = [...new Set([TILE_TEXTURES.dice, ...tiles.map(artPathOf).filter(Boolean)])];
    const arts = Object.fromEntries(await Promise.all(paths.map(async path => [path, await loadTileArt(path)])));
    if (!this.scene) return; // la vue a été fermée pendant le chargement
    this._diceArt = arts[TILE_TEXTURES.dice];
    this._slots = {};

    this.boardGroup = new THREE.Group();
    this.beams = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rawCell = _rawGrid?.[r]?.[c];
        if (!rawCell || !rawCell.type) continue;

        const x = c * SPACING;
        const z = r * SPACING;

        if (rawCell.type === 'teleporter') {
          continue; // les rayons sont créés plus bas, un par lien
        }

        const tileId = posToId[`${r},${c}`];
        const tile = tileId !== undefined ? tiles[tileId] : null;
        if (!tile) continue;

        const artPath = artPathOf(tile);
        const art = artPath ? arts[artPath] : null;
        const bodyColor = art ? art.body : (TILE_SIDE_COLORS[tile.type] || 0x888888);

        let mesh;
        if (tile.type === TileType.DAMAGE) {
          // Case de dégâts : dalle basse, dessin en léger relief
          mesh = new THREE.Mesh(this._slabGeom, this._plainMaterial(bodyColor));
          mesh.position.set(x, SLAB_HEIGHT / 2, z);
          this.tileCenters[tileId] = { x, z, top: DAMAGE_TILE_HEIGHT, stand: DAMAGE_TILE_HEIGHT };
          if (art) {
            const relief = new THREE.Mesh(
              this._reliefGeometry(artPath, art, TILE_SIZE, SLAB_RELIEF_SCALE, true),
              this._reliefMaterial,
            );
            relief.position.y = SLAB_HEIGHT / 2;
            relief.receiveShadow = true;
            mesh.add(relief);
          }
        } else {
          // Cube : flancs sur toute la hauteur ; le dessus est le rebord de l'image, évidé en son
          // centre, et le dessin est posé au fond de la cuvette
          const geometry = art ? this._shellGeometry(art.size) : this._hullGeom;
          // Case Bonus : son flanc reprend le jaune de son motif. Sans cela, de côté, rien ne la
          // distingue d'une case commande grise.
          const accent = art && tile.type === TileType.BONUS ? art.motif : null;
          mesh = new THREE.Mesh(geometry, [this._plainMaterial(art ? art.rim : bodyColor), this._sideMaterial(bodyColor, accent)]);
          mesh.position.set(x, TILE_HEIGHT / 2, z);
          mesh.castShadow = true;
          mesh.add(this._outline(this._hullGeom, bodyColor));
          this.tileCenters[tileId] = { x, z, top: TILE_HEIGHT, stand: TILE_STAND };
          if (art) {
            const relief = new THREE.Mesh(
              this._reliefGeometry(artPath, art, TILE_SIZE, 1, false),
              this._reliefMaterial,
            );
            relief.position.y = TILE_HEIGHT / 2 - RELIEF.rim;
            relief.castShadow = true; // referme l'ombre portée du cube, évidé en son centre
            relief.receiveShadow = true;
            mesh.add(relief);
            this._slots[tileId] = this._slotOf(art);
          }
        }
        mesh.receiveShadow = true;
        mesh.userData.tileId = tileId;
        this.tileMeshes[tileId] = mesh;
        this.boardGroup.add(mesh);
      }
    }
    for (const link of boardData.links || []) this._createTeleporter(link);
    this.scene.add(this.boardGroup);

    // Cadrage et éclairage à l'échelle du plateau
    const cx = (cols - 1) * SPACING / 2;
    const cz = (rows - 1) * SPACING / 2;
    const extent = Math.max(rows, cols) * SPACING;

    this.dirLight.position.set(cx + extent * 0.3, extent * 1.2, cz - extent * 0.2);
    this.dirLight.target.position.set(cx, 0, cz);
    const s = extent * 0.85;
    Object.assign(this.dirLight.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: extent * 4 });
    this.dirLight.shadow.camera.updateProjectionMatrix();

    // Cadrage de départ : sur la zone réellement occupée par les cases (et non la grille entière),
    // à la distance qui la fait tenir dans la fenêtre
    const centers = Object.values(this.tileCenters);
    const xs = centers.map(c => c.x);
    const zs = centers.map(c => c.z);
    this._bounds = centers.length > 0
      ? { minX: Math.min(...xs) - TILE_SIZE / 2, maxX: Math.max(...xs) + TILE_SIZE / 2, minZ: Math.min(...zs) - TILE_SIZE / 2, maxZ: Math.max(...zs) + TILE_SIZE / 2 }
      : { minX: 0, maxX: cx * 2, minZ: 0, maxZ: cz * 2 };
    // Décor autour du plateau : une île en mini-cubes, propre à chaque plateau
    let seed = rows * 73 + cols * 31 + tiles.length * 7;
    for (const tile of tiles) seed = (Math.imul(seed, 31) + tile.row * 17 + tile.col) >>> 0;
    this.environment = buildEnvironment({
      tiles: centers.map(c => ({ x: c.x, z: c.z })),
      bounds: this._bounds,
      gradientMap: this._toonGradient,
      seed,
    });
    this.environment.group.visible = this.environmentVisible;
    this.scene.add(this.environment.group);
    this._applyLighting();

    this._autoFrame = true;
    this.controls.target.set((this._bounds.minX + this._bounds.maxX) / 2, 0, (this._bounds.minZ + this._bounds.maxZ) / 2);
    this.cameraDistance = this._fitDistance();
    this._applyCameraAngles();
  }

  // Distance de caméra adaptée au plateau et à la fenêtre : celle d'où la zone occupée par les
  // cases tient à l'écran, compte tenu de l'inclinaison. Pour un grand plateau on s'arrête avant,
  // à la distance où les cases restent lisibles (le suivi du joueur fait le reste).
  _fitDistance() {
    const { minX, maxX, minZ, maxZ } = this._bounds;
    const halfWidth = (maxX - minX) / 2;
    const halfDepth = (maxZ - minZ) / 2;
    const tilt = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(this.cameraTilt, 1, 85));
    const sin = Math.sin(tilt);
    const cos = Math.cos(tilt);
    // Seule la zone que l'interface laisse libre compte pour faire tenir le plateau
    const width = this.wrapper.clientWidth;
    const height = this.wrapper.clientHeight;
    const freeW = Math.max(0.3, 1 - (this._insets.left + this._insets.right) / width);
    const freeH = Math.max(0.3, 1 - (this._insets.top + this._insets.bottom) / height);
    const tanFull = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const tanV = tanFull * freeH;
    const tanH = tanFull * this.camera.aspect * freeW;

    // Largeur : le bord le plus proche de la caméra est celui qui paraît le plus large
    const forWidth = halfWidth / tanH + halfDepth * sin;
    // Profondeur : bord proche en bas de l'écran, sommet des cubes du fond en haut
    const forNearEdge = halfDepth * (cos / tanV + sin);
    const forFarEdge = (halfDepth * cos + TILE_HEIGHT * sin) / tanV - halfDepth * sin;
    const fit = Math.max(forWidth, forNearEdge, forFarEdge) * 1.15;

    // Taille minimale d'une case à l'écran : 50 pixels, un peu moins sur un petit écran pour
    // garder une vue d'ensemble
    const minTilePixels = THREE.MathUtils.clamp(Math.min(width, height) / 8, 38, 50);
    const readable = height / (minTilePixels * 2 * tanFull);
    return THREE.MathUtils.clamp(Math.min(fit, readable), 6, 60);
  }

  // Un rayon lumineux par lien, d'une seule pièce entre les deux cases reliées
  _createTeleporter(link) {
    const isH = link.direction === 'horizontal';
    const n = link.cells.length;
    const [r0, c0] = link.cells[0];
    const [r1, c1] = link.cells[n - 1];
    // D'une face de case à l'autre : les cellules du lien, plus l'interstice de chaque côté
    const length = (n - 1) * SPACING + TILE_SIZE + 2 * GAP;
    const center = new THREE.Vector3((c0 + c1) / 2 * SPACING, 0, (r0 + r1) / 2 * SPACING);
    const half = new THREE.Vector3(isH ? length / 2 : 0, 0, isH ? 0 : length / 2);
    const beam = buildBeam({
      start: center.clone().sub(half),
      end: center.clone().add(half),
      height: TILE_HEIGHT,
      gradientMap: this._toonGradient,
    });
    this.boardGroup.add(beam.group);
    this.beams.push(beam);
  }

  // === Caméra ===

  setCameraTilt(deg) {
    this.cameraTilt = deg;
    this._applyCameraAngles(true);
  }

  setCameraPan(deg) {
    this.cameraPan = deg;
    this._applyCameraAngles(true);
  }

  _applyCameraAngles(keepDistance = false) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const radius = keepDistance && offset.lengthSq() > 0 ? offset.length() : this.cameraDistance;
    const spherical = new THREE.Spherical(
      radius,
      THREE.MathUtils.degToRad(THREE.MathUtils.clamp(this.cameraTilt, 1, 85)),
      -THREE.MathUtils.degToRad(this.cameraPan),
    );
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  // Affiche ou masque le décor autour du plateau (à couper sur une machine peu puissante)
  setEnvironmentVisible(visible) {
    this.environmentVisible = visible;
    if (this.environment) this.environment.group.visible = visible;
    this._applyLighting();
  }

  // Teinte de la lumière : celle de l'ambiance (jour, coucher de soleil, nuit) tant que le décor
  // est affiché, neutre sinon
  _applyLighting() {
    const lighting = this.environment && this.environmentVisible
      ? this.environment.lighting
      : { ambient: '#ffffff', ambientIntensity: 1.8, light: '#ffffff', lightIntensity: 2.5 };
    this.ambientLight.color.set(lighting.ambient);
    this.ambientLight.intensity = lighting.ambientIntensity * this._lightFactor;
    this.dirLight.color.set(lighting.light);
    this.dirLight.intensity = lighting.lightIntensity * this._lightFactor;
  }

  // Assombrit ou illumine toute la scène (1 : la lumière normale de l'ambiance)
  _setLightFactor(factor) {
    if (factor === this._lightFactor) return;
    this._lightFactor = factor;
    this._applyLighting();
  }

  // Active ou coupe le suivi automatique du joueur dont c'est le tour
  setFollow(follow) {
    this._setFollow(follow, false);
  }

  _setFollow(follow, fromUser) {
    if (this.follow === follow) return;
    this.follow = follow;
    this._oncePoint = null;
    if (follow) this._focusCurrentPlayer();
    if (fromUser && this.onFollowChange) this.onFollowChange(follow);
  }

  // Amène la caméra sur une case choisie à la main, ce qui coupe le suivi automatique
  focusTile(tileId) {
    const center = this.tileCenters[tileId];
    if (!center) return;
    this._setFollow(false, true);
    this._oncePoint = new THREE.Vector3(center.x, 0, center.z);
  }

  _focusCurrentPlayer() {
    const token = this.tokens[this.currentPlayerId];
    if (token && token.mesh.visible) {
      this._focus = new THREE.Vector3(token.mesh.position.x, 0, token.mesh.position.z);
    }
  }

  // Flèche (←, ↗, …) indiquant où se trouve, à l'écran, la case voisine `toTileId`
  screenArrow(fromTileId, toTileId) {
    const from = this.tileCenters[fromTileId];
    const dir = this._gridDirection(fromTileId, toTileId);
    if (!from || !dir) return '';
    const a = new THREE.Vector3(from.x, from.top, from.z).project(this.camera);
    const b = new THREE.Vector3(from.x + dir.x, from.top, from.z + dir.z).project(this.camera);
    const angle = Math.atan2(b.y - a.y, (b.x - a.x) * this.camera.aspect);
    const index = Math.round(angle / (Math.PI / 4));
    return SCREEN_ARROWS[((index % 8) + 8) % 8];
  }

  // Direction unitaire (sur la grille) d'une case vers une autre, liens compris
  _gridDirection(fromTileId, toTileId) {
    const from = this.tileCenters[fromTileId];
    const to = this.tileCenters[toTileId];
    if (!from || !to) return null;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.abs(dx) >= Math.abs(dz)) return { x: Math.sign(dx) || 1, z: 0 };
    return { x: 0, z: Math.sign(dz) };
  }

  // === Synchronisation avec l'état du moteur ===

  sync(game) {
    if (!this.scene) return;
    this.game = game;
    this.currentPlayerId = game.over ? null : game.currentPlayer.id;

    this._syncOwnership(game);
    this._syncCubes(game);
    this._syncPots(game);
    this._syncTokens(game);

    if (!this._focusObject) this._focusCurrentPlayer();
  }

  // Marque de couleur et niveau sur les cases possédées (seules les cases modifiées sont refaites)
  _syncOwnership(game) {
    for (const tile of game.tiles) {
      if (tile.type !== TileType.NORMAL && tile.type !== TileType.BONUS) continue;
      const key = tile.owner === null ? '' : `${tile.owner}|${tile.level}`;
      if ((this._ownKeys[tile.id] || '') === key) continue;
      this._ownKeys[tile.id] = key;

      for (const obj of this._ownObjects[tile.id] || []) this.overlayGroup.remove(obj);
      this._ownObjects[tile.id] = [];
      if (tile.owner === null) continue;

      const center = this.tileCenters[tile.id];
      // Plaque à la couleur du propriétaire, logée dans l'emplacement en creux de la case
      const slot = this._slots?.[tile.id] || { x: 0, z: 0, width: TILE_SIZE * 0.42, depth: TILE_SIZE * 0.42 };
      // Sur une case Bonus, la plaque recouvre le motif en laissant dépasser un liseré
      const thickness = slot.overMotif ? 0.07 : 0.05;
      const fill = slot.overMotif ? 0.8 : 0.94;
      const mark = new THREE.Mesh(this._unitBox, this._plainMaterial(new THREE.Color(game.players[tile.owner].color).getHex()));
      mark.scale.set(slot.width * fill, thickness, slot.depth * fill);
      mark.userData.baseScale = mark.scale.clone();
      mark.position.set(center.x + slot.x, center.top - RELIEF.rim + RELIEF.slot + thickness / 2, center.z + slot.z);
      mark.receiveShadow = true;

      const level = this._labelSprite(`Nv ${tile.level}`, 0.24);
      level.position.set(center.x + TILE_SIZE * 0.22, center.top + 0.18, center.z + TILE_SIZE * 0.22);

      this._ownObjects[tile.id] = [mark, level];
      this.overlayGroup.add(mark, level);
    }
  }

  _cubeRestPosition(tileId) {
    const center = this.tileCenters[tileId];
    return new THREE.Vector3(center.x, DAMAGE_TILE_HEIGHT + TILE_SIZE / 2, center.z);
  }

  // Pavé coloré (couleur portée par les sommets), prêt à être fusionné avec d'autres
  _coloredBox(width, height, depth, x, y, z, colorHex) {
    const box = new THREE.BoxGeometry(width, height, depth);
    box.translate(x, y, z);
    const color = new THREE.Color(colorHex);
    const colors = new Float32Array(box.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }
    box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return box;
  }

  // Prize Cube : un cube aux arêtes arrondies, d'un seul tenant, dont chaque face est creusée
  // pour recevoir le dessin de l'image. Aucune pièce rapportée, donc aucune arête saillante.
  // Retourne { frame, hull, inside } (géométries partagées par tous les Prize Cubes).
  _diceGeometries(art) {
    if (this._diceGeoms) return this._diceGeoms;

    const half = TILE_SIZE / 2;
    const radius = TILE_SIZE / art.size;   // l'arrondi occupe l'anneau extérieur de l'image
    const flat = half - radius;            // demi-côté de la partie plane d'une face
    const depth = RELIEF.rim * DICE_RELIEF_SCALE;
    const eps = 1e-4;

    // Cadre : cube arrondi dont on retire le carré plan au centre de chaque face
    const hull = new RoundedBoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE, 4, radius);
    const pos = hull.attributes.position;
    const kept = { position: [], normal: [], uv: [] };
    const coord = (i, axis) => (axis === 0 ? pos.getX(i) : axis === 1 ? pos.getY(i) : pos.getZ(i));
    for (let i = 0; i < pos.count; i += 3) {
      const corners = [i, i + 1, i + 2];
      let isFaceCenter = false;
      for (let axis = 0; axis < 3 && !isFaceCenter; axis++) {
        const onFace = corners.every(v => Math.abs(coord(v, axis)) > half - eps);
        const inFlat = corners.every(v => [0, 1, 2].every(a => a === axis || Math.abs(coord(v, a)) <= flat + eps));
        isFaceCenter = onFace && inFlat;
      }
      if (isFaceCenter) continue;
      for (const v of corners) {
        kept.position.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        kept.normal.push(hull.attributes.normal.getX(v), hull.attributes.normal.getY(v), hull.attributes.normal.getZ(v));
        kept.uv.push(hull.attributes.uv.getX(v), hull.attributes.uv.getY(v));
      }
    }
    const frame = new THREE.BufferGeometry();
    frame.setAttribute('position', new THREE.Float32BufferAttribute(kept.position, 3));
    frame.setAttribute('normal', new THREE.Float32BufferAttribute(kept.normal, 3));
    frame.setAttribute('uv', new THREE.Float32BufferAttribute(kept.uv, 2));

    // Intérieur d'une face (vue de dessus) : le dessin au fond du creux, et les 4 parois du creux
    // Parois fines et limitées au côté du creux : rien ne doit dépasser de l'arrondi du cadre
    const wall = 0.006;
    const wallHeight = depth - 0.002;
    const wallY = half - depth + wallHeight / 2;
    const top = mergeGeometries([
      this._reliefGeometry('dice', art, TILE_SIZE, DICE_RELIEF_SCALE, false).clone().translate(0, half - depth, 0),
      this._coloredBox(wall, wallHeight, 2 * flat, flat + wall / 2, wallY, 0, art.body),
      this._coloredBox(wall, wallHeight, 2 * flat, -(flat + wall / 2), wallY, 0, art.body),
      this._coloredBox(2 * flat, wallHeight, wall, 0, wallY, flat + wall / 2, art.body),
      this._coloredBox(2 * flat, wallHeight, wall, 0, wallY, -(flat + wall / 2), art.body),
    ]);
    // Les six faces, plus un noyau qui bouche le cube. Le noyau s'arrête à la partie plane des
    // faces : plus grand, ses coins perceraient les coins arrondis du cadre.
    const core = 2 * flat;
    const inside = mergeGeometries([
      top,
      top.clone().rotateX(Math.PI),
      top.clone().rotateX(Math.PI / 2),
      top.clone().rotateX(-Math.PI / 2),
      top.clone().rotateZ(Math.PI / 2),
      top.clone().rotateZ(-Math.PI / 2),
      this._coloredBox(core, core, core, 0, 0, 0, art.body),
    ]);

    this._diceGeoms = { frame, hull, inside };
    return this._diceGeoms;
  }

  _syncCubes(game) {
    for (const cube of game.prizeCubes) {
      let obj = this.cubeObjs[cube.id];
      if (!obj) {
        const art = this._diceArt;
        let mesh;
        if (art) {
          const { frame, hull, inside } = this._diceGeometries(art);
          mesh = new THREE.Mesh(frame, this._plainMaterial(art.rim));
          mesh.add(this._outline(hull, art.body));
          const content = new THREE.Mesh(inside, this._reliefMaterial);
          content.castShadow = true;
          content.receiveShadow = true;
          content.raycast = () => {};
          mesh.add(content);
        } else {
          mesh = new THREE.Mesh(this._cubeGeom, this._plainMaterial(0x7b43f8));
          mesh.add(this._outline(this._cubeGeom, 0x7b43f8));
        }
        mesh.castShadow = true;
        mesh.position.copy(this._cubeRestPosition(cube.tileId));
        this.overlayGroup.add(mesh);
        obj = this.cubeObjs[cube.id] = { mesh, tileId: cube.tileId, animating: false, badge: null, badgeKey: '' };
      } else if (!obj.animating && obj.tileId !== cube.tileId) {
        // Le cube s'est brisé et réapparaît à sa case d'origine
        obj.mesh.position.copy(this._cubeRestPosition(cube.tileId));
        obj.mesh.quaternion.identity();
        obj.tileId = cube.tileId;
      }

      // Pas restants avant que le cube se brise (quand il est chevauché, c'est l'étiquette du
      // cavalier qui les affiche)
      const badgeText = cube.riderId === null ? `${cube.counter} pas` : '';
      if (obj.badgeKey !== badgeText) {
        if (obj.badge) this.overlayGroup.remove(obj.badge);
        obj.badge = badgeText ? this._labelSprite(badgeText, 0.24) : null;
        if (obj.badge) this.overlayGroup.add(obj.badge);
        obj.badgeKey = badgeText;
      }
    }
  }

  _syncPots(game) {
    const wanted = new Set(game.honeyPots.map(p => p.tileId));
    for (const [tileId, sprite] of this.potSprites) {
      if (!wanted.has(tileId)) {
        this.overlayGroup.remove(sprite);
        this.potSprites.delete(tileId);
      }
    }
    for (const tileId of wanted) {
      if (this.potSprites.has(tileId)) continue;
      const center = this.tileCenters[tileId];
      const sprite = this._labelSprite('🍯', 0.5, { bg: null });
      sprite.position.set(center.x - TILE_SIZE * 0.2, center.top + 0.35, center.z - TILE_SIZE * 0.2);
      this.potSprites.set(tileId, sprite);
      this.overlayGroup.add(sprite);
    }
  }

  _statusText(game, player) {
    const parts = [];
    const cube = game.cubeOf(player.id);
    if (cube) parts.push(`🎲 ${cube.counter} pas`);
    if (player.stunned) parts.push('⚡');
    if (player.confusedTurns > 0) parts.push(`❓${player.confusedTurns}`);
    if (player.gpProtector > 0) parts.push(`🛡️${player.gpProtector}`);
    if (player.doubleTollTurns > 0) parts.push(`×2`);
    if (player.justiceTurns > 0) parts.push(`🦸${player.justiceTurns}`);
    if (player.darkTurns > 0) parts.push(`🦹${player.darkTurns}`);
    return parts.join(' ');
  }

  // Position de repos du pion d'un joueur d'après l'état du jeu
  _tokenRestPosition(game, player) {
    const cube = game.cubeOf(player.id);
    if (cube) {
      const cubeObj = this.cubeObjs[cube.id];
      if (cubeObj) {
        return new THREE.Vector3(cubeObj.mesh.position.x, CUBE_STAND, cubeObj.mesh.position.z);
      }
    }
    const center = this.tileCenters[player.position];
    // Plusieurs pions sur la même case : en cercle
    const here = game.players.filter(p => !p.eliminated && p.position === player.position && !game.cubeOf(p.id));
    let ox = 0;
    let oz = 0;
    if (here.length > 1) {
      const angle = (here.indexOf(player) / here.length) * Math.PI * 2;
      ox = Math.cos(angle) * 0.22;
      oz = Math.sin(angle) * 0.22;
    }
    return new THREE.Vector3(center.x + ox, center.stand, center.z + oz);
  }

  _syncTokens(game) {
    for (const player of game.players) {
      let token = this.tokens[player.id];
      if (!token) {
        // Petit personnage en cubes à la couleur du joueur ; `mesh` est son groupe
        const pawn = buildPawn({ color: player.color, gradientMap: this._toonGradient, box: this._unitBox });
        this.overlayGroup.add(pawn.group);
        token = this.tokens[player.id] = {
          mesh: pawn.group, pawn, stride: 0, badge: null, badgeKey: '', baseY: 0, phase: player.id * 1.7, animating: false,
        };
      }

      token.mesh.visible = !player.eliminated;
      if (!token.animating) {
        const rest = this._tokenRestPosition(game, player);
        token.mesh.position.x = rest.x;
        token.mesh.position.z = rest.z;
        token.baseY = rest.y;
        token.mesh.scale.setScalar(player.id === this.currentPlayerId ? CURRENT_PAWN_SCALE : 1);
      }

      // Étiquette d'états au-dessus du pion
      const status = player.eliminated ? '' : this._statusText(game, player);
      if (status !== token.badgeKey) {
        if (token.badge) this.overlayGroup.remove(token.badge);
        token.badge = status ? this._labelSprite(status, 0.28) : null;
        if (token.badge) this.overlayGroup.add(token.badge);
        token.badgeKey = status;
      }
      this._placeBadge(token);
    }
  }

  _placeBadge(token) {
    if (!token.badge) return;
    token.badge.visible = token.mesh.visible;
    token.badge.position.set(token.mesh.position.x, token.mesh.position.y + PAWN_HEIGHT * CURRENT_PAWN_SCALE + 0.2, token.mesh.position.z);
  }

  // === Animations ===

  // Hauteur sur laquelle un pion se pose en arrivant sur une case : le dessus du Prize Cube
  // s'il y en a un (le joueur monte dessus), sinon le dessus de la case
  _standingHeight(tileId) {
    const hasCube = Object.values(this.cubeObjs).some(obj => obj.tileId === tileId);
    return hasCube ? CUBE_STAND : this.tileCenters[tileId].stand;
  }

  // Déplacement d'une case à la suivante ; avec `cubeId`, le Prize Cube roule sous le pion
  animateMove({ playerId, from, to, cubeId }, durationMs) {
    const token = this.tokens[playerId];
    const target = this.tileCenters[to];
    if (!token || !target) return Promise.resolve();

    const start = token.mesh.position.clone();
    start.y = token.baseY;
    const cubeObj = cubeId !== null && cubeId !== undefined ? this.cubeObjs[cubeId] : null;
    const end = new THREE.Vector3(target.x, cubeObj ? CUBE_STAND : this._standingHeight(to), target.z);
    const roll = cubeObj ? this._prepareCubeRoll(cubeObj, from, to) : null;

    // Demi-tour par le plus court chemin vers la direction du déplacement
    const turnFrom = token.mesh.rotation.y;
    let turn = Math.atan2(end.x - start.x, end.z - start.z) - turnFrom;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    if (Math.hypot(end.x - start.x, end.z - start.z) < 0.01) turn = 0;

    token.animating = true;
    this._focusObject = token.mesh;

    return this._tween(durationMs, (k) => {
      const e = easeInOut(k);
      token.mesh.position.lerpVectors(start, end, e);
      token.mesh.rotation.y = turnFrom + turn * Math.min(1, k / 0.3);
      if (roll) {
        // Debout sur le cube qui roule
        roll(k);
        token.mesh.position.y = cubeObj.mesh.position.y + TILE_SIZE / 2 - (CUBE_TOP - CUBE_STAND);
      } else {
        // Un pas par case, avec un petit saut
        token.mesh.position.y += Math.sin(Math.PI * k) * 0.25;
        token.stride = Math.sin(k * Math.PI * 2);
      }
      this._placeBadge(token);
      if (k >= 1) {
        token.baseY = end.y;
        token.stride = 0;
        token.animating = false;
        this._focusObject = null;
      }
    });
  }

  // Roulement d'un cube autour de son arête basse ; retourne la fonction d'avancement
  _prepareCubeRoll(cubeObj, fromTileId, toTileId) {
    const mesh = cubeObj.mesh;
    const half = TILE_SIZE / 2;
    const from = this._cubeRestPosition(fromTileId);
    const to = this._cubeRestPosition(toTileId);
    const dir = this._gridDirection(fromTileId, toTileId) || { x: 1, z: 0 };

    const pivot = new THREE.Vector3(from.x + dir.x * half, from.y - half, from.z + dir.z * half);
    const offset = new THREE.Vector3(-dir.x * half, half, -dir.z * half);
    // Axe horizontal perpendiculaire au déplacement
    const axis = new THREE.Vector3(dir.z, 0, -dir.x);
    const startQuat = mesh.quaternion.clone();
    cubeObj.animating = true;

    return (k) => {
      if (k >= 1) {
        mesh.position.copy(to);
        mesh.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2).multiply(startQuat));
        cubeObj.tileId = toTileId;
        cubeObj.animating = false;
        return;
      }
      const angle = (Math.PI / 2) * k;
      mesh.position.copy(pivot).add(offset.clone().applyAxisAngle(axis, angle));
      mesh.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(startQuat));
    };
  }

  // Saut d'une case à une autre : le pion s'élève en rétrécissant, puis redescend à l'arrivée
  animateTeleport({ playerId, to }, durationMs) {
    const token = this.tokens[playerId];
    const target = this.tileCenters[to];
    if (!token || !target) return Promise.resolve();

    const start = token.mesh.position.clone();
    start.y = token.baseY;
    const end = new THREE.Vector3(target.x, this._standingHeight(to), target.z);
    const baseScale = token.mesh.scale.x;

    token.animating = true;
    this._focusObject = token.mesh;

    return this._tween(durationMs, (k) => {
      const leaving = k < 0.5;
      const local = leaving ? k * 2 : (k - 0.5) * 2;
      const anchor = leaving ? start : end;
      const lift = leaving ? local : 1 - local;
      token.mesh.position.set(anchor.x, anchor.y + lift * 1.5, anchor.z);
      token.mesh.scale.setScalar(baseScale * Math.max(0.05, 1 - lift));
      this._placeBadge(token);
      if (k >= 1) {
        token.mesh.scale.setScalar(baseScale);
        token.baseY = end.y;
        token.animating = false;
        this._focusObject = null;
      }
    });
  }

  // Un Prize Cube se brise sous son cavalier : il éclate sur place pendant que le gain s'affiche,
  // le pion retombe sur la case, puis le cube réapparaît à sa case d'origine.
  animateCubeBreak({ cubeId, playerId, sourceTileId, gp }, durationMs) {
    const cubeObj = this.cubeObjs[cubeId];
    if (!cubeObj) return Promise.resolve();

    const mesh = cubeObj.mesh;
    const brokeAt = mesh.position.clone();
    const home = this._cubeRestPosition(sourceTileId);
    const startQuat = mesh.quaternion.clone();
    cubeObj.animating = true;

    const token = this.tokens[playerId];
    const tokenFrom = token ? token.mesh.position.y : 0;
    const tokenTo = this.tileCenters[cubeObj.tileId]?.stand ?? DAMAGE_TILE_HEIGHT;
    if (token) token.animating = true;

    // Gain affiché au-dessus du cube, qui monte en s'effaçant
    const shared = this._labelMaterial(`+${gp} GP`, { fg: '#ffd700' });
    const labelMaterial = shared.clone();
    const label = new THREE.Sprite(labelMaterial);
    label.scale.set(0.36 * shared.userData.aspect, 0.36, 1);
    label.renderOrder = 30;
    this.overlayGroup.add(label);

    const spin = new THREE.Vector3(0, 1, 0);
    return this._tween(durationMs, (k) => {
      if (k < 0.45) {
        // Éclatement : le cube tourne sur lui-même et disparaît
        const out = k / 0.45;
        mesh.position.copy(brokeAt);
        mesh.scale.setScalar(Math.max(0.001, 1 - out));
        mesh.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(spin, out * Math.PI * 2).multiply(startQuat));
        if (token) token.mesh.position.y = tokenFrom + (tokenTo - tokenFrom) * easeInOut(out);
      } else {
        // Réapparition à la case d'origine
        const back = Math.min(1, (k - 0.55) / 0.45);
        mesh.position.copy(home);
        mesh.quaternion.identity();
        mesh.scale.setScalar(k < 0.55 ? 0.001 : Math.max(0.001, easeInOut(back)));
        if (token) token.mesh.position.y = tokenTo;
      }
      if (token) this._placeBadge(token);
      label.position.set(brokeAt.x, brokeAt.y + 0.9 + k * 0.9, brokeAt.z);
      labelMaterial.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;

      if (k >= 1) {
        mesh.scale.setScalar(1);
        cubeObj.tileId = sourceTileId;
        cubeObj.animating = false;
        if (token) {
          token.baseY = tokenTo;
          token.animating = false;
        }
        this.overlayGroup.remove(label);
        labelMaterial.dispose();
      }
    });
  }

  // Masque la marque de propriété de cases, en attendant de la faire apparaître avec spotlight()
  hideOwnership(tileIds) {
    for (const tileId of tileIds) {
      for (const obj of this._ownObjects[tileId] || []) obj.visible = false;
    }
  }

  // Montre des cases qui viennent de changer de mains à distance : la caméra s'y rend (si elle
  // suit le jeu), une onde à la couleur du nouveau propriétaire part de chaque case, puis sa
  // plaque y apparaît en rebondissant pendant que la case clignote.
  spotlight(tileIds, durationMs, color = '#ffffff') {
    const targets = tileIds.map(id => ({ id, center: this.tileCenters[id] })).filter(t => t.center);
    if (targets.length === 0) return Promise.resolve();

    const tint = new THREE.Color(color);
    const effects = targets.map(({ id, center }) => {
      const flash = new THREE.Mesh(this._highlightGeom, new THREE.MeshBasicMaterial({
        color: tint, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      }));
      flash.position.set(center.x, center.top + 0.04, center.z);
      flash.renderOrder = 25;

      const ringGeom = new THREE.RingGeometry(0.42, 0.5, 40);
      ringGeom.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({
        color: tint, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      }));
      ring.position.set(center.x, center.top + 0.06, center.z);
      ring.renderOrder = 26;

      this.pickGroup.add(flash, ring);
      const [mark, level] = this._ownObjects[id] || [];
      return { flash, ring, mark, level };
    });

    this._spotPoint = new THREE.Vector3(
      targets.reduce((sum, t) => sum + t.center.x, 0) / targets.length,
      0,
      targets.reduce((sum, t) => sum + t.center.z, 0) / targets.length,
    );

    const ARRIVE = 0.3; // part de la durée laissée à la caméra pour arriver
    return this._tween(durationMs, (k) => {
      const shown = k >= ARRIVE;
      const local = shown ? (k - ARRIVE) / (1 - ARRIVE) : 0;
      // Rebond : dépasse sa taille puis s'y pose
      const pop = local < 0.35 ? (local / 0.35) * 1.25 : 1.25 - 0.25 * Math.min(1, (local - 0.35) / 0.25);

      for (const fx of effects) {
        fx.ring.scale.setScalar(0.4 + local * 2.4);
        fx.ring.material.opacity = shown ? 0.95 * (1 - local) : 0;
        fx.flash.material.opacity = shown ? 0.3 + 0.3 * Math.sin(local * Math.PI * 8) : 0;
        if (fx.mark) {
          fx.mark.visible = shown;
          if (fx.mark.userData.baseScale) {
            const base = fx.mark.userData.baseScale;
            fx.mark.scale.set(base.x * Math.max(0.001, pop), base.y, base.z * Math.max(0.001, pop));
          }
        }
        if (fx.level) fx.level.visible = shown && local > 0.5;
      }

      if (k >= 1) {
        for (const fx of effects) {
          this.pickGroup.remove(fx.flash, fx.ring);
          fx.flash.material.dispose();
          fx.ring.material.dispose();
          fx.ring.geometry.dispose();
          if (fx.mark) {
            fx.mark.visible = true;
            if (fx.mark.userData.baseScale) fx.mark.scale.copy(fx.mark.userData.baseScale);
          }
          if (fx.level) fx.level.visible = true;
        }
        this._spotPoint = null;
      }
    });
  }

  // === Effets visuels des mains de cartes ===
  //
  // Chaque effet est décrit par le moteur ({ type, ... }) et se joue autour du pion concerné
  // pendant que l'annonce est à l'écran. Les éléments sont de petites images (pièces, symboles)
  // qui apparaissent et disparaissent en changeant de taille.

  // Pièce d'or, en pixel art comme les autres symboles
  _coinMaterial() {
    return this._labelMaterial('🪙', { bg: null });
  }

  // Image d'effet, invisible au départ ; sa taille se règle avec _fxScale (1 = taille normale)
  _fxSprite(material, height) {
    const sprite = new THREE.Sprite(material);
    sprite.userData.size = { x: height * material.userData.aspect, y: height };
    sprite.scale.set(0.0001, 0.0001, 1);
    sprite.renderOrder = 40;
    this.fxGroup.add(sprite);
    return sprite;
  }

  _fxSymbol(text, height = 0.42, options = { bg: null }) {
    return this._fxSprite(this._labelMaterial(text, options), height);
  }

  _fxScale(sprite, factor) {
    const f = Math.max(0.0001, factor);
    sprite.scale.set(sprite.userData.size.x * f, sprite.userData.size.y * f, 1);
  }

  // Point juste au-dessus du pion d'un joueur
  _headOf(playerId) {
    const token = this.tokens[playerId];
    if (!token) return null;
    return new THREE.Vector3(token.mesh.position.x, token.baseY + PAWN_HEIGHT + 0.12, token.mesh.position.z);
  }

  // Joue l'effet d'une main. Les roulettes (Joker, Chance Dorée) enchaînent sur l'effet obtenu.
  playEffect(fx, playerId, durationMs) {
    if (!fx || !this.scene || !this._headOf(playerId)) return Promise.resolve();

    const first = this._buildFx(fx, playerId);
    if (!first) return Promise.resolve();
    const split = fx.type === 'roulette' && fx.then ? 0.45 : 1;
    let second = null;

    // La caméra va voir la cible d'un Stun (si elle suit le jeu)
    const stun = fx.type === 'stun' ? fx : (fx.then && fx.then.type === 'stun' ? fx.then : null);
    const stunHead = stun ? this._headOf(stun.targetId) : null;

    return this._tween(durationMs, (k) => {
      if (k < split || !fx.then) {
        first.update(clamp01(k / split));
      } else {
        if (!second) {
          first.update(1);
          first.cleanup();
          second = this._buildFx(fx.then, playerId) || { update() {}, cleanup() {} };
          if (stunHead) this._spotPoint = new THREE.Vector3(stunHead.x, 0, stunHead.z);
        }
        second.update(clamp01((k - split) / (1 - split)));
      }
      if (stunHead && fx.type === 'stun' && !this._spotPoint) this._spotPoint = new THREE.Vector3(stunHead.x, 0, stunHead.z);

      if (k >= 1) {
        if (second) second.cleanup();
        else first.cleanup();
        if (stunHead) this._spotPoint = null;
      }
    });
  }

  // Construit un effet : { update(k de 0 à 1), cleanup() }
  _buildFx(fx, playerId) {
    const builders = {
      magnet: () => this._fxMagnet(fx, playerId),
      stun: () => this._fxStun(fx.targetId),
      confuse: () => this._fxOrbit(fx.targetIds || [], ['❓', '💫', '❓']),
      dice: () => this._fxDice(fx, playerId),
      shield: () => this._fxShield(playerId),
      navigator: () => this._fxNavigator(playerId),
      doubleToll: () => this._fxDoubleToll(fx, playerId),
      roulette: () => this._fxRoulette(fx, playerId),
    };
    const build = builders[fx.type];
    if (!build) return null;

    const created = [];
    const before = new Set(this.fxGroup.children);
    const effect = build();
    for (const child of this.fxGroup.children) if (!before.has(child)) created.push(child);
    return {
      update: effect.update,
      cleanup: () => {
        if (effect.cleanup) effect.cleanup();
        for (const obj of created) {
          this.fxGroup.remove(obj);
          if (obj.userData.ownMaterial) obj.material.dispose();
          if (obj.userData.ownGeometry) obj.geometry.dispose();
        }
      },
    };
  }

  // Aimant GP : des pièces partent des cases adverses et arrivent en tourbillon sur le joueur
  _fxMagnet(fx, playerId) {
    const head = this._headOf(playerId);
    const starts = (fx.tileIds || []).slice(0, 14)
      .map(id => this.tileCenters[id]).filter(Boolean)
      .map(c => new THREE.Vector3(c.x, c.top + 0.3, c.z));
    // Peu ou pas de cases adverses : des pièces arrivent aussi de tout autour
    for (let i = starts.length; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      starts.push(new THREE.Vector3(head.x + Math.cos(angle) * 2.6, head.y + 0.5, head.z + Math.sin(angle) * 2.6));
    }
    const coins = starts.map(() => this._fxSprite(this._coinMaterial(), 0.3));
    const token = this.tokens[playerId];
    const baseScale = token.mesh.scale.x;

    return {
      update: (k) => {
        coins.forEach((coin, i) => {
          const delay = (i / coins.length) * 0.4;
          const t = clamp01((k - delay) / 0.6);
          const e = easeInOut(t);
          const angle = t * Math.PI * 4 + i * 1.7;
          const radius = (1 - t) * 0.7;
          coin.position.set(
            lerp(starts[i].x, head.x, e) + Math.cos(angle) * radius,
            lerp(starts[i].y, head.y, e) + Math.sin(Math.PI * t) * 1.1,
            lerp(starts[i].z, head.z, e) + Math.sin(angle) * radius,
          );
          this._fxScale(coin, t <= 0 ? 0 : clamp01(Math.min(t / 0.12, (1 - t) / 0.1)));
        });
        // Le pion gonfle à mesure que les pièces arrivent
        token.mesh.scale.setScalar(baseScale * (1 + 0.25 * Math.sin(Math.PI * clamp01((k - 0.5) / 0.5))));
      },
      cleanup: () => token.mesh.scale.setScalar(baseScale),
    };
  }

  // Stun : une salve d'éclairs tombe du ciel sur le joueur visé, qui sursaute ; puis des étoiles
  // tournent au-dessus de sa tête pendant qu'il vacille
  _fxStun(targetId) {
    const stars = ['💫', '💫', '💫'];
    const token = this.tokens[targetId];
    if (!token) return this._fxOrbit([targetId], stars);

    const { mesh } = token;
    const size = mesh.scale.x;
    const strike = buildLightning({
      top: new THREE.Vector3(mesh.position.x, token.baseY + PAWN_HEIGHT * size, mesh.position.z),
      ground: token.baseY,
    });
    this.fxGroup.add(strike.group);
    const orbit = this._fxOrbit([targetId], stars, { startAt: STUN_STARS_AT });
    // Matières du pion (les siennes seulement) : elles blanchissent à chaque éclair
    const materials = new Set();
    mesh.traverse((part) => {
      if (part.isMesh && part.material.emissive) materials.add(part.material);
    });

    return {
      update: (k) => {
        const t = clamp01(k / STRIKE_SHARE);
        const glow = strike.update(t);
        orbit.update(k);
        // Le temps de la frappe, le ciel s'assombrit ; chaque éclair illumine la scène et le pion
        this._setLightFactor(1 - 0.3 * Math.sin(Math.PI * t) + 0.75 * glow);
        for (const material of materials) material.emissive.setScalar(0.7 * glow);
        if (k < STUN_STARS_AT) {
          // Frappé, le pion s'aplatit et tressaute
          const hit = glow >= 0.5;
          mesh.scale.set(size * (hit ? 1.14 : 1), size * (hit ? 0.84 : 1), size * (hit ? 1.14 : 1));
          mesh.rotation.z = hit ? Math.sign(Math.sin(k * 300)) * 0.16 : 0;
        } else {
          mesh.scale.setScalar(size);
        }
      },
      cleanup: () => {
        orbit.cleanup();
        strike.dispose();
        this._setLightFactor(1);
        for (const material of materials) material.emissive.setScalar(0);
        mesh.scale.setScalar(size);
      },
    };
  }

  // Stun et Confusion : des symboles tournent au-dessus de la tête des joueurs visés, dont le pion
  // vacille. Ils attendent `startAt` (part de l'effet) avant d'apparaître.
  _fxOrbit(targetIds, symbols, { startAt = 0 } = {}) {
    const targets = targetIds.map(id => ({ token: this.tokens[id], head: this._headOf(id) })).filter(t => t.token && t.head);
    const groups = targets.map(target => ({
      ...target,
      items: symbols.map(symbol => this._fxSymbol(symbol, 0.32)),
    }));

    return {
      update: (k) => {
        for (const group of groups) {
          const { head } = group;
          const t = clamp01((k - startAt) / (1 - startAt));
          group.items.forEach((item, i) => {
            const angle = t * Math.PI * 5 + (i / group.items.length) * Math.PI * 2;
            item.position.set(head.x + Math.cos(angle) * 0.34, head.y + 0.2, head.z + Math.sin(angle) * 0.34);
            this._fxScale(item, k < startAt ? 0 : envelope(t));
          });
          group.token.mesh.rotation.z = k < startAt ? 0 : Math.sin(k * 42) * 0.32 * (1 - t);
        }
      },
      cleanup: () => {
        for (const group of groups) group.token.mesh.rotation.z = 0;
      },
    };
  }

  // Double Dé, Triple Dé : les dés jaillissent et tournent en rebondissant au-dessus du joueur
  _fxDice(fx, playerId) {
    const head = this._headOf(playerId);
    const dice = Array.from({ length: fx.count || 2 }, () => this._fxSymbol('🎲', 0.46));
    return {
      update: (k) => {
        dice.forEach((die, i) => {
          const angle = k * Math.PI * 3 + (i / dice.length) * Math.PI * 2;
          const radius = 0.5 * clamp01(k / 0.2);
          die.position.set(
            head.x + Math.cos(angle) * radius,
            head.y + 0.3 + Math.abs(Math.sin(k * Math.PI * 4 + i)) * 0.3,
            head.z + Math.sin(angle) * radius,
          );
          this._fxScale(die, envelope(k));
        });
      },
    };
  }

  // Protecteur GP : une bulle se referme autour du joueur
  _fxShield(playerId) {
    const head = this._headOf(playerId);
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x5ab0ff, transparent: true, opacity: 0, depthWrite: false }),
    );
    bubble.userData.ownMaterial = true;
    bubble.userData.ownGeometry = true;
    bubble.position.set(head.x, head.y - 0.45, head.z);
    bubble.renderOrder = 39;
    this.fxGroup.add(bubble);
    const icon = this._fxSymbol('🛡️', 0.5);

    return {
      update: (k) => {
        // La bulle arrive grande, se resserre, puis s'efface
        const size = k < 0.3 ? lerp(2.2, 1, easeInOut(k / 0.3)) : 1 + 0.06 * Math.sin(k * 30);
        bubble.scale.setScalar(size);
        bubble.material.opacity = 0.5 * envelope(k);
        icon.position.set(head.x, head.y + 0.25 + k * 0.5, head.z);
        this._fxScale(icon, envelope(k));
      },
    };
  }

  // Navigateur : quatre flèches partent du joueur, une par direction
  _fxNavigator(playerId) {
    const head = this._headOf(playerId);
    const directions = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    const arrows = directions.map((dir) => {
      const arrow = new THREE.Mesh(this._arrowGeom, new THREE.MeshBasicMaterial({
        color: 0xffd700, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95,
      }));
      arrow.userData.ownMaterial = true;
      arrow.rotation.y = Math.atan2(-dir.z, dir.x);
      arrow.renderOrder = 39;
      this.fxGroup.add(arrow);
      return { arrow, dir };
    });
    const icon = this._fxSymbol('🧭', 0.5);

    return {
      update: (k) => {
        for (const { arrow, dir } of arrows) {
          const reach = 0.5 + easeInOut(k) * 1.4;
          arrow.position.set(head.x + dir.x * reach, head.y - 0.3, head.z + dir.z * reach);
          arrow.scale.setScalar(Math.max(0.0001, 1.2 * envelope(k)));
        }
        icon.position.set(head.x, head.y + 0.35, head.z);
        this._fxScale(icon, envelope(k));
      },
    };
  }

  // Double Péage : un « ×2 » s'élève de chaque case du joueur
  _fxDoubleToll(fx, playerId) {
    const head = this._headOf(playerId);
    const centers = (fx.tileIds || []).slice(0, 14).map(id => this.tileCenters[id]).filter(Boolean);
    const labels = centers.map(() => this._fxSymbol('×2', 0.36, { fg: '#ffd700' }));
    const icon = this._fxSymbol('💰', 0.5);

    return {
      update: (k) => {
        labels.forEach((label, i) => {
          const t = clamp01((k - (i / Math.max(1, labels.length)) * 0.3) / 0.7);
          label.position.set(centers[i].x, centers[i].top + 0.35 + t * 0.6, centers[i].z);
          this._fxScale(label, t <= 0 ? 0 : envelope(t) * (1 + 0.3 * Math.sin(Math.PI * t)));
        });
        icon.position.set(head.x, head.y + 0.3 + 0.1 * Math.sin(k * 12), head.z);
        this._fxScale(icon, envelope(k));
      },
    };
  }

  // Fortune du Joker et Chance Dorée : des cartes ou des étoiles tournent de plus en plus serré
  // au-dessus du joueur, avant que le résultat ne tombe
  _fxRoulette(fx, playerId) {
    const head = this._headOf(playerId);
    const golden = fx.symbol === 'golden';
    const count = golden ? 6 : 5;
    const items = Array.from({ length: count }, () => this._fxSymbol(golden ? '⭐' : '🃏', 0.38));
    const center = golden ? this._fxSymbol('🎰', 0.62) : null;

    return {
      update: (k) => {
        items.forEach((item, i) => {
          // Rotation qui s'accélère, rayon qui s'ouvre puis se referme
          const angle = k * k * Math.PI * 9 + (i / count) * Math.PI * 2;
          const radius = 0.25 + 0.6 * Math.sin(Math.PI * k);
          item.position.set(
            head.x + Math.cos(angle) * radius,
            head.y + 0.45 + 0.12 * Math.sin(k * 14 + i),
            head.z + Math.sin(angle) * radius,
          );
          this._fxScale(item, envelope(k));
        });
        if (center) {
          center.position.set(head.x, head.y + 0.55, head.z);
          this._fxScale(center, envelope(k));
        }
      },
    };
  }

  // === Choix d'une case sur le plateau ===

  // Attend un clic sur l'une des cases `tileIds`. Avec `arrowsFrom`, des flèches partent de cette
  // case vers chaque destination (choix de direction) ; sinon les cases sont mises en surbrillance.
  pickTile({ tileIds, arrowsFrom = null }) {
    this.cancelPick();
    return new Promise((resolve) => {
      const markers = [];
      for (const tileId of tileIds) {
        const center = this.tileCenters[tileId];
        if (!center) continue;

        let marker;
        if (arrowsFrom !== null) {
          const from = this.tileCenters[arrowsFrom];
          const dir = this._gridDirection(arrowsFrom, tileId);
          marker = new THREE.Mesh(this._arrowGeom, new THREE.MeshBasicMaterial({
            color: 0xffd700, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95,
          }));
          marker.rotation.y = Math.atan2(-dir.z, dir.x);
          const base = new THREE.Vector3(from.x + dir.x * SPACING * 0.8, TILE_HEIGHT + 0.5, from.z + dir.z * SPACING * 0.8);
          marker.position.copy(base);
          marker.userData = { tileId, isArrow: true, base, dir };
        } else {
          marker = new THREE.Mesh(this._highlightGeom, new THREE.MeshBasicMaterial({
            color: 0xffd700, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide,
          }));
          marker.position.set(center.x, center.top + 0.03, center.z);
          marker.userData = { tileId, isArrow: false };
        }
        marker.renderOrder = 20;
        markers.push(marker);
        this.pickGroup.add(marker);
      }
      this._pick = { ids: new Set(tileIds), markers, resolve };
    });
  }

  cancelPick() {
    if (!this._pick) return;
    const pick = this._pick;
    this._pick = null;
    for (const marker of pick.markers) {
      this.pickGroup.remove(marker);
      marker.material.dispose();
    }
    this.webglRenderer.domElement.style.cursor = '';
    pick.resolve(null);
  }

  _resolvePick(tileId) {
    const pick = this._pick;
    this._pick = null;
    for (const marker of pick.markers) {
      this.pickGroup.remove(marker);
      marker.material.dispose();
    }
    this.webglRenderer.domElement.style.cursor = '';
    pick.resolve(tileId);
  }

  // === Pointeur : survol et clic ===

  // Case sous le pointeur (les flèches de choix comptent pour leur case de destination)
  _tileAt(clientX, clientY) {
    const rect = this.webglRenderer.domElement.getBoundingClientRect();
    this._mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this._mouse, this.camera);

    if (this._pick) {
      const arrows = this._pick.markers.filter(m => m.userData.isArrow);
      const arrowHit = this.raycaster.intersectObjects(arrows, false)[0];
      if (arrowHit) return arrowHit.object.userData.tileId;
    }
    // Les cubes sont évidés : on teste aussi leur dessin (objet enfant), au fond de la cuvette
    const hit = this.raycaster.intersectObjects(Object.values(this.tileMeshes), true)[0];
    if (!hit) return null;
    return hit.object.userData.tileId ?? hit.object.parent.userData.tileId ?? null;
  }

  _updateHover() {
    const pointer = this._pointer;
    if (!pointer || !pointer.dirty) return;
    pointer.dirty = false;
    if (pointer.dragging) {
      this._setHover(null, pointer.clientX, pointer.clientY);
      return;
    }
    this._setHover(this._tileAt(pointer.clientX, pointer.clientY), pointer.clientX, pointer.clientY);
  }

  _setHover(tileId, clientX, clientY) {
    this._hoverTileId = tileId;
    const pickable = this._pick && tileId !== null && this._pick.ids.has(tileId);
    this.webglRenderer.domElement.style.cursor = pickable ? 'pointer' : '';
    if (this.onTileHover) this.onTileHover(tileId, clientX, clientY);
  }

  _onClick(e) {
    const touch = e.pointerType === 'touch';
    let tileId = this._tileAt(e.clientX, e.clientY);
    if (this._pick) {
      // Au doigt, on vise moins juste : la cible la plus proche du point touché fait l'affaire
      if (touch && (tileId === null || !this._pick.ids.has(tileId))) {
        const near = this._nearestPick(e.clientX, e.clientY, tileId === null ? TOUCH_PICK_RADIUS : TOUCH_PICK_RADIUS / 2);
        if (near !== null) tileId = near;
      }
      if (tileId !== null && this._pick.ids.has(tileId)) {
        this._resolvePick(tileId);
        return;
      }
      // À la souris, le survol renseigne déjà ; au doigt, toucher une autre case en donne le détail
      if (!touch) return;
    }
    if (this.onTileClick) this.onTileClick(tileId, e.clientX, e.clientY, e.pointerType);
  }

  // Parmi les cases à choisir, celle dont le repère (flèche ou surbrillance) est le plus proche
  // du point de l'écran, à moins de `radius` pixels. null s'il n'y en a pas.
  _nearestPick(clientX, clientY, radius) {
    const rect = this.webglRenderer.domElement.getBoundingClientRect();
    let nearest = null;
    let best = radius * radius;
    for (const marker of this._pick.markers) {
      const p = this._tmp.copy(marker.position).project(this.camera);
      if (p.z > 1) continue; // derrière la caméra
      const dx = rect.left + (p.x + 1) / 2 * rect.width - clientX;
      const dy = rect.top + (1 - p.y) / 2 * rect.height - clientY;
      if (dx * dx + dy * dy < best) {
        best = dx * dx + dy * dy;
        nearest = marker.userData.tileId;
      }
    }
    return nearest;
  }

  // === Nettoyage ===

  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.animationId = null;
    this.cancelPick();

    // Les animations en attente se terminent tout de suite, pour ne bloquer personne
    const tweens = this._tweens;
    this._tweens = [];
    for (const tween of tweens) tween.resolve();

    if (this._resizeObs) this._resizeObs.disconnect();
    if (this._listeners) this._listeners.abort();
    if (this.controls) this.controls.dispose();

    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
        for (const material of materials) material.dispose();
      });
    }
    for (const tex of Object.values(this._textures)) tex.dispose();
    for (const geometry of this._reliefGeometries?.values() || []) geometry.dispose();
    for (const geometry of this._shellGeometries?.values() || []) geometry.dispose();
    for (const geometry of Object.values(this._diceGeoms || {})) geometry.dispose();
    if (this.environment) this.environment.dispose();
    for (const material of this._labelTextures.values()) {
      material.map.dispose();
      material.dispose();
    }

    if (this.webglRenderer) {
      this.webglRenderer.dispose();
      this.webglRenderer.forceContextLoss();
      this.webglRenderer.domElement.remove();
    }
    this.scene = null;
    this.game = null;
  }
}
