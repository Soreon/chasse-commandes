// Décor 3D autour du plateau : une île flottante en mini-cubes, sous un ciel de jour ou de nuit.
//
// Un mini-cube a la taille d'un « pixel » du dessus des cases (1/7 de case). Le sol est une
// grille de ces mini-cubes, chacun avec sa hauteur et sa couleur : dalles sous les cases,
// herbe autour, petites buttes, mares, et une tranche de terre et de roche sur le pourtour. Par
// dessus viennent des buissons, rochers, fleurs et cristaux, eux aussi en mini-cubes. Autour :
// des îlots qui flottent, des nuages qui dérivent, et le ciel de l'ambiance (soleil le jour,
// lune et étoiles la nuit).
//
// Tout est tiré d'une graine propre au plateau : un même plateau a toujours le même décor, et le
// hasard de la partie n'est jamais sollicité.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = 1 / 7;            // côté d'un mini-cube
const MARGIN = 7.2;         // largeur de décor autour du plateau, en cases
const EMPTY = -100;         // cellule hors de l'île

const GRASS = 0;
const PATH = 1;
const WATER = 2;
const SAND = 3;

// Quatre ambiances, choisies d'après le plateau. Chacune a ses couleurs et son heure :
// `sky` donne le dégradé du ciel (zénith, horizon, dessous), l'astre (soleil ou lune) et la
// teinte de la lumière.
const PALETTES = [
  { // prairie, en plein jour
    grass: ['#5fbf4a', '#52ad42', '#6bd055'], tuft: '#8ae36e', path: ['#9aa0b4', '#8a90a6', '#a9afc2'],
    dirt: ['#8a5a36', '#7a4d2e', '#96633c'], stone: ['#6f7488', '#5d6276', '#7d8296'],
    water: ['#3fa8f0', '#56b8ff', '#2f97e0'], sand: ['#e6d28a', '#d9c57c'],
    leaves: ['#2f9e44', '#3bb357', '#278a3b'], rock: ['#8d93a6', '#777d90', '#a2a8ba'],
    flowers: ['#ff6b8a', '#ffd84a', '#ffffff'], crystal: ['#71dff8', '#b9f1ff'],
    sky: {
      night: false, top: '#2f7fd8', horizon: '#a9d9ff', bottom: '#5aa7ea',
      body: '#fff6c8', bodyShade: '#ffe58a', glow: '#fff3b0',
      cloud: '#ffffff', cloudOpacity: 0.85,
      ambient: '#ffffff', ambientIntensity: 1.8, light: '#ffffff', lightIntensity: 2.5,
    },
  },
  { // automne, au coucher du soleil
    grass: ['#c9a544', '#b8943b', '#d6b352'], tuft: '#e6c765', path: ['#a59a8c', '#958a7c', '#b3a89a'],
    dirt: ['#7b4a2c', '#6c4026', '#875233'], stone: ['#746a66', '#645a57', '#827874'],
    water: ['#4a9bd0', '#62addf', '#3b8abf'], sand: ['#e0c98a', '#d2bb7c'],
    leaves: ['#e0662a', '#f08a2e', '#c94b22'], rock: ['#8c8580', '#77706b', '#a09994'],
    flowers: ['#ffe07a', '#ff9d5c', '#fff3d6'], crystal: ['#ffb86b', '#ffe2b0'],
    sky: {
      night: false, top: '#3a4a94', horizon: '#ffb673', bottom: '#d9785f',
      body: '#fff4d2', bodyShade: '#ffc45a', glow: '#ff9a4a',
      cloud: '#ffd9c4', cloudOpacity: 0.8,
      ambient: '#ffe6d6', ambientIntensity: 1.75, light: '#ffd3a0', lightIntensity: 2.4,
    },
  },
  { // neige, par un jour clair
    grass: ['#9db8d6', '#8eaacb', '#abc4df'], tuft: '#d3e3f4', path: ['#6f7f9c', '#62728e', '#7c8ca8'],
    dirt: ['#6f6a78', '#615c6a', '#7c7786'], stone: ['#5d6a84', '#4f5b74', '#6b7892'],
    water: ['#5fc4f0', '#7ad3f7', '#4bb3e2'], sand: ['#c3d3e6', '#b4c6dc'],
    leaves: ['#2f7d5c', '#e6eff8', '#276b4e'], rock: ['#7f8ca3', '#6d7a92', '#909db3'],
    flowers: ['#9fd8ff', '#ffffff', '#c9b6ff'], crystal: ['#9be8ff', '#e2f8ff'],
    sky: {
      night: false, top: '#5f95cf', horizon: '#dcebf8', bottom: '#9fc3e4',
      body: '#ffffff', bodyShade: '#f2f6ff', glow: '#ffffff',
      cloud: '#ffffff', cloudOpacity: 0.9,
      ambient: '#ffffff', ambientIntensity: 1.8, light: '#ffffff', lightIntensity: 2.4,
    },
  },
  { // crépuscule, de nuit
    grass: ['#5a4fb8', '#4f45a6', '#665bc8'], tuft: '#8a7ff0', path: ['#8d86b8', '#7d76a8', '#9c95c6'],
    dirt: ['#4a3566', '#402d59', '#553e73'], stone: ['#3f3b63', '#353155', '#4a4671'],
    water: ['#3fd0d8', '#5ee0e6', '#2fbcc6'], sand: ['#b8a8e0', '#a898d2'],
    leaves: ['#e05fb0', '#f07cc4', '#c94c9c'], rock: ['#7a74a6', '#676194', '#8e88b8'],
    flowers: ['#ffe36b', '#7ff0e0', '#ffffff'], crystal: ['#b06cff', '#e2c8ff'],
    sky: {
      night: true, top: '#070919', horizon: '#2c2558', bottom: '#12122e',
      body: '#f1f4ff', bodyShade: '#c5cdf0', glow: '#9fb0ff',
      cloud: '#8f9bd0', cloudOpacity: 0.5,
      ambient: '#b4bcff', ambientIntensity: 1.65, light: '#dbe1ff', lightIntensity: 2.2,
    },
  },
];

