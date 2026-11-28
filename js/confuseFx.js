// Confusion : pendant trois tours, les adversaires partent au hasard aux intersections.
//
// Plusieurs mises en scène à l'essai (essais.html), à la place des symboles qui tournent au-dessus
// de la tête. Chacune se construit, pour un pion visé, avec buildConfuse(style, options) et se
// pilote par update(k), k allant de 0 à 1 sur la durée de l'effet. Elle anime aussi le pion
// (penché, aplati, tourné), que l'appelant remet en état.

import * as THREE from 'three';
import { EDGE, gridFromRows } from './pixelGrid.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { ARROW_ART } from './navigatorFx.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

export const CONFUSE_STYLES = {
  drop: '« ? » tombé du ciel',
  ring: 'Ronde de « ? »',
  arrow: 'Flèche affolée',
  spin: 'Toupie',
};

const INK = '#0b0b1c';
const PINK = '#ff5a7a'; // la couleur de la Confusion dans le jeu
const PINK_LIGHT = '#ffb3c1';
const clamp01 = v => Math.max(0, Math.min(1, v));
const easeOut = t => 1 - (1 - t) ** 2;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);

// Le point d'interrogation
const MARK = { [EDGE]: INK, 2: PINK, 3: PINK_LIGHT };
const MARK_WHITE = { [EDGE]: PINK, 2: '#ffffff', 3: '#ffffff' };
const MARK_ART = gridFromRows([
  '.LLLLP.',
  'LLPPPPP',
  'LP...PP',
  '.....PP',
  '....PPP',
  '...LPP.',
  '...LP..',
  '...LP..',
  '.......',
  '...LP..',
  '...PP..',
], { P: 2, L: 3 });

const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const PUFF = { [EDGE]: INK, [RIM]: PINK, [CORE]: '#ffffff' };
function showBurst(item, k, at, span = 0.14) {
  const since = k - at;
  const stage = since < 0 || since >= span ? -1 : Math.floor((since / span) * BURST_STAGES);
  if (stage < 0) item.show(null);
  else item.show(`burst${stage}`, BURSTS[stage], PUFF);
}

// --- « ? » tombé du ciel : il rebondit sur la tête du pion, s'y balance, puis éclate ---

const DROP_LAND = 0.22;
const DROP_POP = 0.86;

function confuseDrop({ group, mesh, size, top }) {
  const item = pixelSprite(group, top, MARK_ART.width, MARK_ART.height, 41, PIXEL * 0.72);
  item.sprite.center.set(0.5, 0);
  const burst = pixelSprite(group, top, 15, 15, 42, PIXEL * 0.8);
  burst.sprite.position.set(top.x, top.y + 0.2, top.z);

  return {
    update(k) {
      const since = k - DROP_LAND;
      let height = 0;
      if (since < 0) height = (1 - (k / DROP_LAND) ** 2) * 3.2;                 // la chute
      else if (k < 0.72) height = Math.abs(Math.sin((since / 0.5) * Math.PI * 3)) * 0.14 * (1 - since / 0.6); // trois rebonds
      item.sprite.position.set(top.x, top.y + 0.02 + height, top.z);
      item.material.rotation = since < 0 ? 0 : Math.sin(since * 30) * 0.3; // il se balance
      const squash = since >= 0 ? Math.max(0, 1 - since / 0.03) : 0;
      item.sprite.scale.set(item.size.x * (1 + 0.14 * squash), item.size.y * (1 - 0.22 * squash), 1);
      if (k >= DROP_POP) item.show(null);
      else if (k >= 0.76) item.show('white', MARK_ART, MARK_WHITE);
      else item.show('mark', MARK_ART, MARK);
      showBurst(burst, k, DROP_POP);

      // Le pion s'écrase sous le choc, puis dodeline de plus en plus
      const hit = bump(k, DROP_LAND + 0.02, 0.04);
      mesh.scale.set(size * (1 + 0.1 * hit), size * (1 - 0.16 * hit), size * (1 + 0.1 * hit));
      mesh.rotation.z = since < 0 ? 0 : Math.sin(since * 30 + 1.5) * 0.22 * clamp01((1 - k) / 0.2);
    },
    dispose() {
      item.dispose();
      burst.dispose();
    },
  };
}

