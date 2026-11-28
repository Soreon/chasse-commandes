// Stun, après la foudre : ce qui montre que le joueur frappé reste sonné.
//
// Plusieurs mises en scène à l'essai (essais.html), à la place des étoiles qui tournent. Chacune
// se construit avec buildDazed(style, options) et se pilote par update(t), t allant de 0 à 1 sur
// le temps qui suit la foudre. Elle anime aussi le pion (penché, aplati, noirci) et le remet en
// état dans dispose(). update rend la lueur du pion à cet instant (de 0 à 1).

import * as THREE from 'three';
import { EDGE, gridFromRows } from './pixelGrid.js';
import { boltGrid } from './lightningArt.js';
import { showBolt } from './lightning.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

export const DAZED_STYLES = {
  smoke: 'Roussi et fumant',
  arcs: 'Arcs électriques',
  cage: 'Cage d’éclairs',
  stars: 'Ronde d’étoiles',
};

const INK = '#0b0b1c';
const clamp01 = v => Math.max(0, Math.min(1, v));
// Bosse de 0 à 1 autour de l'instant `at`, large de `width` de chaque côté
const bump = (t, at, width) => Math.max(0, 1 - Math.abs(t - at) / width);

// Matières propres au pion (tête et mains, corps)
function pawnMaterials(mesh) {
  const materials = new Set();
  mesh.traverse((part) => {
    if (part.isMesh && part.material.emissive) materials.add(part.material);
  });
  return [...materials];
}

// --- Roussi et fumant : le pion sort noirci de la foudre, de la fumée monte de sa tête, il tousse ---

const SMOKE = { [EDGE]: INK, 2: '#f1f2f7', 3: '#c5c8d6', 4: '#9094a8' };
const SMOKE_CODES = { L: 2, M: 3, D: 4 };
// Une bouffée, de sa naissance à sa dispersion (trois images de même taille)
const PUFFS = [
  [
    '.........',
    '.........',
    '...LLL...',
    '..LLLMM..',
    '..LLMMM..',
    '..LMMMD..',
    '...MMD...',
    '.........',
    '.........',
  ],
  [
    '.........',
    '..LLLL...',
    '.LLLLLMM.',
    '.LLLLMMM.',
    'LLLLMMMMM',
    '.LLMMMMD.',
    '.LMMMMDD.',
    '..MMDD...',
    '.........',
  ],
  [
    '..LL..L..',
    '.LLLL.LM.',
    'LLL.LMMM.',
    '.LLMM.MMM',
    '..MMMMMD.',
    '.M.MM.DD.',
    '..M..D...',
    '....D....',
    '.........',
  ],
].map(rows => gridFromRows(rows, SMOKE_CODES));
const SOOT = new THREE.Color('#2b2b36');

function dazedSmoke({ group, mesh, size, top, random }) {
  const materials = pawnMaterials(mesh);
  const colors = materials.map(material => material.color.clone());
  const puffs = Array.from({ length: 6 }, (_, i) => {
    const angle = random() * Math.PI * 2;
    return {
      item: pixelSprite(group, top, PUFFS[0].width, PUFFS[0].height, 41, PIXEL * 0.55),
      start: i * 0.115,
      dx: Math.cos(angle) * 0.22,
      dz: Math.sin(angle) * 0.22,
      sway: random() * 6,
    };
  });
  const LIFE = 0.42;

  return {
    update(t) {
      // Le pion est noir de suie, et retrouve ses couleurs à la fin
      const soot = t < 0.8 ? 0.8 : 0.8 * (1 - (t - 0.8) / 0.2);
      materials.forEach((material, i) => material.color.copy(colors[i]).lerp(SOOT, soot));

      for (const puff of puffs) {
        const age = (t - puff.start) / LIFE;
        if (age < 0 || age >= 1) {
          puff.item.show(null);
          continue;
        }
        const frame = age < 0.3 ? 0 : (age < 0.68 ? 1 : 2);
        puff.item.show(`puff${frame}`, PUFFS[frame], SMOKE);
        const wave = Math.sin(age * 6 + puff.sway) * 0.04;
        puff.item.sprite.position.set(top.x + puff.dx * age + wave, top.y + 0.02 + age * 0.7, top.z + puff.dz * age);
      }

      // Il tousse deux fois
      const cough = Math.max(bump(t, 0.24, 0.05), bump(t, 0.5, 0.05));
      mesh.scale.set(size * (1 + 0.1 * cough), size * (1 - 0.15 * cough), size * (1 + 0.1 * cough));
      mesh.rotation.z = Math.sin(t * 22) * 0.06 * (1 - t);
      return 0;
    },
    dispose() {
      materials.forEach((material, i) => material.color.copy(colors[i]));
      for (const puff of puffs) puff.item.dispose();
    },
  };
}

