// Fortune du Joker et Chance Dorée : la roulette qui précède l'effet tiré au sort.
//
//   - Fortune du Joker : des cartes tournent autour du pion de plus en plus vite, de dos derrière
//     lui et de face devant, puis se fondent en lui.
//   - Chance Dorée : trois rouleaux de machine à sous tournent au-dessus du pion et s'arrêtent
//     l'un après l'autre sur l'étoile.
// Les deux finissent par un éclat blanc, d'où sort l'effet tiré.
//
// buildRoulette(options) construit l'effet ; il se pilote par update(k), k allant de 0 à 1 sur la
// durée de la roulette. L'appelant remet le pion à sa taille.

import * as THREE from 'three';
import { EDGE, gridFromRows } from './pixelGrid.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const RED = '#e23d3d';

const REVEAL = 0.82; // tout devient blanc : le sort est tiré
const POP = 0.9;     // éclat final des rouleaux

const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
// Bosse de 0 à 1 autour de l'instant `at`, large de `width` de chaque côté
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);
// Palette « tout blanc, cerné d'or » d'un dessin dont les codes vont de 2 à `last`
const whiteOf = last => Object.fromEntries([[EDGE, GOLD], ...Array.from({ length: last - 1 }, (_, i) => [i + 2, '#ffffff'])]);

const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const SPARK = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };
const BURST_SPAN = 0.1;
// Éclat en quatre images, à partir de l'instant `at`
function showBurst(item, k, at) {
  const since = k - at;
  const stage = since < 0 || since >= BURST_SPAN ? -1 : Math.min(BURST_STAGES - 1, Math.floor((since / BURST_SPAN) * BURST_STAGES));
  if (stage < 0) item.show(null);
  else item.show(`burst${stage}`, BURSTS[stage], SPARK);
}

// Le pion trépigne pendant le suspense, et sursaute quand le sort est tiré
function fidget(mesh, size, k) {
  const wait = k < REVEAL ? Math.abs(Math.sin(k * 26)) * 0.04 : 0;
  const jump = bump(k, REVEAL + 0.04, 0.06);
  mesh.scale.set(size * (1 - wait), size * (1 + wait + 0.14 * jump), size * (1 - wait));
}

// --- Fortune du Joker : la ronde de cartes ---

// Carte à jouer : son dos, et ses faces (cœur, pique, carreau, étoile)
const CARD = { [EDGE]: INK, 2: '#f6f6fa', 3: '#9a6bff', 4: '#c9b3ff', 5: RED, 6: '#2a2a4a', 7: GOLD };
const CARD_WHITE = whiteOf(7);
const CARD_CODES = { W: 2, P: 3, L: 4, R: 5, D: 6, Y: 7 };
const CARD_BACK = gridFromRows([
  'WWWWWWWWW',
  'WPPPPPPPW',
  'WPLPLPLPW',
  'WPPLPLPPW',
  'WPLPLPLPW',
  'WPPLPLPPW',
  'WPLPLPLPW',
  'WPPLPLPPW',
  'WPLPLPLPW',
  'WPPLPLPPW',
  'WPLPLPLPW',
  'WPPPPPPPW',
  'WWWWWWWWW',
], CARD_CODES);
const SUITS = [
  ['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..'], // cœur
  ['..D..', '.DDD.', 'DDDDD', 'DDDDD', '..D..'], // pique
  ['..R..', '.RRR.', 'RRRRR', '.RRR.', '..R..'], // carreau
  ['..Y..', '.YYY.', 'YYYYY', '.YYY.', '.Y.Y.'], // étoile : la carte du Joker
];
// Une face : la carte blanche, sa figure au milieu
const CARD_FACES = SUITS.map((suit) => {
  const rows = Array.from({ length: 13 }, () => 'WWWWWWWWW'.split(''));
  suit.forEach((line, y) => [...line].forEach((mark, x) => {
    if (mark !== '.') rows[4 + y][2 + x] = mark;
  }));
  return gridFromRows(rows.map(row => row.join('')), CARD_CODES);
});
const STAR_FACE = CARD_FACES.length - 1;

const CARDS = 5;         // cartes de la ronde
const RING_CLOSE = 0.7;  // la ronde se resserre