// --- Ronde de « ? » : trois points d'interrogation tournent autour de la tête et passent derrière ---

function confuseRing({ group, mesh, size, top, camera, index }) {
  const centre = new THREE.Vector3(top.x, top.y - 0.07 * size, top.z);
  const marks = [0, 1, 2].map(() => pixelSprite(group, centre, MARK_ART.width, MARK_ART.height, 41, PIXEL * 0.42));
  const position = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  return {
    update(k) {
      const zoom = clamp01(Math.min(k / 0.12, (1 - k) / 0.12));
      marks.forEach((item, i) => {
        const angle = (k * 2.25 + i / 3) * Math.PI * 2 + index;
        position.set(centre.x + Math.cos(angle) * 0.26, centre.y + Math.sin(angle * 2) * 0.03, centre.z + Math.sin(angle) * 0.26);
        item.sprite.position.copy(position);
        // Derrière la tête, le point d'interrogation est caché par elle
        item.material.depthTest = camera.position.distanceToSquared(position) > reach;
        item.material.rotation = Math.sin(k * 20 + i * 2) * 0.25;
        item.show('mark', MARK_ART, MARK);
        item.setZoom(Math.max(zoom, 0.001));
      });
      mesh.scale.setScalar(size);
      mesh.rotation.z = Math.sin(k * 42 + index) * 0.32 * (1 - k);
    },
    dispose() {
      for (const item of marks) item.dispose();
    },
  };
}

// --- Flèche affolée : au-dessus de la tête, une flèche saute d'une direction à l'autre, au
// hasard, puis se change en « ? » ---

const ARROW = { [EDGE]: INK, 2: PINK, 3: PINK_LIGHT };
const ARROW_LOST = 0.74; // la flèche renonce : elle devient un point d'interrogation

function confuseArrow({ group, mesh, size, top, random }) {
  const above = new THREE.Vector3(top.x, top.y + 0.26, top.z);
  const arrow = pixelSprite(group, above, ARROW_ART.width, ARROW_ART.height, 41, PIXEL * 0.7);
  const mark = pixelSprite(group, above, MARK_ART.width, MARK_ART.height, 41, PIXEL * 0.66);
  // Directions prises tour à tour, par huitièmes de tour, jamais deux fois la même de suite
  const turns = [];
  for (let at = 0.1, last = 0; at < ARROW_LOST; at += 0.035 + 0.05 * at) {
    last = (last + 2 + Math.floor(random() * 5)) % 8;
    turns.push({ at, eighth: last });
  }

  return {
    update(k) {
      const turn = turns.findLast(t => t.at <= k) || { at: 0, eighth: 0 };
      if (k >= ARROW_LOST) {
        arrow.show(null);
        if (k >= 0.97) mark.show(null);
        else mark.show(k < ARROW_LOST + 0.06 ? 'white' : 'mark', MARK_ART, k < ARROW_LOST + 0.06 ? MARK_WHITE : MARK);
        mark.setZoom(Math.max(0.001, popIn(clamp01((k - ARROW_LOST) / 0.1)) * clamp01((1 - k) / 0.06)));
      } else {
        mark.show(null);
        arrow.show('arrow', ARROW_ART, ARROW);
        arrow.material.rotation = -turn.eighth * (Math.PI / 4);
        // Elle grossit un instant à chaque changement de direction
        arrow.setZoom(Math.max(0.001, popIn(clamp01(k / 0.1)) * (1 + 0.25 * Math.max(0, 1 - (k - turn.at) / 0.03))));
      }
      // Le pion penche du côté que montre la flèche
      const lean = k < ARROW_LOST ? -Math.sin(turn.eighth * (Math.PI / 4)) * 0.2 : Math.sin(k * 40) * 0.12 * clamp01((1 - k) / 0.2);
      mesh.scale.setScalar(size);
      mesh.rotation.z = lean;
    },
    dispose() {
      arrow.dispose();
      mark.dispose();
    },
  };
}

