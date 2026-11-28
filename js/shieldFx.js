// Protecteur GP : le joueur se met à l'abri de la prochaine perte de GP.
//
// Plusieurs mises en scène à l'essai (essais.html), à la place de la bulle surmontée d'un symbole
// de bouclier. Chacune se construit avec buildShield(style, options) et se pilote par update(k),
// k allant de 0 à 1 sur la durée de l'effet. Elle anime aussi le pion (taille, lueur bleue), que
// dispose() remet en état.

import * as THREE from 'three';
import { EDGE, createGrid, put, gridFromRows } from './pixelGrid.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

export const SHIELD_STYLES = {
  drop: 'Bouclier tombé du ciel',
  ring: 'Ronde de boucliers',
  dome: 'Dôme de cubes',
  bubble: 'Bulle dessinée',
};

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
// Bosse de 0 à 1 autour de l'instant `at`, large de `width` de chaque côté
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);

const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const SPARK = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };
// Éclat en quatre images, à partir de l'instant `at` ; `item` le montre
function showBurst(item, k, at, span = 0.16, palette = SPARK) {
  const since = k - at;
  const stage = since < 0 || since >= span ? -1 : Math.floor((since / span) * BURST_STAGES);
  if (stage < 0) item.show(null);
  else item.show(`burst${stage}`, BURSTS[stage], palette);
}

// Le pion, protégé, luit en bleu. Retourne glow(amount) ; glow(0) le remet en état.
function blueGlow(mesh) {
  const materials = new Set();
  mesh.traverse((part) => {
    if (part.isMesh && part.material.emissive) materials.add(part.material);
  });
  return (amount) => {
    for (const material of materials) material.emissive.setRGB(0.12 * amount, 0.32 * amount, 0.85 * amount);
  };
}

// --- Le bouclier, en pixel art : écu bleu cerclé d'or, frappé d'une bosse dorée ---

const SHIELD = { [EDGE]: INK, 2: GOLD, 3: '#8fd0ff', 4: '#3f8cff', 5: '#fffbe6' };
const SHIELD_WHITE = { [EDGE]: GOLD, 2: '#ffffff', 3: '#ffffff', 4: '#ffffff', 5: '#ffffff' };
const SHIELD_ART = gridFromRows([
  '.GGGGGGGGG.',
  'GLLLLLBBBBG',
  'GLLLLLBBBBG',
  'GLLLGGGBBBG',
  'GLLGGWGGBBG',
  'GLLLGGGBBBG',
  'GLLLLLBBBBG',
  'GLLLLLBBBBG',
  '.GLLLLBBBG.',
  '.GLLLLBBBG.',
  '..GLLLBBG..',
  '...GLLBG...',
  '....GGG....',
], { G: 2, L: 3, B: 4, W: 5 });

// Le même, traversé par un reflet blanc en biais : une image par position du reflet
const SHINES = Array.from({ length: 6 }, (_, step) => {
  const grid = { ...SHIELD_ART, cells: SHIELD_ART.cells.slice() };
  const band = 3 + step * 4;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = y * grid.width + x;
      if (grid.cells[i] > EDGE && Math.abs(x + y - band) <= 1) grid.cells[i] = 5;
    }
  }
  return grid;
});

// --- Bouclier tombé du ciel : il se plante devant le pion, luit, puis se fond en lui ---

const DROP_LAND = 0.24;

