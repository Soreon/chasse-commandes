// Protecteur GP : le joueur se met à l'abri de la prochaine perte de GP. Trois boucliers en pixel
// art tournent autour de son pion en passant derrière lui, se resserrent et s'y fondent.
//
// buildShield(options) construit l'effet ; il se pilote par update(k), k allant de 0 à 1. Il
// anime aussi le pion (taille, lueur bleue) ; dispose() éteint la lueur, l'appelant remet la taille.

import * as THREE from 'three';
import { EDGE, gridFromRows } from './pixelGrid.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

const INK = '#0b0b1c';
const GOLD = '#ffd21f';

// Le bouclier : écu bleu cerclé d'or, frappé d'une bosse dorée
const SHIELD = { [EDGE]: INK, 2: GOLD, 3: '#8fd0ff', 4: '#3f8cff', 5: '#fffbe6' };
// Au moment de se fondre dans le pion : tout blanc, cerné d'or
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

// Éclat de la fusion
const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const SPARK = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };
const BURST_SPAN = 0.16;

const COUNT = 3;     // boucliers de la ronde
const TURNS = 2.2;   // tours faits pendant l'effet
const WIDE = 0.5;    // rayon de la ronde à son départ, en unités de case
const TIGHT = 0.33;  // son rayon juste avant le resserrement
const CLOSE = 0.68;  // début du resserrement
const MERGE = 0.82;  // les boucliers ont rejoint le pion

const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
// Bosse de 0 à 1 autour de l'instant `at`, large de `width` de chaque côté
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);

// mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de sa
// case ; camera : la caméra (pour savoir quels boucliers passent derrière lui).
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildShield({ mesh, size, top, ground, camera }) {
  const group = new THREE.Group();
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.45, top.z);
  const shields = Array.from({ length: COUNT }, () => pixelSprite(group, centre, SHIELD_ART.width, SHIELD_ART.height, 41, PIXEL * 0.42));
  const burst = pixelSprite(group, centre, 15, 15, 42);
  const position = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  // Matières propres au pion : protégé, il luit en bleu
  const materials = new Set();
  mesh.traverse((part) => {
    if (part.isMesh && part.material.emissive) materials.add(part.material);
  });
  const glow = (amount) => {
    for (const material of materials) material.emissive.setRGB(0.12 * amount, 0.32 * amount, 0.85 * amount);
  };

  return {
    group,
    update(k) {
      const closing = clamp01((k - CLOSE) / (MERGE - CLOSE));
      const radius = lerp(lerp(WIDE, TIGHT, clamp01(k / CLOSE)), 0, closing * closing);
      shields.forEach((item, i) => {
        if (k >= MERGE) {
          item.show(null);
          return;
        }
        const angle = (k * TURNS + i / COUNT) * Math.PI * 2;
        position.set(centre.x + Math.cos(angle) * radius, centre.y, centre.z + Math.sin(angle) * radius);
        item.sprite.position.copy(position);
        // Derrière le pion, le bouclier est caché par lui
        item.material.depthTest = camera.position.distanceToSquared(position) > reach;
        item.setZoom(Math.max(0.001, popIn(clamp01(k / 0.12))));
        if (closing > 0.5) item.show('white', SHIELD_ART, SHIELD_WHITE);
        else item.show('shield', SHIELD_ART, SHIELD);
      });

      const since = k - MERGE;
      const stage = since < 0 || since >= BURST_SPAN ? -1 : Math.floor((since / BURST_SPAN) * BURST_STAGES);
      if (stage < 0) burst.show(null);
      else burst.show(`burst${stage}`, BURSTS[stage], SPARK);

      // Le pion gonfle et luit en recevant les boucliers
      mesh.scale.setScalar(size * (1 + 0.14 * bump(k, MERGE + 0.04, 0.07)));
      glow(clamp01(1 - Math.abs(k - (MERGE + 0.05)) / 0.13));
    },
    dispose() {
      glow(0);
      for (const item of shields) item.dispose();
      burst.dispose();
    },
  };
}
