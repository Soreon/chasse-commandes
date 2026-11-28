// Double Dé et Triple Dé : les dés que le joueur gagne pour ce tour.
//
// Plusieurs mises en scène à l'essai (essais.html), à la place des symboles de dés qui tournent.
// Chacune se construit avec buildDice(style, options) et se pilote par update(k), k allant de 0
// à 1 sur la durée de l'effet. Les dés ne s'arrêtent jamais sur une face : le vrai lancer vient
// après, et ils ne doivent pas annoncer un autre résultat.

import * as THREE from 'three';
import { EDGE, createGrid, put, addEdge, gridFromRows } from './pixelGrid.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

export const DICE_STYLES = {
  burst: 'Dés qui jaillissent',
  rain: 'Dés tombés du ciel',
  pixel: 'Dés en pixel art',
  split: 'Le dé qui se dédouble',
};

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const PURPLE = '#9a6bff';       // les dés du jeu sont violets à points dorés
const PURPLE_LIGHT = '#b99bff';
const PURPLE_DARK = '#7447e0';
const SIDE = 0.2;               // côté d'un dé, en unités de case

const clamp01 = v => Math.max(0, Math.min(1, v));
const easeOut = t => 1 - (1 - t) ** 2;
// Apparition : grossit un peu trop, puis revient à sa taille
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
// Écart de chaque dé par rapport au milieu, le long de l'écran
const slots = count => Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * 0.36);

// Points de chaque face, sur un quadrillage de 3 × 3
const PIPS = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

// --- Dés en volume : un cube dont chaque face est un petit dessin en pixel art ---

const FACE = 15; // points par côté d'une face

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

// Ce que partagent les dés d'un effet : le cube, ses six faces, son contour
function createKit(gradientMap) {
  // Faces opposées : leur somme fait 7 (ordre des faces d'un cube : +x, -x, +y, -y, +z, -z)
  const faces = [3, 4, 1, 6, 2, 5].map(value => new THREE.MeshToonMaterial({ map: faceTexture(value), gradientMap }));
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    faces,
    hull: new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
    // Éclat blanc de toutes les faces (0 : couleurs normales)
    flash(amount) {
      for (const face of faces) face.emissive.setScalar(amount);
    },
    dispose() {
      this.box.dispose();
      this.hull.dispose();
      for (const face of faces) {
        face.map.dispose();
        face.dispose();
      }
    },
  };
}

// Un dé, invisible au départ ; place(die, ...) le pose, le tourne et règle sa taille
function makeDie(group, kit) {
  const die = new THREE.Group();
  const body = new THREE.Mesh(kit.box, kit.faces);
  body.castShadow = true;
  const hull = new THREE.Mesh(kit.box, kit.hull); // contour : l'envers d'un cube un peu plus grand
  hull.scale.setScalar(1.13);
  die.add(hull, body);
  die.visible = false;
  group.add(die);
  return die;
}

function place(die, position, zoom, rx = 0, ry = 0, rz = 0) {
  die.visible = zoom > 0.001;
  die.position.copy(position);
  die.scale.setScalar(Math.max(zoom, 0.001) * SIDE);
  die.rotation.set(rx, ry, rz);
}

const randomSpin = random => new THREE.Vector3(5 + random() * 4, 6 + random() * 4, 3 + random() * 3);
const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const SPARK = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };

// --- Dés qui jaillissent : ils sortent du pion, montent en tournoyant et rebondissent en l'air ---

function diceBurst({ group, kit, count, mesh, size, top, right, random }) {
  const dice = slots(count).map((offset, i) => ({ die: makeDie(group, kit), offset, spin: randomSpin(random), delay: i * 0.05 }));
  const position = new THREE.Vector3();

  return {
    update(k) {
      for (const { die, offset, spin, delay } of dice) {
        const t = clamp01((k - delay) / (1 - delay));
        const rise = easeOut(clamp01(t / 0.25));
        const hop = Math.abs(Math.sin(clamp01((t - 0.25) / 0.6) * Math.PI * 2)) * 0.16;
        const away = clamp01((t - 0.85) / 0.15);
        position.copy(top).addScaledVector(right, offset * rise);
        position.y += 0.12 + 0.36 * rise + hop + 0.25 * away;
        place(die, position, t <= 0 ? 0 : popIn(clamp01(t / 0.2)) * (1 - away), spin.x * t * 2.2, spin.y * t * 2.2, spin.z * t * 2.2);
      }
      // Le pion s'étire en les lançant
      const toss = Math.max(0, 1 - Math.abs(k - 0.05) / 0.05);
      mesh.scale.set(size * (1 - 0.08 * toss), size * (1 + 0.12 * toss), size * (1 - 0.08 * toss));
    },
  };
}

// --- Dés tombés du ciel : ils rebondissent sur la case autour du pion, puis sautent vers lui ---