function shieldDrop({ group, mesh, size, top, ground }) {
  const feet = new THREE.Vector3(top.x, ground, top.z);
  const item = pixelSprite(group, feet, SHIELD_ART.width, SHIELD_ART.height, 41, PIXEL * 0.7);
  item.sprite.center.set(0.5, 0);
  const burst = pixelSprite(group, feet, 15, 15, 40, PIXEL * 0.9);
  const glow = blueGlow(mesh);

  return {
    update(k) {
      const since = k - DROP_LAND;
      const melt = clamp01((k - 0.82) / 0.18); // il rétrécit et rentre dans le pion
      let height = 0;
      if (since < 0) height = (1 - (k / DROP_LAND) ** 2) * 3.4;          // la chute
      else if (since < 0.12) height = Math.sin((since / 0.12) * Math.PI) * 0.16; // un rebond
      item.sprite.position.set(feet.x, ground + height + melt * 0.15 * size, feet.z);
      item.material.rotation = since < 0 ? Math.sin(k * 42) * 0.22 * (1 - k / DROP_LAND) : 0;

      // Il s'écrase un instant en touchant la case
      const squash = since >= 0 ? Math.max(0, 1 - since / 0.03) : 0;
      const zoom = 1 - melt;
      item.sprite.scale.set(item.size.x * zoom * (1 + 0.14 * squash), item.size.y * zoom * (1 - 0.22 * squash), 1);

      if (k >= 0.99) item.show(null);
      else if (k >= 0.7 && k < 0.82) item.show('white', SHIELD_ART, SHIELD_WHITE);
      else if (k >= 0.42 && k < 0.68) {
        const step = Math.floor(((k - 0.42) / 0.26) * SHINES.length);
        item.show(`shine${step}`, SHINES[step], SHIELD);
      } else item.show('shield', SHIELD_ART, SHIELD);
      showBurst(burst, k, DROP_LAND);

      // Le pion sursaute à l'arrivée du bouclier, puis gonfle en l'absorbant
      const jolt = bump(k, DROP_LAND + 0.02, 0.04);
      const gulp = bump(k, 0.93, 0.07);
      mesh.scale.set(size * (1 + 0.08 * jolt + 0.12 * gulp), size * (1 - 0.14 * jolt + 0.12 * gulp), size * (1 + 0.08 * jolt + 0.12 * gulp));
      glow(Math.max(0, melt * (1 - melt) * 4));
    },
    dispose() {
      glow(0);
      item.dispose();
      burst.dispose();
    },
  };
}

// --- Ronde de boucliers : trois boucliers tournent autour du pion, se resserrent et s'y fondent ---

function shieldRing({ group, mesh, size, top, ground, camera }) {
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.45, top.z);
  const shields = [0, 1, 2].map(() => pixelSprite(group, centre, SHIELD_ART.width, SHIELD_ART.height, 41, PIXEL * 0.42));
  const burst = pixelSprite(group, centre, 15, 15, 42);
  const glow = blueGlow(mesh);
  const position = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);
  const CLOSE = 0.68; // début du resserrement
  const MERGE = 0.82; // les boucliers ont rejoint le pion

  return {
    update(k) {
      const closing = clamp01((k - CLOSE) / (MERGE - CLOSE));
      const radius = lerp(lerp(0.5, 0.33, clamp01(k / CLOSE)), 0, closing * closing);
      shields.forEach((item, i) => {
        if (k >= MERGE) {
          item.show(null);
          return;
        }
        const angle = (k * 2.2 + i / 3) * Math.PI * 2;
        position.set(centre.x + Math.cos(angle) * radius, centre.y, centre.z + Math.sin(angle) * radius);
        item.sprite.position.copy(position);
        // Derrière le pion, le bouclier est caché par lui
        item.material.depthTest = camera.position.distanceToSquared(position) > reach;
        item.setZoom(Math.max(0.001, popIn(clamp01(k / 0.12))));
        if (closing > 0.5) item.show('white', SHIELD_ART, SHIELD_WHITE);
        else item.show('shield', SHIELD_ART, SHIELD);
      });
      showBurst(burst, k, MERGE);
      const gulp = bump(k, MERGE + 0.04, 0.07);
      mesh.scale.setScalar(size * (1 + 0.14 * gulp));
      glow(clamp01(1 - Math.abs(k - (MERGE + 0.05)) / 0.13));
    },
    dispose() {
      glow(0);
      for (const item of shields) item.dispose();
      burst.dispose();
    },
  };
}

// --- Dôme de cubes : de petits cubes bleus montent en anneaux et se referment au-dessus du pion ---