// --- Arcs électriques : de petits éclairs claquent encore autour du pion, qui tressaute ---

const ARC = { width: 13, height: 16, thick: 2, forks: 0 };
const ARC_LIFE = 0.11;

function dazedArcs({ group, mesh, size, top, ground, random }) {
  const grids = Array.from({ length: 4 }, () => boltGrid(random, ARC));
  const pool = Array.from({ length: 3 }, () => {
    const item = pixelSprite(group, top, ARC.width, ARC.height, 41, PIXEL * 0.6);
    return { item, pops: [] };
  });
  // Programme des claquements : serrés au début, plus rares ensuite
  let count = 0;
  for (let at = 0; at < 0.9; at += 0.045 + 0.09 * at + random() * 0.03) {
    pool[count % pool.length].pops.push({
      at,
      key: count,
      grid: grids[Math.floor(random() * grids.length)],
      angle: random() * Math.PI * 2,
      x: (random() - 0.5) * 0.55,
      y: random(),
      z: (random() - 0.5) * 0.55,
    });
    count += 1;
  }

  return {
    update(t) {
      let glow = 0;
      let live = false;
      for (const { item, pops } of pool) {
        const pop = pops.findLast(p => p.at <= t);
        const age = pop ? (t - pop.at) / ARC_LIFE : 1;
        if (age >= 1) {
          item.show(null);
          continue;
        }
        live = true;
        if (age < 0.45) glow = 0.35;
        showBolt(item, pop.grid, age < 0.45 ? 'flash' : 'bolt', pop.key);
        item.material.rotation = pop.angle;
        item.sprite.position.set(top.x + pop.x, ground + 0.1 + pop.y * (top.y - ground), top.z + pop.z);
      }
      mesh.scale.setScalar(size);
      mesh.rotation.z = live ? Math.sign(Math.sin(t * 95)) * 0.07 * (1 - 0.6 * t) : 0;
      return glow;
    },
    dispose() {
      for (const { item } of pool) item.dispose();
    },
  };
}

// --- Cage d'éclairs : quatre éclairs restent plantés autour du pion, raidi, qui ne peut plus bouger ---

const BAR = { width: 13, height: 20, thick: 2, forks: 0 };

