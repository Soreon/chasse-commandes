// Double Dé et Triple Dé : les dés que le joueur gagne pour ce tour tombent du ciel, rebondissent
// sur sa case autour de lui, puis sautent vers lui.
//
// Ce sont de vrais dés en volume, violets à points dorés comme ceux du jeu : des cubes dont chaque
// face est un petit dessin en pixel art. Ils ne s'arrêtent jamais sur une face : le vrai lancer
// vient après, et ils ne doivent pas annoncer un autre résultat.
//
// buildDice(options) construit l'effet ; il se pilote par update(k), k allant de 0 à 1.

import * as THREE from 'three';
import { EDGE } from './pixelGrid.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const PURPLE = '#9a6bff';
const PURPLE_LIGHT = '#b99bff';
const PURPLE_DARK = '#7447e0';
const SIDE = 0.2;  // côté d'un dé, en unités de case
const FACE = 15;   // points par côté d'une face

const clamp01 = v => Math.max(0, Math.min(1, v));
const easeOut = t => 1 - (1 - t) ** 2;

// Points de chaque face, sur un quadrillage de 3 × 3
const PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function faceTexture(value) {
  const unit = 4;
  const canvas = document.createElement('canvas');
  canvas.width = FACE * unit;
  canvas.height = FACE * unit;
  const ctx = canvas.getContext('2d');
  const fill = (color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * unit, y * unit, w * unit, h * unit);
  };
  fill(PURPLE_DARK, 0, 0, FACE, FACE);            // arête
  fill(PURPLE, 1, 1, FACE - 2, FACE - 2);
  fill(PURPLE_LIGHT, 1, 1, FACE - 2, 1);          // reflet
  for (const [cx, cy] of PIPS[value]) fill(GOLD, 2 + cx * 4, 2 + cy * 4, 3, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

// Éclat du premier contact d'un dé avec la case
const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const SPARK = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };

// Rebonds d'un dé, en temps comptés depuis son départ : [début, fin, hauteur]. Avant, il tombe.
const LANDING = 0.3;
const BOUNCES = [[LANDING, 0.62, 0.55], [0.62, 0.84, 0.22], [0.84, 1, 0.08]];
const FALL_HEIGHT = 3.2;
const SPAN = 0.6;   // part de l'effet que dure la chute d'un dé, rebonds compris
const STAGGER = 0.09; // décalage entre deux dés
const LEAP = 0.78;  // moment où les dés sautent vers le pion
const SPREAD = 0.36; // distance du pion à laquelle ils tombent

// count : nombre de dés (2 ou 3) ; mesh : le pion ; size : son échelle ; top : sommet de sa tête ;
// ground : hauteur du dessus de sa case ; gradientMap : dégradé de l'ombrage « toon » ;
// random : source de hasard.
// Retourne { group (à ajouter à la scène), update(k), dispose() }. L'appelant remet le pion à sa taille.
export function buildDice({ count, mesh, size, top, ground, gradientMap, random = Math.random }) {
  const group = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  // Faces opposées : leur somme fait 7 (ordre des faces d'un cube : +x, -x, +y, -y, +z, -z)
  const faces = [3, 4, 1, 6, 2, 5].map(value => new THREE.MeshToonMaterial({ map: faceTexture(value), gradientMap }));
  const outline = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

  const rest = ground + SIDE / 2;
  const turn = random() * Math.PI * 2;
  const dice = Array.from({ length: count }, (_, i) => {
    const angle = turn + (i / count) * Math.PI * 2;
    const spot = new THREE.Vector3(top.x + Math.cos(angle) * SPREAD, rest, top.z + Math.sin(angle) * SPREAD);
    const die = new THREE.Group();
    const body = new THREE.Mesh(box, faces);
    body.castShadow = true;
    const hull = new THREE.Mesh(box, outline); // contour : l'envers d'un cube un peu plus grand
    hull.scale.setScalar(1.13);
    die.add(hull, body);
    die.visible = false;
    group.add(die);
    return {
      die,
      spot,
      spin: new THREE.Vector3(5 + random() * 4, 6 + random() * 4, 3 + random() * 3),
      delay: i * STAGGER,
      burst: pixelSprite(group, spot, 15, 15, 42, PIXEL * 0.7),
    };
  });
  const position = new THREE.Vector3();

  return {
    group,
    update(k) {
      const leap = clamp01((k - LEAP) / (1 - LEAP));
      for (const { die, spot, spin, delay, burst } of dice) {
        const t = clamp01((k - delay) / SPAN);
        let height = (1 - (t / LANDING) ** 2) * FALL_HEIGHT; // la chute
        let landed = LANDING;                                // dernier contact avec la case
        for (const [from, to, peak] of BOUNCES) {
          if (t >= from) {
            height = Math.sin(clamp01((t - from) / (to - from)) * Math.PI) * peak;
            landed = from;
          }
        }
        position.copy(spot);
        position.y += Math.max(0, height);
        // Ils sautent ensemble vers la tête du pion et y disparaissent
        if (leap > 0) {
          position.lerp(top, easeOut(leap));
          position.y += Math.sin(leap * Math.PI) * 0.35;
        }
        const zoom = k < delay ? 0 : 1 - leap * leap;
        const turned = t * 3 + leap * 2;
        die.visible = zoom > 0.001;
        die.position.copy(position);
        die.rotation.set(spin.x * turned, spin.y * turned, spin.z * turned);
        die.scale.setScalar(Math.max(zoom, 0.001) * SIDE);
        // Le dé s'écrase un instant à chaque contact
        const squash = t >= LANDING && leap === 0 ? Math.max(0, 1 - (t - landed) / 0.035) : 0;
        die.scale.y *= 1 - 0.3 * squash;

        const since = t - LANDING;
        const stage = since < 0 || since >= 0.16 ? -1 : Math.floor(since / 0.04);
        if (stage < 0) burst.show(null);
        else burst.show(`burst${stage}`, BURSTS[stage], SPARK);
      }
      // Le pion gonfle en les recevant
      const gulp = Math.max(0, 1 - Math.abs(k - 0.95) / 0.05);
      mesh.scale.setScalar(size * (1 + 0.15 * gulp));
    },
    dispose() {
      for (const { burst } of dice) burst.dispose();
      box.dispose();
      outline.dispose();
      for (const face of faces) {
        face.map.dispose();
        face.dispose();
      }
    },
  };
}
