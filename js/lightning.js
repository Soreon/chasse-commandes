// Foudre du Stun : des éclairs en pixel art tombent du ciel sur le pion visé.
//
// Plusieurs mises en scène, à comparer sur la page d'essai (essais.html). Chacune se construit avec
// buildLightning(style, options) et se pilote par update(t), t allant de 0 à 1 sur la durée de
// la frappe. update rend la lueur de l'instant (de 0 à 1) : le moteur de rendu s'en sert pour
// illuminer la scène et le pion.
//
// Les dessins sont des images toujours tournées vers l'écran, accrochées par le bas au point
// frappé : l'éclair monte donc droit vers le haut de l'écran, quelle que soit l'inclinaison de
// la caméra.

import * as THREE from 'three';
import { boltGrid, burstGrid, cloudGrid, BURST_STAGES, EDGE, RIM, CORE, SHADE } from './lightningArt.js';

export const LIGHTNING_STYLES = {
  bolt: 'Trait de foudre',
  volley: 'Salve d’éclairs',
  cloud: 'Nuage d’orage',
  cubes: 'Foudre en mini-cubes',
};
export const DEFAULT_LIGHTNING = 'bolt';

const PIXEL = 0.05;  // côté d'un point du dessin, en unités de case
const TEXEL = 6;     // pixels de texture par point

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const BOLT = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };
// Première image d'une frappe : l'éclair tout blanc, cerné d'or
const BOLT_FLASH = { [EDGE]: GOLD, [RIM]: '#ffffff', [CORE]: '#ffffff' };
const CLOUD = { [EDGE]: INK, [RIM]: '#565c80', [CORE]: '#8a91ba', [SHADE]: '#3a3e5c' };
const CLOUD_LIT = { [EDGE]: INK, [RIM]: '#dfe3ff', [CORE]: '#ffffff', [SHADE]: '#a3a9d6' };

const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const clamp01 = v => Math.max(0, Math.min(1, v));

// Image en pixel art dont le dessin change au fil de l'animation
class PixelSprite {
  constructor(width, height, pixel) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * TEXEL;
    this.canvas.height = height * TEXEL;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.frustumCulled = false; // l'accroche peut être hors de l'écran alors que le dessin y est
    this.sprite.visible = false;
    this.size = { x: width * pixel, y: height * pixel };
    this.setZoom(1);
    this.shown = null;
  }

  setZoom(zoom) {
    this.sprite.scale.set(this.size.x * zoom, this.size.y * zoom, 1);
  }

  // Affiche un dessin, ou rien (key null). `key` nomme l'image : la texture n'est repeinte que
  // s'il change. keep(x, y, code) permet de n'en garder qu'une partie.
  show(key, grid = null, palette = null, keep = null) {
    if (key === this.shown) return;
    this.shown = key;
    this.sprite.visible = key !== null;
    if (key === null) return;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const code = grid.cells[y * grid.width + x];
        if (code === 0 || (keep && !keep(x, y, code))) continue;
        ctx.fillStyle = palette[code];
        ctx.fillRect(x * TEXEL, y * TEXEL, TEXEL, TEXEL);
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}

function pixelSprite(group, at, width, height, order, pixel = PIXEL) {
  const item = new PixelSprite(width, height, pixel);
  item.sprite.position.copy(at);
  item.sprite.renderOrder = order;
  group.add(item.sprite);
  return item;
}

// Éclair accroché par sa pointe au point frappé
function boltSprite(group, at, shape) {
  const item = pixelSprite(group, at, shape.width, shape.height, 41);
  item.sprite.center.set(0.5, 0);
  return item;
}

// Aspects d'un éclair : 'flash' (tout blanc), 'bolt' (normal), 'fade' (un point sur deux, il
// s'éteint) ; null pour rien. reveal : part visible, depuis le haut (l'éclair descend).
function showBolt(item, name, grid, look, reveal = 1) {
  if (!look) return item.show(null);
  const rows = Math.round(grid.height * reveal);
  const fading = look === 'fade';
  return item.show(
    `${name}|${look}|${rows}`, grid, look === 'flash' ? BOLT_FLASH : BOLT,
    (x, y, code) => y < rows && !(fading && (code === EDGE || (x + y) % 2 === 1)),
  );
}

function showBurst(item, stage) {
  if (stage < 0) item.show(null);
  else item.show(`burst${stage}`, BURSTS[stage], BOLT);
}

