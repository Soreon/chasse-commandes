// Aimant GP : le joueur touche des GP pour chaque case possédée par ses adversaires.
//
// Plusieurs mises en scène à l'essai (essais.html), à la place des symboles de pièce qui
// arrivent en tourbillon. Chacune se construit avec buildMagnet(style, options) et se pilote par
// update(k), k allant de 0 à 1 sur la durée de l'effet. Les pièces partent des cases adverses
// (`sources`) et rejoignent le pion, qui grossit et luit ; dispose() éteint la lueur, l'appelant
// remet la taille.

import * as THREE from 'three';
import { EDGE, gridFromRows } from './pixelGrid.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { COIN_FRAMES, COIN_PALETTE, COIN_SIZE } from './coinArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

export const MAGNET_STYLES = {
  drop: 'Aimant tombé du ciel',
  ring: 'Ronde de pièces',
  leap: 'Pièces bondissantes',
  waves: 'Ondes d’aimant',
};

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const clamp01 = v => Math.max(0, Math.min(1, v));
const easeOut = t => 1 - (1 - t) ** 2;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);

const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const SPARK = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };
function showBurst(item, k, at, span = 0.14) {
  const since = k - at;
  const stage = since < 0 || since >= span ? -1 : Math.floor((since / span) * BURST_STAGES);
  if (stage < 0) item.show(null);
  else item.show(`burst${stage}`, BURSTS[stage], SPARK);
}

// Pièce en pixel art : montre l'image de sa rotation à l'instant k
function showCoin(item, k, index) {
  const frame = (Math.floor(k * 40) + index) % COIN_FRAMES.length;
  item.show(`coin${frame}`, COIN_FRAMES[frame], COIN_PALETTE);
}
const coinSprite = (group, at) => pixelSprite(group, at, COIN_SIZE, COIN_SIZE, 41, PIXEL * 0.5);

// Le pion luit comme de l'or. Retourne glow(amount) ; glow(0) le remet en état.
function goldGlow(mesh) {
  const materials = new Set();
  mesh.traverse((part) => {
    if (part.isMesh && part.material.emissive) materials.add(part.material);
  });
  return (amount) => {
    for (const material of materials) material.emissive.setRGB(0.8 * amount, 0.6 * amount, 0.1 * amount);
  };
}

// Part des pièces déjà arrivées à l'instant k, quand elles arrivent l'une après l'autre entre
// `first` et `last`
const arrived = (k, first, last) => clamp01((k - first) / (last - first));

// --- Aimant tombé du ciel : il se pose sur la tête du pion et attire les pièces des cases adverses ---

const MAGNET = { [EDGE]: INK, 2: '#e23d3d', 3: '#a82424', 4: '#f1f2f7' };
const MAGNET_ART = gridFromRows([
  'WW.....WW',
  'WW.....WW',
  'RR.....RD',
  'RR.....RD',
  'RR.....RD',
  'RRR...RRD',
  '.RRRRRRD.',
  '..RRRDD..',
], { R: 2, D: 3, W: 4 });
const TWINKLE = gridFromRows(['..Y..', '..Y..', 'YYWYY', '..Y..', '..Y..'], { Y: RIM, W: CORE });
const DROP_LAND = 0.2;
const DROP_FLIGHT = 0.28; // durée du vol d'une pièce