// Rebonds d'un dé, en temps comptés depuis son arrivée : [début, fin, hauteur]
const BOUNCES = [[0.3, 0.62, 0.55], [0.62, 0.84, 0.22], [0.84, 1, 0.08]];
const RAIN_SPAN = 0.6;  // part de l'effet que dure la chute d'un dé, rebonds compris
const RAIN_LEAP = 0.78; // moment où les dés sautent vers le pion

function diceRain({ group, kit, count, mesh, size, top, ground, random }) {
  const rest = ground + SIDE / 2;
  const turn = random() * Math.PI * 2;
  const dice = Array.from({ length: count }, (_, i) => {
    const angle = turn + (i / count) * Math.PI * 2;
    const spot = new THREE.Vector3(top.x + Math.cos(angle) * 0.36, rest, top.z + Math.sin(angle) * 0.36);
    return { die: makeDie(group, kit), spot, spin: randomSpin(random), delay: i * 0.09, burst: pixelSprite(group, spot, 15, 15, 42, PIXEL * 0.7) };
  });
  const position = new THREE.Vector3();

  return {
    update(k) {
      const leap = clamp01((k - RAIN_LEAP) / (1 - RAIN_LEAP));
      for (const { die, spot, spin, delay, burst } of dice) {
        const t = clamp01((k - delay) / RAIN_SPAN);
        let height = (1 - (t / 0.3) ** 2) * 3.2; // la chute
        let landed = 0.3;                       // dernier contact avec la case
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
        const turnBy = Math.min(t, 1) * 3 + leap * 2;
        place(die, position, k < delay ? 0 : 1 - leap * leap, spin.x * turnBy, spin.y * turnBy, spin.z * turnBy);
        // Le dé s'écrase un instant à chaque contact
        const squash = t >= 0.3 && leap === 0 ? Math.max(0, 1 - (t - landed) / 0.035) : 0;
        die.scale.y *= 1 - 0.3 * squash;

        const since = t - 0.3; // éclat du premier contact
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
    },
  };
}

// --- Dés en pixel art : des dés dessinés, animés image par image, culbutent au-dessus du pion ---

const DIE_ART = { [EDGE]: INK, 2: PURPLE, 3: PURPLE_LIGHT, 4: GOLD, 5: PURPLE_DARK };
const DIE_WHITE = { [EDGE]: GOLD, 2: '#ffffff', 3: '#ffffff', 4: '#ffffff', 5: '#ffffff' };
const ART = 11; // grille des dés dessinés

// Une face, vue de face : carré aux coins rognés, reflet en haut, ombre en bas
function faceGrid(value) {
  const grid = createGrid(ART, ART);
  for (let y = 1; y <= 9; y++) {
    for (let x = 1; x <= 9; x++) {
      const corner = (x === 1 || x === 9) && (y === 1 || y === 9);
      if (!corner) put(grid, x, y, y === 1 ? 3 : (y === 9 ? 5 : 2));
    }
  }
  for (const [cx, cy] of PIPS[value]) put(grid, 3 + cx * 2, 3 + cy * 2, 4);
  return addEdge(grid);
}

// Le dé en pleine culbute : un losange, avec un point au milieu
function tumbleGrid() {
  const grid = createGrid(ART, ART);
  for (let y = 1; y <= 9; y++) {
    for (let x = 1; x <= 9; x++) {
      const reach = Math.abs(x - 5) + Math.abs(y - 5);
      if (reach <= 4) put(grid, x, y, y < 5 && reach >= 3 ? 3 : (y > 5 && reach >= 3 ? 5 : 2));
    }
  }
  put(grid, 5, 5, 4);
  return addEdge(grid);
}

const FACES = [1, 2, 3, 4, 5, 6].map(faceGrid);
const TUMBLE = tumbleGrid();
const TWINKLE = gridFromRows(['..Y..', '..Y..', 'YYWYY', '..Y..', '..Y..'], { Y: RIM, W: CORE });
const STEPS = 30; // images par effet : le mouvement avance par à-coups, comme un dessin animé

function dicePixel({ group, count, top, right, random }) {
  const dice = slots(count).map((offset, i) => ({
    item: pixelSprite(group, top, ART, ART, 41, PIXEL * 0.55),
    offset,
    first: Math.floor(random() * 6),
    delay: i * 0.05,
  }));
  // Scintillements autour des dés, chacun à son moment
  const twinkles = Array.from({ length: 6 }, (_, i) => {
    const at = new THREE.Vector3().copy(top).addScaledVector(right, (random() - 0.5) * 0.9);
    at.y += 0.25 + random() * 0.55;
    const item = pixelSprite(group, at, TWINKLE.width, TWINKLE.height, 40, PIXEL * 0.5);
    return { item, start: 0.2 + i * 0.1 + random() * 0.04 };
  });
  const position = new THREE.Vector3();

  return {
    update(k) {
      const step = Math.floor(k * STEPS);
      const held = step / STEPS;
      dice.forEach(({ item, offset, first, delay }, i) => {
        const t = clamp01((held - delay) / (1 - delay));
        if (t <= 0 || held >= 0.96) {
          item.show(null);
          return;
        }
        const rise = easeOut(clamp01(t / 0.25));
        position.copy(top).addScaledVector(right, offset * rise);
        position.y += 0.14 + 0.36 * rise + Math.sin(t * Math.PI * 5 + i) * 0.04;
        item.sprite.position.copy(position);
        // Une face, le losange de la culbute, la face suivante… et un éclat blanc pour finir
        const turn = step + i;
        const grid = turn % 2 === 1 ? TUMBLE : FACES[(first + (turn >> 1)) % 6];
        const white = held >= 0.9;
        item.show(`${turn % 2 === 1 ? 'tumble' : (first + (turn >> 1)) % 6}|${white}`, grid, white ? DIE_WHITE : DIE_ART);
      });
      for (const { item, start } of twinkles) {
        const age = (held - start) / 0.14;
        if (age < 0 || age >= 1) item.show(null);
        else item.show('twinkle', TWINKLE, SPARK);
      }
    },
    dispose() {
      for (const { item } of dice) item.dispose();
      for (const { item } of twinkles) item.dispose();
    },
  };
}

// --- Le dé qui se dédouble : un gros dé tourne au-dessus du pion, puis éclate en deux ou trois ---

const SPLIT_AT = 0.42;

function diceSplit({ group, kit, count, mesh, size, top, right, random }) {
  const big = makeDie(group, kit);
  const parts = slots(count).map(offset => ({ die: makeDie(group, kit), offset, spin: randomSpin(random) }));
  const centre = new THREE.Vector3(top.x, top.y + 0.5, top.z);
  const burst = pixelSprite(group, centre, 15, 15, 42);
  const position = new THREE.Vector3();

  return {
    update(k) {
      const since = k - SPLIT_AT;
      if (since < 0) {
        // Le gros dé monte, tourne, et tremble de plus en plus avant d'éclater
        const rise = easeOut(clamp01(k / 0.18));
        const strain = clamp01((k - 0.28) / (SPLIT_AT - 0.28));
        position.copy(top);
        position.y += 0.12 + 0.38 * rise;
        place(big, position, popIn(clamp01(k / 0.15)) * 1.4 * (1 + 0.1 * strain * Math.sin(k * 260)), k * 9, k * 14, 0);
        kit.flash(0.7 * strain);
        for (const { die } of parts) die.visible = false;
      } else {
        big.visible = false;
        const apart = easeOut(clamp01(since / 0.14));
        const hop = Math.sin(clamp01((k - 0.62) / 0.18) * Math.PI) * 0.14; // un saut, tous ensemble
        const away = clamp01((k - 0.88) / 0.12);
        for (const { die, offset, spin } of parts) {
          position.copy(centre).addScaledVector(right, offset * apart);
          position.y += Math.sin(clamp01(since / 0.14) * Math.PI) * 0.16 + hop;
          place(die, position, 1 - away, spin.x * since * 1.6, spin.y * since * 1.6, spin.z * since * 1.6);
        }
        kit.flash(Math.max(0, 0.9 * (1 - since / 0.08)));
      }
      const stage = since < 0 || since >= 0.16 ? -1 : Math.floor(since / 0.04);
      if (stage < 0) burst.show(null);
      else burst.show(`burst${stage}`, BURSTS[stage], SPARK);
      // Le pion s'étire en lançant le dé
      const toss = Math.max(0, 1 - Math.abs(k - 0.05) / 0.05);
      mesh.scale.set(size * (1 - 0.08 * toss), size * (1 + 0.12 * toss), size * (1 - 0.08 * toss));
    },
    dispose() {
      burst.dispose();
    },
  };
}

const BUILDERS = { burst: diceBurst, rain: diceRain, pixel: dicePixel, split: diceSplit };

// Construit l'effet des dés au-dessus d'un pion.
//   count : nombre de dés (2 ou 3) ; mesh : le pion ; size : son échelle ; top : sommet de sa tête ;
//   ground : hauteur du dessus de sa case ; right : la droite de l'écran, à plat ;
//   gradientMap : dégradé de l'ombrage « toon » ; random : source de hasard.
// Retourne { group (à ajouter à la scène), update(k), dispose() }. L'appelant remet le pion à sa taille.
export function buildDice(style, { count, mesh, size, top, ground, right, gradientMap, random = Math.random }) {
  const group = new THREE.Group();
  const kit = createKit(gradientMap);
  const dice = BUILDERS[style]({ group, kit, count, mesh, size, top, ground, right, random });
  return {
    group,
    update: k => dice.update(k),
    dispose() {
      if (dice.dispose) dice.dispose();
      kit.dispose();
    },
  };
}