// Image en cours d'un déroulé : la première ligne dont la fin (première colonne) dépasse t
const stepAt = (script, t) => script.find(step => t < step[0]) || script[script.length - 1];

// --- Trait de foudre : un gros éclair descend du ciel en deux images, frappe en blanc,
// s'éteint, puis un second, d'une autre forme, frappe au même endroit ---

//   fin   éclair aspect   visible éclat lueur
const BOLT_SCRIPT = [
  [0.08, 0, 'bolt', 0.4, -1, 0],
  [0.16, 0, 'bolt', 0.75, -1, 0],
  [0.22, 0, 'flash', 1, 0, 1],
  [0.28, 0, 'flash', 1, 1, 1],
  [0.40, 0, 'bolt', 1, 2, 0.35],
  [0.48, 0, null, 1, 3, 0],
  [0.58, 1, 'flash', 1, 1, 0.8],
  [0.70, 1, 'bolt', 1, 2, 0.3],
  [0.84, 1, 'fade', 1, 3, 0],
  [Infinity, 1, null, 1, -1, 0],
];
const BIG_BOLT = { width: 41, height: 120, thick: 3 };

function strikeBolt({ group, top, random }) {
  const shapes = [boltGrid(random, { ...BIG_BOLT, forks: 2 }), boltGrid(random, { ...BIG_BOLT, forks: 1 })];
  const bolt = boltSprite(group, top, BIG_BOLT);
  const burst = pixelSprite(group, top, 15, 15, 42);
  return {
    sprites: [bolt, burst],
    update(t) {
      const [, shape, look, reveal, stage, glow] = stepAt(BOLT_SCRIPT, t);
      showBolt(bolt, shape, shapes[shape], look, reveal);
      showBurst(burst, stage);
      return glow;
    },
  };
}

// --- Salve : trois éclairs fins tombent tour à tour autour du pion, puis un gros sur sa tête ---

// Temps comptés depuis le départ de chaque éclair :  fin, aspect, éclat, lueur
const SMALL_SCRIPT = [
  [0, null, -1, 0],
  [0.06, 'flash', 0, 0.25],
  [0.13, 'bolt', 1, 0.1],
  [0.20, null, 2, 0],
  [0.27, null, 3, 0],
  [Infinity, null, -1, 0],
];
const FINAL_SCRIPT = [
  [0, null, -1, 0],
  [0.05, 'flash', 0, 1],
  [0.10, 'flash', 1, 1],
  [0.20, 'bolt', 2, 0.35],
  [0.26, null, 3, 0],
  [0.34, 'flash', 1, 0.7],
  [0.42, 'fade', 2, 0],
  [Infinity, null, -1, 0],
];
const VOLLEY_STARTS = [0, 0.16, 0.32, 0.52];
const THIN_BOLT = { width: 31, height: 110, thick: 2, forks: 1 };

function strikeVolley({ group, top, ground, random }) {
  const turn = random() * Math.PI * 2;
  const strikes = VOLLEY_STARTS.map((start, i) => {
    const last = i === VOLLEY_STARTS.length - 1;
    const angle = turn + i * ((Math.PI * 2) / 3) + (random() - 0.5) * 0.6;
    const at = last ? top : new THREE.Vector3(top.x + Math.cos(angle) * 0.36, ground, top.z + Math.sin(angle) * 0.36);
    const shape = last ? { ...BIG_BOLT, forks: 2 } : THIN_BOLT;
    return {
      start,
      script: last ? FINAL_SCRIPT : SMALL_SCRIPT,
      grid: boltGrid(random, shape),
      bolt: boltSprite(group, at, shape),
      burst: pixelSprite(group, at, 15, 15, 42, last ? PIXEL : PIXEL * 0.8),
    };
  });
  return {
    sprites: strikes.flatMap(strike => [strike.bolt, strike.burst]),
    update(t) {
      let glow = 0;
      for (const strike of strikes) {
        const [, look, stage, light] = stepAt(strike.script, t - strike.start);
        showBolt(strike.bolt, 'bolt', strike.grid, look);
        showBurst(strike.burst, stage);
        glow = Math.max(glow, light);
      }
      return glow;
    },
  };
}

// --- Nuage d'orage : un nuage sombre gonfle au-dessus du pion, gronde, puis lâche deux éclairs
// courts en s'illuminant, et se dissipe ---