function dazedCage({ group, mesh, size, top, ground, camera, random }) {
  const feet = new THREE.Vector3(top.x, ground, top.z);
  const bars = [0, 1, 2, 3].map((i) => {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const at = new THREE.Vector3(top.x + Math.cos(angle) * 0.3, ground, top.z + Math.sin(angle) * 0.3);
    const item = pixelSprite(group, at, BAR.width, BAR.height, 41, PIXEL * 0.85);
    item.sprite.center.set(0.5, 0);
    // Les barreaux du fond passent derrière le pion, ceux de devant par-dessus
    item.material.depthTest = camera.position.distanceToSquared(at) > camera.position.distanceToSquared(feet);
    return { item, grids: [boltGrid(random, BAR), boltGrid(random, BAR)], start: i * 0.035, beat: 0.06 + random() * 0.03 };
  });

  return {
    update(t) {
      let glow = 0;
      for (const bar of bars) {
        const local = t - bar.start;
        if (local < 0 || t >= 0.95) {
          bar.item.show(null);
          continue;
        }
        // Chaque barreau change de forme à son rythme, dans un éclair blanc
        const frame = Math.floor(local / bar.beat);
        const flash = t < 0.84 && frame % 3 === 0;
        if (flash) glow = 0.2;
        showBolt(bar.item, bar.grids[frame % 2], t >= 0.84 ? 'fade' : (flash ? 'flash' : 'bolt'), frame % 2);
      }
      // Raide comme un piquet, il tremble à peine
      mesh.scale.set(size * 0.96, size * 1.05, size * 0.96);
      mesh.rotation.z = Math.sin(t * 130) * 0.025;
      return glow;
    },
    dispose() {
      for (const bar of bars) bar.item.dispose();
    },
  };
}

// --- Ronde d'étoiles : des étoiles tournent autour de sa tête, et passent derrière elle ---

const GOLDEN = { [EDGE]: INK, 2: '#ffd21f', 3: '#fffbe6' };
const STAR_CODES = { Y: 2, W: 3 };
// L'étoile, et son scintillement (deux images de même taille)
const STARS = [
  [
    '....Y....',
    '....Y....',
    '...YWY...',
    'YYYYWYYYY',
    '.YYWWWYY.',
    '..YWWWY..',
    '..YYWYY..',
    '.YY...YY.',
    '.Y.....Y.',
  ],
  [
    '.........',
    '.........',
    '....Y....',
    '....Y....',
    '..YYWYY..',
    '....Y....',
    '....Y....',
    '.........',
    '.........',
  ],
].map(rows => gridFromRows(rows, STAR_CODES));

function dazedStars({ group, mesh, size, top, camera }) {
  // La ronde passe à hauteur du front, pas au-dessus de la tête
  const centre = new THREE.Vector3(top.x, top.y - 0.07 * size, top.z);
  const stars = [0, 1, 2, 3].map(() => pixelSprite(group, centre, STARS[0].width, STARS[0].height, 41, PIXEL * 0.42));
  const position = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  return {
    update(t) {
      const zoom = clamp01(Math.min(t / 0.12, (1 - t) / 0.12));
      stars.forEach((item, i) => {
        const angle = t * Math.PI * 4.5 + (i * Math.PI) / 2;
        position.set(centre.x + Math.cos(angle) * 0.24, centre.y + Math.sin(angle * 2) * 0.025, centre.z + Math.sin(angle) * 0.24);
        item.sprite.position.copy(position);
        // Derrière la tête, l'étoile est cachée par elle
        item.material.depthTest = camera.position.distanceToSquared(position) > reach;
        const frame = (Math.floor(t * 16) + i) % 3 === 0 ? 1 : 0; // elle scintille
        item.show(`star${frame}`, STARS[frame], GOLDEN);
        item.setZoom(Math.max(zoom, 0.001));
      });
      mesh.scale.setScalar(size);
      mesh.rotation.z = Math.sin(t * 26) * 0.3 * (1 - t);
      return 0;
    },
    dispose() {
      for (const item of stars) item.dispose();
    },
  };
}

const BUILDERS = { smoke: dazedSmoke, arcs: dazedArcs, cage: dazedCage, stars: dazedStars };

// Construit ce qui suit la foudre sur un pion.
//   mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de
//   sa case ; camera : la caméra (pour savoir ce qui passe derrière lui) ; random : hasard.
// Retourne { group (à ajouter à la scène), update(t) -> lueur du pion, dispose() }.
export function buildDazed(style, { mesh, size, top, ground, camera, random = Math.random }) {
  const group = new THREE.Group();
  const dazed = BUILDERS[style]({ group, mesh, size, top, ground, camera, random });
  return { group, update: t => dazed.update(t), dispose: () => dazed.dispose() };
}