function magnetDrop({ group, mesh, size, top, sources }) {
  const magnet = pixelSprite(group, top, MAGNET_ART.width, MAGNET_ART.height, 42, PIXEL * 0.62);
  magnet.sprite.center.set(0.5, 0);
  const twinkle = pixelSprite(group, top, TWINKLE.width, TWINKLE.height, 43, PIXEL * 0.6);
  const mouth = new THREE.Vector3(top.x, top.y + 0.3, top.z); // entre les deux pôles de l'aimant
  twinkle.sprite.position.copy(mouth);
  const coins = sources.map((source, i) => ({ item: coinSprite(group, source), source, start: 0.26 + (i / sources.length) * 0.3 }));
  const position = new THREE.Vector3();
  const glow = goldGlow(mesh);

  return {
    update(k) {
      const since = k - DROP_LAND;
      const leave = clamp01((k - 0.88) / 0.12);
      let height = 0;
      if (since < 0) height = (1 - (k / DROP_LAND) ** 2) * 3.2;                  // la chute
      else if (since < 0.1) height = Math.sin((since / 0.1) * Math.PI) * 0.12;   // un rebond
      magnet.sprite.position.set(top.x, top.y + 0.02 + height, top.z);
      const squash = since >= 0 ? Math.max(0, 1 - since / 0.03) : 0;
      // Il frémit tant que des pièces arrivent
      const pulling = since > 0 && k < 0.86 ? 0.06 * Math.sin(k * 90) : 0;
      magnet.material.rotation = pulling;
      magnet.sprite.scale.set(magnet.size.x * (1 - leave) * (1 + 0.14 * squash), magnet.size.y * (1 - leave) * (1 - 0.22 * squash), 1);
      if (leave >= 1) magnet.show(null);
      else magnet.show('magnet', MAGNET_ART, MAGNET);

      let caught = false;
      coins.forEach(({ item, source, start }, i) => {
        const flight = (k - start) / DROP_FLIGHT;
        if (flight < 0 || flight >= 1) {
          item.show(null);
          if (flight >= 1 && flight < 1.25) caught = true;
          return;
        }
        // La pièce se soulève, puis file vers l'aimant de plus en plus vite
        position.copy(source).lerp(mouth, flight * flight);
        position.y += Math.sin(flight * Math.PI) * 0.8;
        item.sprite.position.copy(position);
        item.setZoom(popIn(clamp01(flight / 0.2)));
        showCoin(item, k, i);
      });
      if (caught && leave === 0) twinkle.show('twinkle', TWINKLE, SPARK);
      else twinkle.show(null);

      // Le pion s'écrase sous l'aimant, puis grossit à mesure que les pièces arrivent
      const hit = bump(k, DROP_LAND + 0.02, 0.04);
      const full = arrived(k, 0.26 + DROP_FLIGHT, 0.56 + DROP_FLIGHT) * (1 - leave * 0.6);
      mesh.scale.set(size * (1 + 0.1 * hit + 0.16 * full), size * (1 - 0.16 * hit + 0.16 * full), size * (1 + 0.1 * hit + 0.16 * full));
      glow(0.5 * full * (1 - leave));
    },
    dispose() {
      glow(0);
      magnet.dispose();
      twinkle.dispose();
      for (const { item } of coins) item.dispose();
    },
  };
}

// --- Ronde de pièces : les pièces quittent les cases adverses, viennent tourner autour du pion,
// puis se fondent en lui ---

const RING_FLIGHT = 0.3;
const RING_CLOSE = 0.74; // la ronde se resserre
const RING_MERGE = 0.86; // les pièces ont rejoint le pion

function magnetRing({ group, mesh, size, top, ground, sources, camera }) {
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.5, top.z);
  const coins = sources.map((source, i) => ({ item: coinSprite(group, source), source, start: (i / sources.length) * 0.3 }));
  const burst = pixelSprite(group, centre, 15, 15, 42);
  const position = new THREE.Vector3();
  const slot = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);
  const glow = goldGlow(mesh);

  return {
    update(k) {
      const closing = clamp01((k - RING_CLOSE) / (RING_MERGE - RING_CLOSE));
      const radius = 0.4 * (1 - closing * closing);
      coins.forEach(({ item, source, start }, i) => {
        const flight = clamp01((k - start) / RING_FLIGHT);
        if (k < start || k >= RING_MERGE) {
          item.show(null);
          return;
        }
        // Sa place dans la ronde, qui tourne ; la pièce la rejoint en vol
        const angle = (k * 2.2 + i / coins.length) * Math.PI * 2;
        slot.set(centre.x + Math.cos(angle) * radius, centre.y + ((i % 3) - 1) * 0.1 * size, centre.z + Math.sin(angle) * radius);
        position.copy(source).lerp(slot, easeOut(flight));
        position.y += Math.sin(flight * Math.PI) * 0.9;
        item.sprite.position.copy(position);
        // Dans la ronde, elle passe derrière le pion ; en vol, elle reste visible
        item.material.depthTest = flight >= 1 && camera.position.distanceToSquared(position) > reach;
        item.setZoom(popIn(clamp01((k - start) / 0.06)));
        showCoin(item, k, i);
      });
      showBurst(burst, k, RING_MERGE);
      const gulp = bump(k, RING_MERGE + 0.04, 0.07);
      mesh.scale.setScalar(size * (1 + 0.2 * gulp));
      glow(clamp01(1 - Math.abs(k - (RING_MERGE + 0.05)) / 0.13));
    },
    dispose() {
      glow(0);
      burst.dispose();
      for (const { item } of coins) item.dispose();
    },
  };
}