//   fin   taille du nuage, décalage (points), illuminé, éclair, aspect, éclat, lueur
const CLOUD_SCRIPT = [
  [0.06, 0.45, 0, false, 0, null, -1, 0],
  [0.12, 0.8, 0, false, 0, null, -1, 0],
  [0.18, 1.12, 0, false, 0, null, -1, 0],
  [0.23, 1, 0, false, 0, null, -1, 0],
  [0.27, 1, -1, false, 0, null, -1, 0],
  [0.31, 1, 1, false, 0, null, -1, 0],
  [0.35, 1, -1, false, 0, null, -1, 0],
  [0.41, 1.06, 0, true, 0, 'flash', 0, 1],
  [0.47, 1.06, 0, true, 0, 'flash', 1, 1],
  [0.56, 1, 0, false, 0, 'bolt', 2, 0.3],
  [0.62, 1, 1, false, 0, null, 3, 0],
  [0.70, 1.06, 0, true, 1, 'flash', 1, 0.8],
  [0.79, 1, 0, false, 1, 'bolt', 2, 0.3],
  [0.86, 1, 0, false, 1, 'fade', 3, 0],
  [0.91, 0.8, 0, false, 1, null, -1, 0],
  [0.96, 0.5, 0, false, 1, null, -1, 0],
  [Infinity, 0, 0, false, 1, null, -1, 0],
];
const SHORT_BOLT = { width: 25, height: 26, thick: 3, forks: 0, stride: [4, 7] };

function strikeCloud({ group, top, random }) {
  const art = cloudGrid();
  const shapes = [boltGrid(random, SHORT_BOLT), boltGrid(random, SHORT_BOLT)];
  const bolt = boltSprite(group, top, SHORT_BOLT);
  const burst = pixelSprite(group, top, 15, 15, 42);
  const cloud = pixelSprite(group, top, art.width, art.height, 43);
  // Le nuage est accroché au pion lui aussi, mais dessiné plus haut dans le plan de l'écran :
  // sa base recouvre le sommet de l'éclair, sous tous les angles de caméra
  const lift = (SHORT_BOLT.height - 3) / art.height;
  return {
    sprites: [bolt, burst, cloud],
    update(t) {
      const [, zoom, shift, lit, shape, look, stage, glow] = stepAt(CLOUD_SCRIPT, t);
      if (zoom > 0) {
        cloud.setZoom(zoom);
        cloud.sprite.center.set(0.5 + shift / art.width, -lift / zoom);
        cloud.show(lit ? 'lit' : 'dark', art, lit ? CLOUD_LIT : CLOUD);
      } else {
        cloud.show(null);
      }
      showBolt(bolt, shape, shapes[shape], look);
      showBurst(burst, stage);
      return glow;
    },
  };
}

// --- Foudre en mini-cubes : l'éclair est un zigzag de petits cubes, comme le décor. Il descend
// du ciel, frappe en blanc, puis vole en éclats ---

const CUBE = 0.1;         // côté d'un cube
const CUBES_FALL = 0.16;  // fin de la descente
const CUBES_FLASH = 0.28; // fin de l'éclair blanc
const CUBES_BREAK = 0.42; // début de l'éclatement
const SPARKS = 10;

