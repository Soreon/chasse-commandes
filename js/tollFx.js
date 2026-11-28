// Double Péage : pendant cinq tours, les péages des cases du joueur sont doublés. Des pièces en
// pixel art tournent autour de son pion en passant derrière lui, puis s'envolent chacune vers
// l'une de ses cases, où jaillit un « ×2 ».
//
// buildToll(options) construit l'effet ; il se pilote par update(k), k allant de 0 à 1. S'il n'a
// aucune case, le joueur voit l'effet sur celle où il se tient. L'appelant remet le pion à sa taille.

import * as THREE from 'three';
import { EDGE, createGrid, put, addEdge } from './pixelGrid.js';
import { pixelLabelGrid } from './pixelLabel.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { COIN_FRAMES, COIN_PALETTE, COIN_SIZE } from './coinArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

const INK = '#0b0b1c';
const GOLD = '#ffd21f';

// « ×2 », dans la police du jeu, chaque point doublé : des traits épais, que le liseré ne mange pas
const TIMES = { [EDGE]: INK, 2: GOLD };
function textGrid(text, scale = 2) {
  const label = pixelLabelGrid(text, { bg: null, fg: '#ffffff' });
  const grid = createGrid(label.width * scale, label.height * scale);
  label.pixels.forEach((row, y) => row.forEach((color, x) => {
    if (color !== '#ffffff') return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(grid, x * scale + dx, y * scale + dy, 2);
  }));
  return addEdge(grid);
}
const TIMES_ART = textGrid('×2');

// Éclat à l'arrivée d'une pièce sur sa case
const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const SPARK = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };
const BURST_SPAN = 0.14;

const MIN_COINS = 4;  // pièces de la ronde, même avec peu de cases
const TURNS = 2.4;    // tours faits pendant l'effet
const RADIUS = 0.36;  // rayon de la ronde, en unités de case
const GO = 0.48;      // les pièces quittent la ronde
const LAND = 0.8;     // elles atterrissent

const clamp01 = v => Math.max(0, Math.min(1, v));
const easeOut = t => 1 - (1 - t) ** 2;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
// Bosse de 0 à 1 autour de l'instant `at`, large de `width` de chaque côté
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);

// mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de sa
// case ; tiles : centres { x, z, top } des cases du joueur ; camera : la caméra (pour savoir
// quelles pièces passent derrière lui).
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildToll({ mesh, size, top, ground, tiles, camera }) {
  const group = new THREE.Group();
  const places = tiles.length > 0 ? tiles : [{ x: top.x + 0.3, z: top.z + 0.2, top: ground }];
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.5, top.z);
  const count = Math.max(MIN_COINS, places.length);
  const items = Array.from({ length: count }, (_, i) => {
    const place = places[i % places.length];
    const goal = new THREE.Vector3(place.x, place.top + 0.2, place.z);
    // Une seule étiquette et un seul éclat par case, même si deux pièces s'y posent
    const first = i < places.length;
    return {
      coin: pixelSprite(group, centre, COIN_SIZE, COIN_SIZE, 41, PIXEL * 0.5),
      goal,
      times: first ? pixelSprite(group, goal, TIMES_ART.width, TIMES_ART.height, 42, PIXEL * 0.38) : null,
      burst: first ? pixelSprite(group, goal, 15, 15, 40, PIXEL * 0.5) : null,
    };
  });
  const position = new THREE.Vector3();
  const from = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  return {
    group,
    update(k) {
      const flight = clamp01((k - GO) / (LAND - GO));
      items.forEach(({ coin, goal, times, burst }, i) => {
        const angle = (k * TURNS + i / count) * Math.PI * 2;
        from.set(centre.x + Math.cos(angle) * RADIUS, centre.y, centre.z + Math.sin(angle) * RADIUS);
        position.copy(from).lerp(goal, easeOut(flight));
        position.y += Math.sin(flight * Math.PI) * 1.1;
        coin.sprite.position.copy(position);
        // En ronde, la pièce passe derrière le pion ; en vol, elle reste visible
        coin.material.depthTest = flight === 0 && camera.position.distanceToSquared(position) > reach;
        coin.setZoom(Math.max(0.001, popIn(clamp01(k / 0.1))));
        if (flight >= 1) {
          coin.show(null);
        } else {
          const frame = (Math.floor(k * 40) + i) % COIN_FRAMES.length;
          coin.show(`coin${frame}`, COIN_FRAMES[frame], COIN_PALETTE);
        }
        if (!times) return;

        const since = k - LAND;
        const stage = since < 0 || since >= BURST_SPAN ? -1 : Math.floor((since / BURST_SPAN) * BURST_STAGES);
        if (stage < 0) burst.show(null);
        else burst.show(`burst${stage}`, BURSTS[stage], SPARK);
        // Le « ×2 » jaillit de la case à l'arrivée de la pièce, monte un peu, puis s'efface
        if (k < LAND || k >= 0.98) times.show(null);
        else times.show('times', TIMES_ART, TIMES);
        times.sprite.position.set(goal.x, goal.y + 0.1 + 0.25 * easeOut(clamp01(since / 0.18)), goal.z);
        times.setZoom(Math.max(0.001, popIn(clamp01(since / 0.08)) * clamp01((1 - k) / 0.05)));
      });
      // Le pion sursaute quand les pièces s'envolent
      mesh.scale.setScalar(size * (1 + 0.1 * bump(k, GO, 0.05)));
    },
    dispose() {
      for (const { coin, times, burst } of items) {
        coin.dispose();
        if (times) times.dispose();
        if (burst) burst.dispose();
      }
    },
  };
}