// --- Toupie : le pion tourne sur lui-même comme une toupie, puis titube sous un « ? » ---

const DOT_ART = gridFromRows(['.L.', 'LPP', '.P.'], { P: 2, L: 3 });
const SPIN_END = 0.66; // la toupie s'arrête

function confuseSpin({ group, mesh, size, top, ground, camera, index }) {
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.5, top.z);
  // Étincelles roses entraînées par la rotation
  const dots = [0, 1, 2, 3, 4].map(() => pixelSprite(group, centre, DOT_ART.width, DOT_ART.height, 41, PIXEL * 0.6));
  const mark = pixelSprite(group, top, MARK_ART.width, MARK_ART.height, 41, PIXEL * 0.5);
  mark.sprite.center.set(0.5, 0);
  mark.sprite.position.set(top.x, top.y + 0.06, top.z);
  const position = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);
  const facing = mesh.rotation.y;

  return {
    turnsPawn: true,
    update(k) {
      // Six tours, de plus en plus lents
      const spun = easeOut(clamp01(k / SPIN_END));
      mesh.rotation.y = facing + spun * Math.PI * 12;
      const fast = clamp01(1 - k / SPIN_END);
      dots.forEach((item, i) => {
        if (fast <= 0) {
          item.show(null);
          return;
        }
        const angle = -spun * Math.PI * 9 + (i / dots.length) * Math.PI * 2 + index;
        const radius = 0.3 + 0.08 * Math.sin(k * 30 + i);
        position.set(centre.x + Math.cos(angle) * radius, centre.y + (i - 2) * 0.09 * size, centre.z + Math.sin(angle) * radius);
        item.sprite.position.copy(position);
        item.material.depthTest = camera.position.distanceToSquared(position) > reach;
        item.show('dot', DOT_ART, MARK);
        item.setZoom(Math.max(0.001, Math.min(1, fast * 3) * popIn(clamp01(k / 0.08))));
      });
      // Arrêté, il titube, un point d'interrogation au-dessus de la tête
      const dizzy = clamp01((k - SPIN_END) / (1 - SPIN_END));
      if (k < SPIN_END || k >= 0.97) mark.show(null);
      else mark.show('mark', MARK_ART, MARK);
      mark.setZoom(Math.max(0.001, popIn(clamp01(dizzy / 0.25)) * clamp01((1 - k) / 0.06)));
      mark.material.rotation = Math.sin(k * 30) * 0.25;
      mesh.scale.set(size * (1 + 0.06 * fast), size * (1 - 0.05 * fast), size * (1 + 0.06 * fast));
      mesh.rotation.z = k < SPIN_END ? Math.sin(k * 26) * 0.1 : Math.sin(dizzy * 14) * 0.28 * (1 - dizzy);
    },
    dispose() {
      for (const item of dots) item.dispose();
      mark.dispose();
    },
  };
}

const BUILDERS = { drop: confuseDrop, ring: confuseRing, arrow: confuseArrow, spin: confuseSpin };

// Construit l'effet de la Confusion sur un pion visé.
//   mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de
//   sa case ; camera : la caméra ; index : rang du pion parmi les visés (ils ne bougent pas tous
//   ensemble) ; random : source de hasard.
// Retourne { group (à ajouter à la scène), turnsPawn (le pion est tourné sur lui-même),
// update(k), dispose() }.
export function buildConfuse(style, { mesh, size, top, ground, camera, index = 0, random = Math.random }) {
  const group = new THREE.Group();
  const confuse = BUILDERS[style]({ group, mesh, size, top, ground, camera, index, random });
  return { group, turnsPawn: Boolean(confuse.turnsPawn), update: k => confuse.update(k), dispose: () => confuse.dispose() };
}
