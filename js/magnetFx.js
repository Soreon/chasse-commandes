// Aimant GP : le joueur touche des GP pour chaque case possédée par ses adversaires. Des pièces en
// pixel art quittent ces cases, viennent tourner autour de son pion en passant derrière lui, puis
// se fondent en lui.
//
// buildMagnet(options) construit l'effet ; il se pilote par update(k), k allant de 0 à 1. Le pion
// grossit et luit comme de l'or ; dispose() éteint la lueur, l'appelant remet la taille.

import * as THREE from 'three';
import { EDGE } from './pixelGrid.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { COIN_FRAMES, COIN_PALETTE, COIN_SIZE } from './coinArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

// Éclat de la fusion
const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const SPARK = { [EDGE]: '#0b0b1c', [RIM]: '#ffd21f', [CORE]: '#fffbe6' };
const BURST_SPAN = 0.14;

const TURNS = 2.2;    // tours faits par la ronde pendant l'effet
const RADIUS = 0.4;   // rayon de la ronde, en unités de case
const DEPART = 0.3;   // les pièces quittent leur case l'une après l'autre, jusqu'à cet instant
const FLIGHT = 0.3;   // durée du vol d'une pièce jusqu'à la ronde
const CLOSE = 0.74;   // la ronde se resserre
const MERGE = 0.86;   // les pièces ont rejoint le pion

const clamp01 = v => Math.max(0, Math.min(1, v));
const easeOut = t => 1 - (1 - t) ** 2;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
// Bosse de 0 à 1 autour de l'instant `at`, large de `width` de chaque côté
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);

// mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de sa
// case ; sources : points d'où partent les pièces (les cases adverses) ; camera : la caméra (pour
// savoir quelles pièces passent derrière lui).
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildMagnet({ mesh, size, top, ground, sources, camera }) {
  const group = new THREE.Group();
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.5, top.z);
  const coins = sources.map((source, i) => ({
    item: pixelSprite(group, source, COIN_SIZE, COIN_SIZE, 41, PIXEL * 0.5),
    source,
    start: (i / sources.length) * DEPART,
  }));
  const burst = pixelSprite(group, centre, 15, 15, 42);
  const position = new THREE.Vector3();
  const slot = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  // Matières propres au pion
  const materials = new Set();
  mesh.traverse((part) => {
    if (part.isMesh && part.material.emissive) materials.add(part.material);
  });
  const glow = (amount) => {
    for (const material of materials) material.emissive.setRGB(0.8 * amount, 0.6 * amount, 0.1 * amount);
  };

  return {
    group,
    update(k) {
      const closing = clamp01((k - CLOSE) / (MERGE - CLOSE));
      const radius = RADIUS * (1 - closing * closing);
      coins.forEach(({ item, source, start }, i) => {
        if (k < start || k >= MERGE) {
          item.show(null);
          return;
        }
        const flight = clamp01((k - start) / FLIGHT);
        // Sa place dans la ronde, qui tourne ; la pièce la rejoint en vol
        const angle = (k * TURNS + i / coins.length) * Math.PI * 2;
        slot.set(centre.x + Math.cos(angle) * radius, centre.y + ((i % 3) - 1) * 0.1 * size, centre.z + Math.sin(angle) * radius);
        position.copy(source).lerp(slot, easeOut(flight));
        position.y += Math.sin(flight * Math.PI) * 0.9;
        item.sprite.position.copy(position);
        // Dans la ronde, elle passe derrière le pion ; en vol, elle reste visible
        item.material.depthTest = flight >= 1 && camera.position.distanceToSquared(position) > reach;
        item.setZoom(popIn(clamp01((k - start) / 0.06)));
        const frame = (Math.floor(k * 40) + i) % COIN_FRAMES.length;
        item.show(`coin${frame}`, COIN_FRAMES[frame], COIN_PALETTE);
      });

      const since = k - MERGE;
      const stage = since < 0 || since >= BURST_SPAN ? -1 : Math.floor((since / BURST_SPAN) * BURST_STAGES);
      if (stage < 0) burst.show(null);
      else burst.show(`burst${stage}`, BURSTS[stage], SPARK);

      // Le pion gonfle et luit en recevant les pièces
      mesh.scale.setScalar(size * (1 + 0.2 * bump(k, MERGE + 0.04, 0.07)));
      glow(clamp01(1 - Math.abs(k - (MERGE + 0.05)) / 0.13));
    },
    dispose() {
      glow(0);
      burst.dispose();
      for (const { item } of coins) item.dispose();
    },
  };
}