const DOME_RADIUS = 0.46;
const DOME_CUBE = 0.1;
// Anneaux du dôme, de la base au sommet : [élévation en degrés, nombre de cubes]
const DOME_RINGS = [[10, 18], [32, 15], [53, 11], [72, 6], [90, 1]];
const DOME_LOW = new THREE.Color('#3f8cff');
const DOME_HIGH = new THREE.Color('#a9dcff');
const WHITE = new THREE.Color('#ffffff');

function shieldDome({ group, mesh, size, top, ground }) {
  const pivot = new THREE.Group(); // le dôme tourne lentement sur lui-même
  pivot.position.set(top.x, ground, top.z);
  group.add(pivot);
  const cubes = [];
  DOME_RINGS.forEach(([elevation, count], ring) => {
    const lift = (elevation * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const around = ((i + (ring % 2) * 0.5) / count) * Math.PI * 2;
      cubes.push({
        ring,
        around,
        at: new THREE.Vector3(Math.cos(around) * Math.cos(lift), Math.sin(lift), Math.sin(around) * Math.cos(lift)).multiplyScalar(DOME_RADIUS),
        color: DOME_LOW.clone().lerp(DOME_HIGH, ring / (DOME_RINGS.length - 1)),
      });
    }
  });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  const dome = new THREE.InstancedMesh(box, material, cubes.length);
  dome.frustumCulled = false;
  dome.renderOrder = 39;
  // Contour : l'envers de cubes un peu plus grands
  const edge = new THREE.MeshBasicMaterial({ color: '#1d3a7a', side: THREE.BackSide });
  const hull = new THREE.InstancedMesh(box, edge, cubes.length);
  hull.frustumCulled = false;
  pivot.add(hull, dome);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const glow = blueGlow(mesh);
  const last = DOME_RINGS.length - 1;

  return {
    update(k) {
      pivot.rotation.y = k * 1.4;
      const wave = ((k - 0.44) / 0.2) * (last + 1.2) - 0.6; // éclair blanc qui monte d'anneau en anneau
      cubes.forEach((cube, i) => {
        const born = clamp01((k - 0.05 - cube.ring * 0.07) / 0.09);
        const gone = clamp01((k - 0.8 - (last - cube.ring) * 0.03) / 0.08); // le sommet part le premier
        dummy.position.copy(cube.at).multiplyScalar(1 + 0.03 * Math.sin(k * 22));
        dummy.rotation.set(0, -cube.around, 0);
        dummy.scale.setScalar(Math.max(0.001, popIn(born) * (1 - gone)) * DOME_CUBE);
        dummy.updateMatrix();
        dome.setMatrixAt(i, dummy.matrix);
        dummy.scale.multiplyScalar(1.22);
        dummy.updateMatrix();
        hull.setMatrixAt(i, dummy.matrix);
        dome.setColorAt(i, color.copy(cube.color).lerp(WHITE, clamp01(1 - Math.abs(wave - cube.ring) / 0.7)));
      });
      dome.instanceMatrix.needsUpdate = true;
      dome.instanceColor.needsUpdate = true;
      hull.instanceMatrix.needsUpdate = true;
      mesh.scale.setScalar(size * (1 + 0.1 * bump(k, 0.6, 0.08)));
      glow(0.6 * bump(k, 0.6, 0.14));
    },
    dispose() {
      glow(0);
      box.dispose();
      material.dispose();
      edge.dispose();
      dome.dispose();
      hull.dispose();
    },
  };
}

// --- Bulle dessinée : une bulle en pixel art se referme sur le pion, puis éclate ---

const BUBBLE = { [EDGE]: '#1d3a7a', 2: '#5ab0ff', 3: '#cfeaff', 4: '#ffffff' };
const BUBBLE_SIZE = 19;
const RIM_REACH = 8.3; // rayon extérieur du cercle, en points