function strikeCubes({ group, top, right, random }) {
  const depth = new THREE.Vector3(-right.z, 0, right.x);

  // Sommets du zigzag, de la pointe vers le ciel : une diagonale, puis un décrochement à
  // contresens, comme sur les éclairs dessinés. Il serpente surtout dans le plan de l'écran.
  const corners = [top.clone()];
  const corner = (height, across) => top.clone()
    .addScaledVector(right, across)
    .addScaledVector(depth, (random() - 0.5) * 0.24)
    .setY(top.y + height);
  let lean = random() < 0.5 ? -1 : 1;
  let across = 0;
  for (let height = 0; height < 5.6;) {
    height += 0.4 + random() * 0.4;
    across += lean * (0.2 + random() * 0.2);
    corners.push(corner(height, across));
    height += 0.05;
    across -= lean * (0.15 + random() * 0.15);
    corners.push(corner(height, across));
    if (across < -0.4) lean = 1;
    else if (across > 0.4) lean = -1;
    else if (random() < 0.35) lean = -lean;
  }

  // Un cube tous les `CUBE`, rangés du ciel vers la pointe ; chacun sait où il s'envolera
  const cubes = [];
  for (let i = corners.length - 1; i > 0; i--) {
    const from = corners[i];
    const to = corners[i - 1];
    const count = Math.max(1, Math.round(from.distanceTo(to) / CUBE));
    for (let n = 0; n < count; n++) {
      const angle = random() * Math.PI * 2;
      const push = 0.3 + random() * 0.7;
      cubes.push({
        base: from.clone().lerp(to, n / count),
        drift: new THREE.Vector3(Math.cos(angle) * push, 0.2 + random() * 0.6, Math.sin(angle) * push),
        spin: new THREE.Vector3(random() * 8 - 4, random() * 8 - 4, random() * 8 - 4),
      });
    }
  }
  cubes.push({ base: top.clone(), drift: new THREE.Vector3(0, 0.5, 0), spin: new THREE.Vector3(3, 2, 1) });
  const sparks = Array.from({ length: SPARKS }, (_, i) => {
    const angle = (i / SPARKS) * Math.PI * 2 + random() * 0.4;
    return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  });

  const total = cubes.length + sparks.length;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const body = new THREE.MeshBasicMaterial({ color: GOLD });
  const hull = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  const outline = new THREE.InstancedMesh(box, hull, total); // contour : l'envers d'un cube plus grand
  const mesh = new THREE.InstancedMesh(box, body, total);
  outline.frustumCulled = false;
  mesh.frustumCulled = false;
  group.add(outline, mesh);

  const dummy = new THREE.Object3D();
  const write = (index, size) => {
    dummy.scale.setScalar(Math.max(size, 0.0001) * CUBE);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    dummy.scale.multiplyScalar(1.45);
    dummy.updateMatrix();
    outline.setMatrixAt(index, dummy.matrix);
  };

  return {
    update(t) {
      const shown = Math.ceil(cubes.length * clamp01(t / CUBES_FALL));
      const flash = t >= CUBES_FALL && t < CUBES_FLASH;
      const broken = clamp01((t - CUBES_BREAK) / (1 - CUBES_BREAK));
      // Comme les éclairs dessinés : blanc cerné d'or quand il frappe, or cerné de noir ensuite
      body.color.set(flash ? '#ffffff' : GOLD);
      hull.color.set(flash ? GOLD : INK);

      cubes.forEach((cube, i) => {
        dummy.position.copy(cube.base);
        dummy.rotation.set(0, 0, 0);
        let size = 0;
        if (i < shown) size = flash ? 1.35 : 1;
        if (broken > 0) {
          dummy.position.addScaledVector(cube.drift, broken);
          dummy.position.y -= 1.8 * broken * broken;
          dummy.rotation.set(cube.spin.x * broken, cube.spin.y * broken, cube.spin.z * broken);
          size *= 1 - broken;
        }
        write(i, size);
      });

      // Éclats qui jaillissent du point frappé
      const fly = clamp01((t - CUBES_FALL) / 0.45);
      sparks.forEach((dir, i) => {
        const reach = 0.12 + 0.75 * (1 - (1 - fly) ** 2);
        dummy.position.copy(top).addScaledVector(dir, reach);
        dummy.position.y += Math.sin(Math.PI * fly) * 0.3;
        dummy.rotation.set(fly * 5, fly * 3, 0);
        write(cubes.length + i, fly <= 0 || fly >= 1 ? 0 : 1 - fly);
      });

      mesh.instanceMatrix.needsUpdate = true;
      outline.instanceMatrix.needsUpdate = true;
      if (flash) return 1;
      return t >= CUBES_FLASH && t < CUBES_BREAK ? 0.3 : 0;
    },
    dispose() {
      box.dispose();
      body.dispose();
      hull.dispose();
      mesh.dispose();
      outline.dispose();
    },
  };
}

const BUILDERS = { bolt: strikeBolt, volley: strikeVolley, cloud: strikeCloud, cubes: strikeCubes };

// Construit la foudre qui frappe un pion.
//   top : sommet de sa tête ; ground : hauteur du dessus de sa case ;
//   right : la droite de l'écran, à plat (pour orienter le zigzag des mini-cubes) ;
//   random : source de hasard, pour la forme des éclairs.
// Retourne { group (à ajouter à la scène), update(t) -> lueur, dispose() }.
export function buildLightning(style, { top, ground, right, random = Math.random }) {
  const group = new THREE.Group();
  const strike = (BUILDERS[style] || BUILDERS[DEFAULT_LIGHTNING])({ group, top, ground, right, random });
  return {
    group,
    update: t => strike.update(t),
    dispose() {
      for (const item of strike.sprites || []) item.dispose();
      if (strike.dispose) strike.dispose();
    },
  };
}