// --- Pièces bondissantes : des pièces en volume jaillissent des cases adverses, retombent autour
// du pion, puis sautent vers lui ---

const SLAB_WIDE = 0.24;
const SLAB_HIGH = 0.07;
const LEAP_FLIGHT = 0.32;
const LEAP_IN = 0.78; // elles sautent vers le pion

function magnetLeap({ group, mesh, size, top, ground, sources, gradientMap }) {
  const count = sources.length;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const gold = new THREE.MeshToonMaterial({ color: GOLD, gradientMap });
  const edge = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  const hull = new THREE.InstancedMesh(box, edge, count); // contour : l'envers de pavés plus grands
  const slabs = new THREE.InstancedMesh(box, gold, count);
  slabs.castShadow = true;
  hull.frustumCulled = false;
  slabs.frustumCulled = false;
  group.add(hull, slabs);
  const coins = sources.map((source, i) => {
    const angle = (i / count) * Math.PI * 2;
    return {
      source,
      start: (i / count) * 0.25,
      spot: new THREE.Vector3(top.x + Math.cos(angle) * 0.36, ground + SLAB_HIGH / 2, top.z + Math.sin(angle) * 0.36),
    };
  });
  const dummy = new THREE.Object3D();
  const position = new THREE.Vector3();
  const glow = goldGlow(mesh);

  return {
    update(k) {
      const inward = clamp01((k - LEAP_IN) / (1 - LEAP_IN));
      coins.forEach(({ source, start, spot }, i) => {
        const since = k - start;
        const flight = clamp01(since / LEAP_FLIGHT);
        const landed = since - LEAP_FLIGHT;
        position.copy(source).lerp(spot, flight);
        position.y += Math.sin(flight * Math.PI) * 1.4;
        if (landed > 0 && landed < 0.1) position.y += Math.sin((landed / 0.1) * Math.PI) * 0.14; // un rebond
        if (inward > 0) {
          position.lerp(top, easeOut(inward));
          position.y += Math.sin(inward * Math.PI) * 0.3;
        }
        const squash = landed >= 0 && inward === 0 ? Math.max(0, 1 - landed / 0.03) : 0;
        const zoom = Math.max(0.001, since < 0 ? 0 : popIn(clamp01(since / 0.06)) * (1 - inward * inward));
        dummy.position.copy(position);
        dummy.rotation.set(flight < 1 ? flight * 9 : 0, since * 6 + i, 0);
        dummy.scale.set(SLAB_WIDE * zoom * (1 + 0.2 * squash), SLAB_HIGH * zoom * (1 - 0.4 * squash), SLAB_WIDE * zoom * (1 + 0.2 * squash));
        dummy.updateMatrix();
        slabs.setMatrixAt(i, dummy.matrix);
        dummy.scale.set(dummy.scale.x + 0.035 * zoom, dummy.scale.y + 0.035 * zoom, dummy.scale.z + 0.035 * zoom);
        dummy.updateMatrix();
        hull.setMatrixAt(i, dummy.matrix);
      });
      slabs.instanceMatrix.needsUpdate = true;
      hull.instanceMatrix.needsUpdate = true;
      const gulp = bump(k, 0.95, 0.05);
      mesh.scale.setScalar(size * (1 + 0.2 * gulp));
      glow(0.8 * gulp);
    },
    dispose() {
      glow(0);
      box.dispose();
      gold.dispose();
      edge.dispose();
      slabs.dispose();
      hull.dispose();
    },
  };
}