// La bulle : un cercle, un fond pointillé qui laisse voir le pion, et un reflet en haut à gauche
// (shifted : le reflet a glissé, pour la seconde image)
function bubbleGrid(shifted) {
  const grid = createGrid(BUBBLE_SIZE, BUBBLE_SIZE);
  const centre = (BUBBLE_SIZE - 1) / 2;
  const glint = shifted ? 3.75 : 3.95; // direction du reflet, en radians
  for (let y = 0; y < BUBBLE_SIZE; y++) {
    for (let x = 0; x < BUBBLE_SIZE; x++) {
      const reach = Math.hypot(x - centre, y - centre);
      const angle = Math.atan2(y - centre, x - centre) + Math.PI * 2;
      const off = Math.abs(((angle - glint + Math.PI) % (Math.PI * 2)) - Math.PI);
      // Rayon choisi pour que le cercle ait un méplat, et non une pointe, en haut, en bas et sur les côtés
      if (reach > 7.2 && reach <= RIM_REACH) put(grid, x, y, 2);
      else if (reach > 4.6 && reach <= 5.9 && off < 0.42) put(grid, x, y, 4);
      else if (reach <= 7.2 && (x + y) % 2 === 0) put(grid, x, y, 3);
    }
  }
  // Liseré, seulement autour du cercle : le fond pointillé n'en a pas
  const rim = (x, y) => x >= 0 && y >= 0 && x < BUBBLE_SIZE && y < BUBBLE_SIZE && grid.cells[y * BUBBLE_SIZE + x] === 2;
  for (let y = 0; y < BUBBLE_SIZE; y++) {
    for (let x = 0; x < BUBBLE_SIZE; x++) {
      const outside = Math.hypot(x - centre, y - centre) > RIM_REACH;
      if (outside && (rim(x - 1, y) || rim(x + 1, y) || rim(x, y - 1) || rim(x, y + 1))) put(grid, x, y, EDGE);
    }
  }
  return grid;
}
const BUBBLES = [bubbleGrid(false), bubbleGrid(true)];
// Taille de la bulle au fil de l'effet : [fin, taille]. Elle arrive grande et se resserre par à-coups.
const BUBBLE_SIZES = [[0.08, 2.4], [0.16, 1.7], [0.24, 1.25], [0.3, 0.92], [0.36, 1.07], [Infinity, 1]];
const BUBBLE_POP = 0.86;
const DROPLETS = { [EDGE]: '#1d3a7a', [RIM]: '#5ab0ff', [CORE]: '#ffffff' }; // elle éclate en gouttes

function shieldBubble({ group, mesh, size, top, ground }) {
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.5, top.z);
  const item = pixelSprite(group, centre, BUBBLE_SIZE, BUBBLE_SIZE, 41, PIXEL * 0.8);
  const burst = pixelSprite(group, centre, 15, 15, 42, PIXEL * 1.3);
  const glow = blueGlow(mesh);

  return {
    update(k) {
      if (k >= BUBBLE_POP) {
        item.show(null);
      } else {
        const frame = Math.floor(k * 9) % 2;
        item.show(`bubble${frame}`, BUBBLES[frame], BUBBLE);
        const breath = k > 0.36 ? 0.035 * (Math.floor(k * 14) % 2) : 0; // elle respire, par à-coups
        item.setZoom(BUBBLE_SIZES.find(([until]) => k < until)[1] + breath);
      }
      showBurst(burst, k, BUBBLE_POP, 0.13, DROPLETS);
      mesh.scale.setScalar(size * (1 + 0.12 * bump(k, 0.3, 0.05)));
      glow(k < 0.3 ? 0 : 0.35 * clamp01((1 - k) / 0.14));
    },
    dispose() {
      glow(0);
      item.dispose();
      burst.dispose();
    },
  };
}

const BUILDERS = { drop: shieldDrop, ring: shieldRing, dome: shieldDome, bubble: shieldBubble };

// Construit l'effet du Protecteur GP sur un pion.
//   mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de
//   sa case ; camera : la caméra (pour savoir ce qui passe derrière lui).
// Retourne { group (à ajouter à la scène), update(k), dispose() }. L'appelant remet le pion à sa taille.
export function buildShield(style, { mesh, size, top, ground, camera }) {
  const group = new THREE.Group();
  const shield = BUILDERS[style]({ group, mesh, size, top, ground, camera });
  return { group, update: k => shield.update(k), dispose: () => shield.dispose() };
}