// Hasard à graine, indépendant de celui de la partie
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Valeur pseudo-aléatoire stable pour un point de grille
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Bruit lissé : variations douces pour le contour de l'île et les buttes
function smoothNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const smoothstep = (from, to, value) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
const pickAt = (list, r) => list[Math.floor(r * list.length) % list.length];

const SIDES = [
  { di: 1, dj: 0, normal: [1, 0, 0] },
  { di: -1, dj: 0, normal: [-1, 0, 0] },
  { di: 0, dj: 1, normal: [0, 0, 1] },
  { di: 0, dj: -1, normal: [0, 0, -1] },
];

// Surface faite de faces carrées colorées, assemblée en un seul maillage
function createSurface() {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const tint = new THREE.Color();

  const quad = (a, b, c, d, normal, hex, shade = 1) => {
    const base = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    tint.set(hex).multiplyScalar(shade);
    for (let v = 0; v < 4; v++) {
      normals.push(...normal);
      colors.push(tint.r, tint.g, tint.b);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // Dessus d'un mini-cube, à la hauteur y
  const top = (xa, xb, za, zb, y, hex) => {
    quad([xa, y, za], [xa, y, zb], [xb, y, zb], [xb, y, za], [0, 1, 0], hex);
  };
  // Flanc d'un mini-cube, tourné vers `side`, entre les hauteurs y0 et y1
  const wall = (side, xa, xb, za, zb, y0, y1, hex) => {
    const shade = side.normal[0] !== 0 ? 0.86 : 0.93; // léger contraste entre les orientations
    if (side.di === 1) quad([xb, y0, za], [xb, y1, za], [xb, y1, zb], [xb, y0, zb], side.normal, hex, shade);
    else if (side.di === -1) quad([xa, y0, zb], [xa, y1, zb], [xa, y1, za], [xa, y0, za], side.normal, hex, shade);
    else if (side.dj === 1) quad([xb, y0, zb], [xb, y1, zb], [xa, y1, zb], [xa, y0, zb], side.normal, hex, shade);
    else quad([xa, y0, za], [xa, y1, za], [xb, y1, za], [xb, y0, za], side.normal, hex, shade);
  };
  // Mini-cube entier, centré en (x, y, z), sans son dessous (jamais vu)
  const cube = (x, y, z, hex) => {
    const h = V / 2;
    top(x - h, x + h, z - h, z + h, y + h, hex);
    for (const side of SIDES) wall(side, x - h, x + h, z - h, z + h, y - h, y + h, hex);
  };

  return {
    top,
    wall,
    cube,
    get faceCount() {
      return indices.length / 6;
    },
    toGeometry() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      return geometry;
    },
  };
}

// Disque en gros pixels pour le soleil ou la lune
function celestialTexture(sky) {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 7.6) continue;
      ctx.fillStyle = sky.body;
      if (sky.night) {
        // Lune : quelques cratères
        const crater = Math.hypot(x - 5, y - 5) < 1.6 || Math.hypot(x - 10, y - 8) < 2.1 || Math.hypot(x - 6, y - 11) < 1.3;
        if (crater) ctx.fillStyle = sky.bodyShade;
      } else if (d > 5.6) {
        // Soleil : un bord plus chaud
        ctx.fillStyle = sky.bodyShade;
      }
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Halo doux autour de l'astre
function glowTexture(sky) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
  const glow = new THREE.Color(sky.glow).convertLinearToSRGB();
  const rgb = `${Math.round(glow.r * 255)}, ${Math.round(glow.g * 255)}, ${Math.round(glow.b * 255)}`;
  gradient.addColorStop(0, `rgba(${rgb}, 0.75)`);
  gradient.addColorStop(0.35, `rgba(${rgb}, 0.28)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// tiles : [{ x, z }] centres des cases ; bounds : { minX, maxX, minZ, maxZ } ;
// gradientMap : dégradé de l'ombrage « toon ».
// Retourne { group, lighting, night, stats, update(dt), dispose() }.
export function buildEnvironment({ tiles, bounds, gradientMap, seed }) {
  const rand = seededRandom(seed);
  const palette = PALETTES[seed % PALETTES.length];
  const sky = palette.sky;
  const pick = list => list[Math.floor(rand() * list.length)];

  const group = new THREE.Group();
  const disposables = [];
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + MARGIN;

  // === Île principale ===

  const x0 = bounds.minX - MARGIN;
  const z0 = bounds.minZ - MARGIN;
  const nx = Math.ceil((bounds.maxX - bounds.minX + 2 * MARGIN) / V);
  const nz = Math.ceil((bounds.maxZ - bounds.minZ + 2 * MARGIN) / V);
  const height = new Int8Array(nx * nz).fill(EMPTY);
  const kind = new Uint8Array(nx * nz);
  const tileDist = new Float32Array(nx * nz);   // distance à la case la plus proche
  const footprint = new Float32Array(nx * nz);  // la même, mesurée « en carré »
  const coastDist = new Float32Array(nx * nz);  // distance au bord de l'île
  // `wild` : de 0 près des cases (sol uni, rien dessus, pour la lisibilité du jeu) à 1 sur le
  // pourtour (relief, mouchetures, décor). Il ne dépend que de la distance aux cases et varie
  // en douceur : aucune limite droite ne se voit dans le sol.
  const wild = new Float32Array(nx * nz);
  const at = (i, j) => j * nx + i;
  const worldX = i => x0 + (i + 0.5) * V;
  const worldZ = j => z0 + (j + 0.5) * V;

  // 1. Contour : tout ce qui est assez près d'une case, avec une portée qui ondule.
  //    La forme suit donc le plateau, sans aucun bord droit.
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = worldX(i);
      const z = worldZ(j);
      let nearest = Infinity;
      let square = Infinity;
      for (const tile of tiles) {
        const dx = Math.abs(x - tile.x);
        const dz = Math.abs(z - tile.z);
        nearest = Math.min(nearest, Math.hypot(dx, dz));
        square = Math.min(square, Math.max(dx, dz));
      }
      const k = at(i, j);
      tileDist[k] = nearest;
      footprint[k] = square;
      const reach = 4.6 + 2.2 * smoothNoise(x * 0.24, z * 0.24, seed);
      if (nearest <= reach) {
        height[k] = 0;
        coastDist[k] = reach - nearest;
      }
    }
  }

  // 2. Les trous enfermés dans l'île (creux au milieu du plateau) sont comblés : on part du bord
  //    de la grille et on parcourt le vide ; ce qu'on n'atteint pas est entouré de terre.
  const outside = new Uint8Array(nx * nz);
  const queue = [];
  const visit = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const k = at(i, j);
    if (outside[k] || height[k] !== EMPTY) return;
    outside[k] = 1;
    queue.push(k);
  };
  for (let i = 0; i < nx; i++) { visit(i, 0); visit(i, nz - 1); }
  for (let j = 0; j < nz; j++) { visit(0, j); visit(nx - 1, j); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] % nx;
    const j = Math.floor(queue[q] / nx);
    visit(i + 1, j); visit(i - 1, j); visit(i, j + 1); visit(i, j - 1);
  }
  for (let k = 0; k < height.length; k++) {
    if (height[k] === EMPTY && !outside[k]) {
      height[k] = 0;
      coastDist[k] = 2;
    }
  }

  // 3. Nature de chaque cellule
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = at(i, j);
      if (height[k] === EMPTY) continue;
      const x = worldX(i);
      const z = worldZ(j);
      if (footprint[k] < 0.58) {
        kind[k] = PATH;
        continue;
      }
      kind[k] = GRASS;
      // La frontière entre sol nu et sol sauvage ondule elle aussi, et le passage s'étale sur
      // près de quatre cases de distance
      const wobble = (smoothNoise(x * 0.55 + 80, z * 0.55 + 80, seed) - 0.5) * 1.6;
      wild[k] = smoothstep(1.1, 5.0, tileDist[k] + wobble);
      const hill = smoothNoise(x * 0.6 + 40, z * 0.6 + 40, seed);
      if (wild[k] > 0.7 && coastDist[k] > 0.5 && hill > 0.64) height[k] = hill > 0.8 ? 2 : 1;
    }
  }

  // Mares : creux d'eau bordés de sable, à l'écart des cases
  const pondSpots = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = at(i, j);
      if (height[k] === 0 && kind[k] === GRASS && wild[k] > 0.85 && coastDist[k] > 1.1) pondSpots.push([i, j]);
    }
  }
  for (let p = 0; p < 3 && pondSpots.length > 0; p++) {
    const [ci, cj] = pondSpots[Math.floor(rand() * pondSpots.length)];
    const radius = (0.45 + rand() * 0.35) / V;
    for (let j = Math.max(0, Math.floor(cj - radius - 2)); j <= Math.min(nz - 1, cj + radius + 2); j++) {
      for (let i = Math.max(0, Math.floor(ci - radius - 2)); i <= Math.min(nx - 1, ci + radius + 2); i++) {
        const k = at(i, j);
        if (height[k] === EMPTY || kind[k] === PATH || wild[k] < 0.6) continue;
        const d = Math.hypot(i - ci, j - cj) + (hash2(i, j, seed) - 0.5) * 1.5;
        if (d < radius) {
          kind[k] = WATER;
          height[k] = -1;
        } else if (d < radius + 1.6 && kind[k] === GRASS) {
          kind[k] = SAND;
          height[k] = 0;
        }
      }
    }
  }

  // Touffes d'herbe : un mini-cube qui dépasse çà et là, de plus en plus en s'éloignant des cases
  const tufts = new Uint8Array(nx * nz);
  for (let k = 0; k < height.length; k++) {
    if (height[k] === 0 && kind[k] === GRASS && hash2(k, 7, seed) < 0.045 * wild[k]) {
      height[k] = 1;
      tufts[k] = 1;
    }
  }

  // Maillage du sol : une face par mini-cube visible
  const KIND_COLORS = [palette.grass, palette.path, palette.water, palette.sand];
  const shadeOf = (i, j) => {
    const k = at(i, j);
    const shades = KIND_COLORS[kind[k]];
    // Près des cases : une seule teinte, à peine mouchetée ; les mouchetures gagnent peu à peu
    // en s'éloignant
    if (kind[k] === GRASS && hash2(i * 11 + 1, j * 13 + 2, seed) > 0.05 + 0.62 * wild[k]) return shades[0];
    return pickAt(shades, hash2(i * 3, j * 5, seed));
  };
  // Couleur d'une tranche de flanc selon sa profondeur sous la surface : matière, terre, roche
  const layerColor = (i, j, depth, surface, salt = 0) => {
    const r = hash2(i * 7 + depth, j * 11 + depth, seed + salt);
    if (depth === 0) return pickAt(surface, r);
    if (depth <= 3) return pickAt(palette.dirt, r);
    return pickAt(palette.stone, r);
  };

  const ground = createSurface();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = at(i, j);
      const h = height[k];
      if (h === EMPTY) continue;
      const xa = x0 + i * V;
      const xb = xa + V;
      const za = z0 + j * V;
      const zb = za + V;
      ground.top(xa, xb, za, zb, h * V, tufts[k] ? palette.tuft : shadeOf(i, j));

      const surface = KIND_COLORS[kind[k] === WATER ? SAND : kind[k]];
      for (const side of SIDES) {
        const ni = i + side.di;
        const nj = j + side.dj;
        const neighbor = ni < 0 || nj < 0 || ni >= nx || nj >= nz ? EMPTY : height[at(ni, nj)];
        if (neighbor >= h) continue;
        // Au bord de l'île, le flanc descend en dents irrégulières
        const bottom = neighbor === EMPTY ? h - 6 - Math.floor(hash2(i, j, seed + 3) * 5) : neighbor;
        for (let level = h; level > bottom; level--) {
          const hex = tufts[k] && level === h ? palette.tuft : layerColor(i, j, h - level, surface);
          ground.wall(side, xa, xb, za, zb, (level - 1) * V, level * V, hex);
        }
      }
    }
  }

  const terrainGeometry = ground.toGeometry();
  const terrainMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, side: THREE.DoubleSide });
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.receiveShadow = true;
  group.add(terrain);
  disposables.push(terrainGeometry, terrainMaterial);

  // === Buissons, rochers, fleurs, cristaux ===

  // Buissons : des masses basses et rondes, plus petites qu'un cube du plateau, donc sans risque
  // de masquer le jeu. `layers` : rayon (en mini-cubes) étage par étage, de bas en haut.
  const BUSH_SIZES = [
    { layers: [1.5, 1.1], weight: 5 },
    { layers: [2.3, 2.5, 1.6], weight: 3 },
    { layers: [3.0, 3.5, 2.9, 1.7], weight: 1 },
  ];
  const BUSH_WEIGHT = BUSH_SIZES.reduce((sum, size) => sum + size.weight, 0);
  const pickBush = () => {
    let roll = rand() * BUSH_WEIGHT;
    for (const size of BUSH_SIZES) {
      roll -= size.weight;
      if (roll < 0) return size;
    }
    return BUSH_SIZES[0];
  };
  // Dessine un buisson en appelant place(di, dj, étage, couleur) pour chacun de ses mini-cubes
  const bushShape = (size, place) => {
    const layers = size.layers.length;
    const blooming = rand() < 0.35; // certains buissons sont en fleurs
    const bloom = pick(palette.flowers);
    size.layers.forEach((radius, layer) => {
      const shade = layer === 0 ? palette.leaves[2] : layer === layers - 1 ? palette.leaves[1] : palette.leaves[0];
      const reach = Math.ceil(radius);
      for (let dj = -reach; dj <= reach + 1; dj++) {
        for (let di = -reach; di <= reach + 1; di++) {
          const d = Math.hypot(di - 0.5, dj - 0.5);
          if (d > radius) continue;
          if (d > radius - 0.8 && rand() < 0.28) continue; // bord irrégulier
          // Cœur du buisson : entouré de toutes parts, donc invisible. On ne le crée pas.
          const coveredAbove = layer < layers - 1 && d <= size.layers[layer + 1] - 0.9;
          if (d < radius - 1.5 && coveredAbove) continue;
          const onTop = layer === layers - 1 || d > size.layers[layer + 1];
          place(di, dj, layer, blooming && onTop && rand() < 0.22 ? bloom : (rand() < 0.2 ? pick(palette.leaves) : shade));
        }
      }
    });
  };

  const voxels = []; // { x, y, z, hex }
  const occupied = new Set();
  const put = (i, j, level, hex) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    // Un mini-cube de décor ne doit jamais coïncider avec le sol (butte, touffe) ni avec un autre :
    // deux faces au même endroit scintillent à l'écran
    const base = height[at(i, j)];
    if (base === EMPTY || level < base) return;
    const key = `${i},${j},${level}`;
    if (occupied.has(key)) return;
    occupied.add(key);
    voxels.push({ x: worldX(i), y: (level + 0.5) * V, z: worldZ(j), hex });
  };
  const free = (i, j) => {
    if (i < 1 || j < 1 || i >= nx - 1 || j >= nz - 1) return false;
    const k = at(i, j);
    return height[k] !== EMPTY && kind[k] === GRASS && !tufts[k];
  };
  const rock = (i, j, base) => {
    for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (rand() < 0.85) put(i + di, j + dj, base, pick(palette.rock));
    }
    if (rand() < 0.7) put(i + (rand() < 0.5 ? 0 : 1), j + (rand() < 0.5 ? 0 : 1), base + 1, pick(palette.rock));
  };
  const flower = (i, j, base) => {
    put(i, j, base, palette.leaves[0]);
    put(i, j, base + 1, pick(palette.flowers));
  };
  const crystal = (i, j, base) => {
    const tall = 2 + Math.floor(rand() * 3);
    for (let y = 0; y < tall; y++) put(i, j, base + y, palette.crystal[y === tall - 1 ? 1 : 0]);
    if (rand() < 0.7) for (let y = 0; y < tall - 1; y++) put(i + 1, j, base + y, palette.crystal[0]);
    if (rand() < 0.5) put(i, j + 1, base, palette.crystal[0]);
  };

  // Semis sur une grille lâche, avec un peu de désordre
  let bushes = 0;
  const step = 5;
  for (let j = 2; j < nz - 2; j += step) {
    for (let i = 2; i < nx - 2; i += step) {
      const ci = i + Math.floor(rand() * step);
      const cj = j + Math.floor(rand() * step);
      if (!free(ci, cj)) continue;
      const k = at(ci, cj);
      // Le décor se raréfie en approchant des cases, jusqu'à disparaître
      if (coastDist[k] < 0.3 || rand() > wild[k] * wild[k]) continue;
      const base = height[k];
      const roll = rand();
      if (roll < 0.34) {
        bushShape(pickBush(), (di, dj, layer, hex) => put(ci + di, cj + dj, base + layer, hex));
        bushes++;
      } else if (roll < 0.46) rock(ci, cj, base);
      else if (roll < 0.68) flower(ci, cj, base);
      else if (roll < 0.73 && coastDist[k] > 0.6) crystal(ci, cj, base);
    }
  }

  if (voxels.length > 0) {
    const cube = new THREE.BoxGeometry(V, V, V);
    const material = new THREE.MeshToonMaterial({ gradientMap });
    const decor = new THREE.InstancedMesh(cube, material, voxels.length);
    const matrix = new THREE.Matrix4();
    const tint = new THREE.Color();
    voxels.forEach((voxel, n) => {
      matrix.makeTranslation(voxel.x, voxel.y, voxel.z);
      decor.setMatrixAt(n, matrix);
      decor.setColorAt(n, tint.set(voxel.hex));
    });
    decor.instanceMatrix.needsUpdate = true;
    decor.instanceColor.needsUpdate = true;
    // Ombre portée, mais pas reçue : sur d'aussi petits cubes elle se traduit par des rayures
    decor.castShadow = true;
    group.add(decor);
    disposables.push(cube, material);
  }

  // === Îlots éparpillés autour de l'île ===
  // De petits morceaux de terre qui flottent à des hauteurs variées : sans eux, l'île ferait
  // un seul gros bloc posé dans le vide.

  // Distance du centre au bord de l'île dans une direction donnée
  const edgeDistance = (angle) => {
    let reached = 0;
    for (let d = 0; d < span * 1.6; d += V * 2) {
      const i = Math.floor((centerX + Math.cos(angle) * d - x0) / V);
      const j = Math.floor((centerZ + Math.sin(angle) * d - z0) / V);
      if (i >= 0 && j >= 0 && i < nx && j < nz && height[at(i, j)] !== EMPTY) reached = d;
    }
    return reached;
  };
  // Vrai si de la terre de l'île se trouve à moins de `clearance` du point
  const islandWithin = (x, z, clearance) => {
    const i0 = Math.max(0, Math.floor((x - clearance - x0) / V));
    const i1 = Math.min(nx - 1, Math.floor((x + clearance - x0) / V));
    const j0 = Math.max(0, Math.floor((z - clearance - z0) / V));
    const j1 = Math.min(nz - 1, Math.floor((z + clearance - z0) / V));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (height[at(i, j)] !== EMPTY && Math.hypot(worldX(i) - x, worldZ(j) - z) < clearance) return true;
      }
    }
    return false;
  };

  // Un îlot de `radius` mini-cubes de rayon, centré sur l'origine de son maillage
  const buildIslet = (radius, salt) => {
    // Colonnes de mini-cubes : un dessus plat (parfois une butte) et un dessous en pointe
    const columns = new Map();
    for (let j = -radius - 1; j <= radius + 1; j++) {
      for (let i = -radius - 1; i <= radius + 1; i++) {
        const d = Math.hypot(i + 0.5, j + 0.5) + (hash2(i, j, seed + salt) - 0.5) * 1.8;
        if (d > radius) continue;
        const depth = 2 + Math.round((1 - d / radius) * radius * 1.15 + hash2(i * 3, j * 7, seed + salt) * 2);
        const bump = radius > 5 && d < radius * 0.6 && smoothNoise(i * 0.35 + salt, j * 0.35, seed) > 0.58 ? 1 : 0;
        columns.set(`${i},${j}`, { i, j, top: bump, bottom: -depth });
      }
    }

    const surface = createSurface();
    for (const column of columns.values()) {
      const { i, j } = column;
      const xa = i * V;
      const xb = xa + V;
      const za = j * V;
      const zb = za + V;
      const speck = hash2(i * 3, j * 5, seed + salt);
      surface.top(xa, xb, za, zb, column.top * V, speck < 0.05 ? palette.tuft : pickAt(palette.grass, speck));
      for (const side of SIDES) {
        const neighbor = columns.get(`${i + side.di},${j + side.dj}`);
        for (let level = column.top; level > column.bottom; level--) {
          // Cette tranche est cachée si la colonne voisine la couvre
          if (neighbor && level <= neighbor.top && level > neighbor.bottom) continue;
          surface.wall(side, xa, xb, za, zb, (level - 1) * V, level * V, layerColor(i, j, column.top - level, palette.grass, salt));
        }
      }
    }

    // Un peu de vie dessus, sans que deux mini-cubes se superposent
    const used = new Set();
    const place = (i, j, level, hex) => {
      const column = columns.get(`${i},${j}`);
      const key = `${i},${j},${level}`;
      if (!column || used.has(key)) return;
      used.add(key);
      surface.cube((i + 0.5) * V, (column.top + level + 0.5) * V, (j + 0.5) * V, hex);
    };
    const inner = [...columns.values()].filter(c => Math.hypot(c.i + 0.5, c.j + 0.5) < radius - 1.6);
    if (inner.length > 0) {
      const spot = () => inner[Math.floor(rand() * inner.length)];
      // Un îlot sur deux porte un buisson, quelques-uns un cristal
      const roll = rand();
      if (roll < 0.55) {
        const anchor = radius >= 7 ? spot() : { i: 0, j: 0 };
        bushShape(radius >= 7 ? BUSH_SIZES[1] : BUSH_SIZES[0], (di, dj, layer, hex) => place(anchor.i + di, anchor.j + dj, layer, hex));
      } else if (roll < 0.75) {
        const anchor = spot();
        const tall = 2 + Math.floor(rand() * 3);
        for (let y = 0; y < tall; y++) place(anchor.i, anchor.j, y, palette.crystal[y === tall - 1 ? 1 : 0]);
      }
      // Fleurs et cailloux sur les plus grands, qui feraient sinon des disques nus
      const extras = Math.floor(inner.length / 26);
      for (let n = 0; n < extras; n++) {
        const cell = spot();
        if (rand() < 0.65) {
          place(cell.i, cell.j, 0, palette.leaves[0]);
          place(cell.i, cell.j, 1, pick(palette.flowers));
        } else {
          place(cell.i, cell.j, 0, pick(palette.rock));
        }
      }
    }
    return surface.toGeometry();
  };

  const islets = [];
  const placed = [];
  const wanted = 12 + Math.floor(rand() * 6);
  for (let attempt = 0; attempt < wanted * 6 && islets.length < wanted; attempt++) {
    const angle = rand() * Math.PI * 2;
    // Surtout des petits, quelques gros ; la plupart près de la côte, quelques-uns au large
    const radius = 3 + Math.floor(rand() * rand() * 13);
    const size = radius * V;
    const distance = edgeDistance(angle) + size + 0.9 + rand() * rand() * 7.5;
    const x = centerX + Math.cos(angle) * distance;
    const z = centerZ + Math.sin(angle) * distance;
    if (islandWithin(x, z, size + 0.7)) continue;
    if (placed.some(p => Math.hypot(p.x - x, p.z - z) < p.size + size + 0.8)) continue;
    placed.push({ x, z, size });

    const geometry = buildIslet(radius, 100 + attempt * 17);
    disposables.push(geometry);
    const mesh = new THREE.Mesh(geometry, terrainMaterial);
    // La plupart flottent plus bas que l'île. Ceux du fond sont remontés : vus de face, l'île
    // les cacherait.
    const behind = Math.max(0, -Math.sin(angle));
    const baseY = -2.8 + rand() * 3.4 + behind * 1.6;
    mesh.position.set(x, baseY, z);
    group.add(mesh);
    islets.push({ mesh, baseY, phase: rand() * Math.PI * 2, speed: 0.35 + rand() * 0.4 });
  }

  // === Nuages en gros blocs, qui dérivent sous et derrière l'île ===

  const clouds = [];
  // Deux passes : la première n'écrit que la profondeur, la seconde ne colore donc que la
  // surface visible. Le nuage reste translucide, sans laisser voir sa composition interne.
  // Les deux passes sont rangées avec les objets translucides : celle de profondeur est dessinée
  // juste avant celle de couleur du même nuage, après tout le reste du décor.
  const cloudDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true });
  disposables.push(cloudDepthMaterial);
  const block = V * 3;
  for (let c = 0; c < 10; c++) {
    // Marche au hasard, chaque position n'étant prise qu'une fois
    const cells = new Set();
    let px = 0;
    let pz = 0;
    const count = 8 + Math.floor(rand() * 10);
    for (let n = 0; n < count; n++) {
      cells.add(`${px},0,${pz}`);
      if (rand() < 0.25) cells.add(`${px},1,${pz}`);
      if (rand() < 0.7) px += rand() < 0.5 ? 1 : -1;
      else pz += rand() < 0.5 ? 1 : -1;
    }
    const parts = [...cells].map((cell) => {
      const [cx, cy, cz] = cell.split(',').map(Number);
      const box = new THREE.BoxGeometry(block, block, block);
      box.translate(cx * block, cy * block, cz * block);
      return box;
    });
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    disposables.push(geometry);

    // Une matière par nuage : chacun s'efface à son rythme en arrivant au bout de sa course
    const material = new THREE.MeshToonMaterial({
      color: sky.cloud, gradientMap, transparent: true, opacity: sky.cloudOpacity, depthWrite: false,
    });
    disposables.push(material);
    const cloud = new THREE.Group();
    cloud.add(new THREE.Mesh(geometry, cloudDepthMaterial), new THREE.Mesh(geometry, material));
    // Les premiers passent sous l'île, parmi les îlots ; les autres flottent loin derrière
    const below = c < 6;
    cloud.position.set(
      centerX + (rand() * 2 - 1) * (span + 8),
      below ? -1.8 - rand() * 3.0 : 2.5 + rand() * 3,
      below ? centerZ + (rand() * 2 - 1) * (span + 4) : bounds.minZ - MARGIN - 4 - rand() * 8,
    );
    cloud.scale.setScalar(below ? 1.2 + rand() : 1.6 + rand());
    group.add(cloud);
    clouds.push({ mesh: cloud, material, speed: 0.05 + rand() * 0.12 });
  }

  // === Ciel ===

  // Voûte : dégradé du zénith à l'horizon, puis vers le dessous (on regarde l'île d'en haut,
  // c'est donc surtout cette partie basse qui sert de fond)
  const domeRadius = 420;
  const domeGeometry = new THREE.SphereGeometry(domeRadius, 32, 20);
  const zenith = new THREE.Color(sky.top);
  const horizon = new THREE.Color(sky.horizon);
  const nadir = new THREE.Color(sky.bottom);
  const domeColors = [];
  const shade = new THREE.Color();
  const domePositions = domeGeometry.attributes.position;
  for (let v = 0; v < domePositions.count; v++) {
    const t = domePositions.getY(v) / domeRadius;
    if (t >= 0) shade.copy(horizon).lerp(zenith, t ** 0.6);
    else shade.copy(horizon).lerp(nadir, (-t) ** 0.55);
    domeColors.push(shade.r, shade.g, shade.b);
  }
  domeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(domeColors, 3));
  const domeMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.position.set(centerX, 0, centerZ);
  dome.renderOrder = -10;
  group.add(dome);
  disposables.push(domeGeometry, domeMaterial);

  // Soleil ou lune, en gros pixels, avec son halo. Placé derrière le plateau et bas dans le
  // ciel : on regarde le jeu d'en haut, un astre au zénith ne se verrait jamais. De face, il
  // dépasse du bord du fond de l'île dans le cadrage de départ, et se voit en entier dès qu'on
  // recule la caméra.
  const bodyDirection = new THREE.Vector3(0.244, -0.334, -0.911).normalize();
  const bodyPosition = new THREE.Vector3(centerX, 0, centerZ).addScaledVector(bodyDirection, 320);
  const bodyTexture = celestialTexture(sky);
  const haloTexture = glowTexture(sky);
  const haloMaterial = new THREE.SpriteMaterial({ map: haloTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const bodyMaterial = new THREE.SpriteMaterial({ map: bodyTexture, transparent: true, depthWrite: false });
  const halo = new THREE.Sprite(haloMaterial);
  halo.position.copy(bodyPosition);
  halo.scale.setScalar(sky.night ? 110 : 150);
  halo.renderOrder = -9;
  const body = new THREE.Sprite(bodyMaterial);
  body.position.copy(bodyPosition);
  body.scale.setScalar(sky.night ? 34 : 38);
  body.renderOrder = -8;
  group.add(halo, body);
  disposables.push(bodyTexture, haloTexture, haloMaterial, bodyMaterial);

  // Étoiles, la nuit seulement, tout autour (y compris sous l'île, qui flotte)
  if (sky.night) {
    const starPositions = [];
    for (let s = 0; s < 420; s++) {
      const angle = rand() * Math.PI * 2;
      const elevation = Math.asin(rand() * 1.8 - 0.9);
      const radius = 380;
      starPositions.push(
        centerX + Math.cos(angle) * Math.cos(elevation) * radius,
        Math.sin(elevation) * radius,
        centerZ + Math.sin(angle) * Math.cos(elevation) * radius,
      );
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xdfe6ff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false });
    const stars = new THREE.Points(starGeometry, starMaterial);
    stars.renderOrder = -9;
    group.add(stars);
    disposables.push(starGeometry, starMaterial);
  }

  let time = 0;
  // Course des nuages : de -limit à +limit autour du centre. Sur les derniers CLOUD_FADE de
  // chaque bout, le nuage se dissipe (ou se reforme) au lieu de disparaître d'un coup.
  const limit = span + 14;
  const CLOUD_FADE = 6;
  const placeCloud = (cloud) => {
    const fade = smoothstep(0, CLOUD_FADE, limit - Math.abs(cloud.mesh.position.x - centerX));
    cloud.material.opacity = sky.cloudOpacity * fade;
    // Un nuage effacé ne doit plus rien masquer non plus
    cloud.mesh.visible = fade > 0.01;
  };
  for (const cloud of clouds) placeCloud(cloud);
  return {
    group,
    // Teinte de la lumière de l'ambiance, appliquée par la vue 3D tant que le décor est affiché
    lighting: {
      ambient: sky.ambient, ambientIntensity: sky.ambientIntensity,
      light: sky.light, lightIntensity: sky.lightIntensity,
    },
    night: sky.night,
    // Chiffres utiles au journal technique
    stats: { groundCells: ground.faceCount, decorCubes: voxels.length, bushes, islets: islets.length, clouds: clouds.length },
    update(dt) {
      time += dt;
      for (const cloud of clouds) {
        cloud.mesh.position.x += cloud.speed * dt;
        if (cloud.mesh.position.x > centerX + limit) cloud.mesh.position.x = centerX - limit;
        placeCloud(cloud);
      }
      // Les îlots flottent doucement
      for (const islet of islets) {
        islet.mesh.position.y = islet.baseY + Math.sin(time * islet.speed + islet.phase) * 0.09;
      }
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