function jokerRing({ group, mesh, size, top, ground, camera }) {
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.55, top.z);
  const cards = Array.from({ length: CARDS }, () => pixelSprite(group, centre, CARD_BACK.width, CARD_BACK.height, 41, PIXEL * 0.4));
  const burst = pixelSprite(group, centre, 15, 15, 42);
  const position = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  return {
    update(k) {
      const closing = clamp01((k - RING_CLOSE) / (REVEAL - RING_CLOSE));
      const radius = lerp(0.52, 0.34, clamp01(k / RING_CLOSE)) * (1 - closing * closing);
      cards.forEach((item, i) => {
        if (k >= REVEAL) {
          item.show(null);
          return;
        }
        // La ronde accélère
        const angle = (k * 1.2 + k * k * 2.4 + i / CARDS) * Math.PI * 2;
        position.set(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle * 2 + i) * 0.04, centre.z + Math.sin(angle) * radius);
        item.sprite.position.copy(position);
        const behind = camera.position.distanceToSquared(position) > reach;
        item.material.depthTest = behind; // derrière le pion, la carte est cachée par lui
        item.setZoom(Math.max(0.001, popIn(clamp01(k / 0.12))));
        // De dos derrière le pion, de face devant lui : chaque carte montre sa figure en passant.
        // En se resserrant, toutes deviennent blanches.
        if (closing > 0.55) item.show('white', CARD_FACES[STAR_FACE], CARD_WHITE);
        else if (behind) item.show('back', CARD_BACK, CARD);
        else item.show(`face${i % CARD_FACES.length}`, CARD_FACES[i % CARD_FACES.length], CARD);
      });
      showBurst(burst, k, REVEAL);
      fidget(mesh, size, k);
    },
    dispose() {
      for (const item of cards) item.dispose();
      burst.dispose();
    },
  };
}

// --- Chance Dorée : les trois rouleaux ---

// Rouleau de machine à sous : une tuile dorée, avec un sept, un joyau, une pièce ou une étoile
const REEL = { [EDGE]: INK, 2: GOLD, 3: '#fdfdf5', 4: RED, 5: '#3f8cff', 6: '#ff9d2e' };
const REEL_WHITE = whiteOf(6);
const REEL_MARKS = [
  ['RRRRR', '....R', '...R.', '..R..', '..R..'], // sept
  ['..B..', '.BBB.', 'BBBBB', '.BBB.', '..B..'], // joyau
  ['.OOO.', 'OOOOO', 'OO.OO', 'OOOOO', '.OOO.'], // pièce
  ['..O..', '.OOO.', 'OOOOO', '.OOO.', '.O.O.'], // étoile : le gros lot
];
const REELS = REEL_MARKS.map((mark) => {
  const rows = Array.from({ length: 9 }, (_, y) => (y === 0 || y === 8 ? 'GGGGGGGGG' : 'GWWWWWWWG').split(''));
  mark.forEach((line, y) => [...line].forEach((sign, x) => {
    if (sign !== '.') rows[2 + y][2 + x] = sign;
  }));
  return gridFromRows(rows.map(row => row.join('')), { G: 2, W: 3, R: 4, B: 5, O: 6 });
});
const JACKPOT = REELS.length - 1;

const REEL_STOPS = [0.42, 0.56, 0.7]; // arrêt de chaque rouleau
const REEL_GAP = 0.36;                // écart entre deux rouleaux, en unités de case
const REEL_RATE = 45;                 // changements de figure pendant l'effet

function goldenReels({ group, mesh, size, top, right }) {
  const middle = new THREE.Vector3(top.x, top.y + 0.5, top.z);
  const reels = REEL_STOPS.map((stop, i) => {
    const at = middle.clone().addScaledVector(right, (i - 1) * REEL_GAP);
    return { item: pixelSprite(group, at, REELS[0].width, REELS[0].height, 41, PIXEL * 0.6), at, stop };
  });
  const burst = pixelSprite(group, middle, 15, 15, 42);

  return {
    update(k) {
      reels.forEach(({ item, at, stop }, i) => {
        if (k >= POP) {
          item.show(null);
          return;
        }
        const stopped = k >= stop;
        const tick = Math.floor(k * REEL_RATE) + i;
        const mark = stopped ? JACKPOT : tick % JACKPOT;
        if (k >= REVEAL) item.show('white', REELS[JACKPOT], REEL_WHITE);
        else item.show(`reel${mark}`, REELS[mark], REEL);
        // Le rouleau tremble tant qu'il tourne, et grossit un instant en s'arrêtant
        item.sprite.position.set(at.x, at.y + (stopped ? 0 : 0.025 * (tick % 2 ? 1 : -1)), at.z);
        item.setZoom(Math.max(0.001, popIn(clamp01((k - i * 0.04) / 0.1)) * (1 + 0.25 * bump(k, stop + 0.015, 0.03))));
      });
      showBurst(burst, k, POP);
      fidget(mesh, size, k);
    },
    dispose() {
      for (const { item } of reels) item.dispose();
      burst.dispose();
    },
  };
}

// symbol : 'joker' (Fortune du Joker) ou 'golden' (Chance Dorée) ; mesh : le pion ; size : son
// échelle ; top : sommet de sa tête ; ground : hauteur du dessus de sa case ; right : la droite de
// l'écran, à plat (les rouleaux s'y alignent) ; camera : la caméra (pour savoir quelles cartes
// passent derrière le pion).
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildRoulette({ symbol, mesh, size, top, ground, right, camera }) {
  const group = new THREE.Group();
  const roulette = symbol === 'golden'
    ? goldenReels({ group, mesh, size, top, right })
    : jokerRing({ group, mesh, size, top, ground, camera });
  return { group, update: k => roulette.update(k), dispose: () => roulette.dispose() };
}