// --- Ondes d'aimant : des ondes partent du pion sur le sol ; à leur passage, les pièces des cases
// adverses se soulèvent et filent vers lui ---

const WAVES = 3;
const WAVE_DOTS = 30;      // points d'une onde
const WAVE_SPEED = 5;      // unités de case parcourues par une onde pendant l'effet
const WAVE_EVERY = 0.14;   // délai entre deux ondes
const WAVE_FLIGHT = 0.2;   // durée du vol d'une pièce

function magnetWaves({ group, mesh, size, top, ground, sources }) {
  const feet = new THREE.Vector3(top.x, ground, top.z);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const gold = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, depthWrite: false });
  const dots = new THREE.InstancedMesh(box, gold, WAVES * WAVE_DOTS);
  dots.frustumCulled = false;
  group.add(dots);
  // Chaque pièce part quand la première onde atteint sa case
  const coins = sources.map((source, i) => {
    const far = Math.hypot(source.x - feet.x, source.z - feet.z);
    return { item: coinSprite(group, source), source, start: Math.min(0.62, far / WAVE_SPEED) + 0.02 * (i % 3) };
  });
  const dummy = new THREE.Object3D();
  const position = new THREE.Vector3();
  const glow = goldGlow(mesh);
  const last = Math.max(...coins.map(coin => coin.start)) + WAVE_FLIGHT;

  return {
    update(k) {
      for (let w = 0; w < WAVES; w++) {
        const since = k - w * WAVE_EVERY;
        const radius = 0.3 + since * WAVE_SPEED;
        const fade = since < 0 ? 0 : clamp01(1 - since / 0.55);
        for (let d = 0; d < WAVE_DOTS; d++) {
          const angle = ((d + (w % 2) * 0.5) / WAVE_DOTS) * Math.PI * 2;
          dummy.position.set(feet.x + Math.cos(angle) * radius, ground + 0.06, feet.z + Math.sin(angle) * radius);
          dummy.rotation.set(0, -angle, 0);
          dummy.scale.set(0.09 * fade + 0.001, 0.03, (0.05 + radius * 0.03) * fade + 0.001);
          dummy.updateMatrix();
          dots.setMatrixAt(w * WAVE_DOTS + d, dummy.matrix);
        }
      }
      dots.instanceMatrix.needsUpdate = true;

      let pulse = 0;
      coins.forEach(({ item, source, start }, i) => {
        const flight = (k - start) / WAVE_FLIGHT;
        if (flight >= 1 && flight < 1.4) pulse = Math.max(pulse, 1 - (flight - 1) / 0.4);
        if (flight < 0 || flight >= 1) {
          item.show(null);
          return;
        }
        position.copy(source).lerp(top, flight * flight);
        position.y += 0.3 * Math.sin(flight * Math.PI) + 0.25 * (1 - flight);
        item.sprite.position.copy(position);
        item.setZoom(popIn(clamp01(flight / 0.25)));
        showCoin(item, k, i);
      });
      // Le pion grossit à mesure que les pièces arrivent, et tressaute à chacune
      const full = arrived(k, 0.1, last) * clamp01((1 - k) / 0.1);
      mesh.scale.setScalar(size * (1 + 0.14 * full + 0.06 * pulse));
      glow(0.35 * full + 0.4 * pulse);
    },
    dispose() {
      glow(0);
      box.dispose();
      gold.dispose();
      dots.dispose();
      for (const { item } of coins) item.dispose();
    },
  };
}

const BUILDERS = { drop: magnetDrop, ring: magnetRing, leap: magnetLeap, waves: magnetWaves };

// Construit l'effet de l'Aimant GP.
//   mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de
//   sa case ; sources : points d'où partent les pièces (les cases adverses) ; camera : la caméra ;
//   gradientMap : dégradé de l'ombrage « toon ».
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildMagnet(style, { mesh, size, top, ground, sources, camera, gradientMap }) {
  const group = new THREE.Group();
  const magnet = BUILDERS[style]({ group, mesh, size, top, ground, sources, camera, gradientMap });
  return { group, update: k => magnet.update(k), dispose: () => magnet.dispose() };
}
