// Fortune du Joker et Chance Dorée : la roulette qui précède l'effet tiré au sort.
//
// Plusieurs mises en scène à l'essai (essais.html), à la place des symboles de carte ou d'étoile
// qui tournent au-dessus du joueur. Chacune a deux habillages : des cartes pour le Joker
// (symbol 'joker'), une machine à sous et de l'or pour la Chance Dorée (symbol 'golden').
// Elle se construit avec buildRoulette(style, options) et se pilote par update(k), k allant de 0
// à 1 sur la durée de la roulette ; elle finit par un éclat blanc, d'où sort l'effet tiré.
// L'appelant remet le pion à sa taille.

import * as THREE from 'three';
import { EDGE, createGrid, put, addEdge, gridFromRows } from './pixelGrid.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { COIN_FRAMES, COIN_PALETTE } from './coinArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

export const ROULETTE_STYLES = {
  drop: 'Tombée du ciel',
  ring: 'Ronde',
  row: 'Main de cartes, rouleaux',
  wheel: 'Roue de la fortune',
};

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const PALE = '#fff3a0';
const ORANGE = '#ff9d2e';
const PAPER = '#f6f6fa';
const RED = '#e23d3d';
const PURPLE = '#9a6bff';

const REVEAL = 0.82; // tout devient blanc : le sort est tiré
const POP = 0.9;     // éclat final

const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - (1 - t) ** 2;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);
// Palette « tout blanc, cerné d'or » d'un dessin dont les codes vont de 2 à `last`
const whiteOf = last => Object.fromEntries([[EDGE, GOLD], ...Array.from({ length: last - 1 }, (_, i) => [i + 2, '#ffffff'])]);

const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));
const SPARK = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };
function showBurst(item, k, at = POP, span = 0.1) {
  const since = k - at;
  const stage = since < 0 || since >= span ? -1 : Math.min(BURST_STAGES - 1, Math.floor((since / span) * BURST_STAGES));
  if (stage < 0) item.show(null);
  else item.show(`burst${stage}`, BURSTS[stage], SPARK);
}

// Le pion trépigne pendant le suspense, et sursaute quand le sort est tiré
function fidget(mesh, size, k) {
  const wait = k < REVEAL ? Math.abs(Math.sin(k * 26)) * 0.04 : 0;
  const jump = bump(k, REVEAL + 0.04, 0.06);
  mesh.scale.set(size * (1 - wait), size * (1 + wait + 0.14 * jump), size * (1 - wait));
}

// --- Dessins ---

// Carte à jouer : son dos, et ses faces (cœur, pique, carreau, étoile)
const CARD = { [EDGE]: INK, 2: PAPER, 3: PURPLE, 4: '#c9b3ff', 5: RED, 6: '#2a2a4a', 7: GOLD };
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
const CARD_FACES = SUITS.map((suit) => {
  const rows = Array.from({ length: 13 }, () => 'WWWWWWWWW'.split(''));
  suit.forEach((line, y) => [...line].forEach((mark, x) => {
    if (mark !== '.') rows[4 + y][2 + x] = mark;
  }));
  return gridFromRows(rows.map(row => row.join('')), CARD_CODES);
});
const STAR_FACE = CARD_FACES.length - 1;

// Étoile et scintillement dorés
const GOLDEN = { [EDGE]: INK, 2: GOLD, 3: '#fffbe6' };
const STAR_ART = gridFromRows([
  '....Y....',
  '....Y....',
  '...YWY...',
  'YYYYWYYYY',
  '.YYWWWYY.',
  '..YWWWY..',
  '..YYWYY..',
  '.YY...YY.',
  '.Y.....Y.',
], { Y: 2, W: 3 });

// Rouleau de machine à sous : une tuile dorée, avec un sept, un joyau, une pièce ou une étoile
const REEL = { [EDGE]: INK, 2: GOLD, 3: '#fdfdf5', 4: RED, 5: '#3f8cff', 6: ORANGE };
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

// Machine à sous : trois fenêtres, dont chacune tourne (deux images) ou montre l'étoile
const SLOT = { [EDGE]: INK, 2: GOLD, 3: PALE, 4: '#7a5a00', 5: '#fdfdf5', 6: '#b9bccb', 7: RED, 8: ORANGE };
const SLOT_WHITE = whiteOf(8);
const WINDOWS = [['WWW', 'SSS', 'WWW'], ['SSS', 'WWW', 'SSS'], ['WOW', 'OOO', 'WOW']];
const slotCache = new Map();
// states : pour chaque fenêtre, 0 ou 1 (elle tourne) ou 2 (étoile)
function slotGrid(states) {
  const key = states.join('');
  if (!slotCache.has(key)) {
    const panes = line => states.map(state => WINDOWS[state][line]).join('D');
    slotCache.set(key, gridFromRows([
      '.GGGGGGGGGGGGG.',
      'GYYYYYYYYYYYYYG',
      'GDDDDDDDDDDDDDG',
      `GD${panes(0)}DG`,
      `GD${panes(1)}DG`,
      `GD${panes(2)}DG`,
      'GDDDDDDDDDDDDDG',
      'GGGGGGGGGGGGGGG',
      'GGGRRRRRRRRRGGG',
      'GGGGGGGGGGGGGGG',
      '.GGGGGGGGGGGGG.',
    ], { G: 2, Y: 3, D: 4, W: 5, S: 6, R: 7, O: 8 }));
  }
  return slotCache.get(key);
}
const SLOT_ART = slotGrid([2, 2, 2]);

// Roue de la fortune : huit quartiers de deux couleurs. turn (0 à WHEEL_STEPS - 1) la fait tourner
// d'un quart de tour, après quoi le dessin se répète.
const WHEEL_SIZE = 23;
const WHEEL_STEPS = 12;
const WHEELS = Array.from({ length: WHEEL_STEPS }, (_, turn) => {
  const centre = (WHEEL_SIZE - 1) / 2;
  const grid = createGrid(WHEEL_SIZE, WHEEL_SIZE);
  const offset = (turn / WHEEL_STEPS) * (Math.PI / 2);
  for (let y = 0; y < WHEEL_SIZE; y++) {
    for (let x = 0; x < WHEEL_SIZE; x++) {
      const reach = Math.hypot(x - centre, y - centre);
      if (reach > 10.3) continue;
      const slice = Math.floor(((Math.atan2(y - centre, x - centre) + offset + Math.PI * 4) % (Math.PI * 2)) / (Math.PI / 4));
      put(grid, x, y, reach > 8.8 ? 4 : (reach < 1.8 ? 5 : 2 + (slice % 2)));
    }
  }
  return addEdge(grid);
});
const WHEEL_JOKER = { [EDGE]: INK, 2: PURPLE, 3: '#ff5a7a', 4: PAPER, 5: GOLD };
const WHEEL_GOLDEN = { [EDGE]: INK, 2: GOLD, 3: ORANGE, 4: PALE, 5: '#ffffff' };
const WHEEL_WHITE = whiteOf(5);
const POINTER_ART = gridFromRows(['YYYYY', '.YYY.', '..Y..'], { Y: 2 });

// --- Tombée du ciel : une carte, ou une machine à sous, tombe sur la tête du pion et s'y affole ---

const DROP_LAND = 0.16;
const REEL_STOPS = [0.42, 0.56, 0.7]; // arrêt de chaque fenêtre de la machine

function rouletteDrop({ group, golden, mesh, size, top }) {
  const art = golden ? SLOT_ART : CARD_BACK;
  const item = pixelSprite(group, top, art.width, art.height, 41, PIXEL * 0.62);
  item.sprite.center.set(0.5, 0);
  const burst = pixelSprite(group, top, 15, 15, 42);
  burst.sprite.position.set(top.x, top.y + 0.25, top.z);

  return {
    update(k) {
      const since = k - DROP_LAND;
      let height = 0;
      if (since < 0) height = (1 - (k / DROP_LAND) ** 2) * 3.2;                  // la chute
      else if (since < 0.1) height = Math.sin((since / 0.1) * Math.PI) * 0.14;   // un rebond
      item.sprite.position.set(top.x, top.y + 0.02 + height, top.z);
      const squash = since >= 0 ? Math.max(0, 1 - since / 0.03) : 0;
      let width = 1;

      if (k >= POP) {
        item.show(null);
      } else if (golden) {
        // Les fenêtres tournent, puis s'arrêtent l'une après l'autre sur l'étoile
        const states = REEL_STOPS.map((stop, i) => (k >= stop ? 2 : (Math.floor(k * 40) + i) % 2));
        if (k >= REVEAL) item.show('white', SLOT_ART, SLOT_WHITE);
        else item.show(states.join(''), slotGrid(states), SLOT);
      } else {
        // La carte se retourne quatre fois, de plus en plus lentement, et finit sur l'étoile
        const turned = easeOut(clamp01(since / (REVEAL - DROP_LAND))) * 4;
        const angle = turned * Math.PI * 2;
        width = Math.max(0.08, Math.abs(Math.cos(angle)));
        const face = Math.min(STAR_FACE, Math.floor(turned));
        if (k >= REVEAL) item.show('white', CARD_FACES[STAR_FACE], CARD_WHITE);
        else if (since < 0 || Math.cos(angle) < 0) item.show('back', CARD_BACK, CARD);
        else item.show(`face${face}`, CARD_FACES[face], CARD);
      }
      item.sprite.scale.set(item.size.x * width * (1 + 0.14 * squash), item.size.y * (1 - 0.22 * squash), 1);
      showBurst(burst, k);

      fidget(mesh, size, k);
      const hit = bump(k, DROP_LAND + 0.02, 0.04);
      mesh.scale.y *= 1 - 0.16 * hit;
    },
    dispose() {
      item.dispose();
      burst.dispose();
    },
  };
}

// --- Ronde : des cartes, ou des étoiles et des pièces, tournent autour du pion de plus en plus
// vite, puis se fondent en lui ---

const RING_CLOSE = 0.7;

function rouletteRing({ group, golden, mesh, size, top, ground, camera }) {
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.55, top.z);
  const count = golden ? 6 : 5;
  const items = Array.from({ length: count }, (_, i) => {
    const coin = golden && i % 2 === 1;
    const art = golden ? (coin ? COIN_FRAMES[0] : STAR_ART) : CARD_BACK;
    return { item: pixelSprite(group, centre, art.width, art.height, 41, PIXEL * (golden ? 0.45 : 0.4)), coin };
  });
  const burst = pixelSprite(group, centre, 15, 15, 42);
  const position = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  return {
    update(k) {
      const closing = clamp01((k - RING_CLOSE) / (REVEAL - RING_CLOSE));
      const radius = lerp(0.52, 0.34, clamp01(k / RING_CLOSE)) * (1 - closing * closing);
      items.forEach(({ item, coin }, i) => {
        if (k >= REVEAL) {
          item.show(null);
          return;
        }
        const angle = (k * 1.2 + k * k * 2.4 + i / count) * Math.PI * 2;
        position.set(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle * 2 + i) * 0.04, centre.z + Math.sin(angle) * radius);
        item.sprite.position.copy(position);
        const behind = camera.position.distanceToSquared(position) > reach;
        item.material.depthTest = behind; // derrière le pion, caché par lui
        item.setZoom(Math.max(0.001, popIn(clamp01(k / 0.12))));
        const white = closing > 0.55;
        if (golden && coin) {
          const frame = (Math.floor(k * 40) + i) % COIN_FRAMES.length;
          item.show(`coin${frame}|${white}`, COIN_FRAMES[frame], white ? CARD_WHITE : COIN_PALETTE);
        } else if (golden) {
          item.show(`star|${white}`, STAR_ART, white ? CARD_WHITE : GOLDEN);
        } else if (white) {
          item.show('white', CARD_FACES[STAR_FACE], CARD_WHITE);
        } else if (behind) {
          // De dos derrière le pion, de face devant lui : chaque carte montre sa figure en passant
          item.show('back', CARD_BACK, CARD);
        } else {
          item.show(`face${i % CARD_FACES.length}`, CARD_FACES[i % CARD_FACES.length], CARD);
        }
      });
      showBurst(burst, k, REVEAL);
      fidget(mesh, size, k);
    },
    dispose() {
      for (const { item } of items) item.dispose();
      burst.dispose();
    },
  };
}

// --- Main de cartes, rouleaux : pour le Joker, cinq cartes en éventail sont battues, puis l'une
// se retourne ; pour la Chance Dorée, trois rouleaux tournent et s'arrêtent l'un après l'autre ---

const FAN = 5;
const SHUFFLE_FROM = 0.14;
const SHUFFLE_STEP = 0.07;
const SHUFFLE_STEPS = 8;
const PICK = 0.72; // la carte du milieu sort du jeu

function rouletteRow({ group, golden, mesh, size, top, right, random }) {
  const pivot = new THREE.Vector3(top.x, top.y + 0.08, top.z);
  const middle = new THREE.Vector3(top.x, top.y + 0.5, top.z);
  const burst = pixelSprite(group, middle, 15, 15, 42);
  const position = new THREE.Vector3();

  if (golden) {
    const reels = [0, 1, 2].map((i) => {
      const at = middle.clone().addScaledVector(right, (i - 1) * 0.36);
      return { item: pixelSprite(group, at, REELS[0].width, REELS[0].height, 41, PIXEL * 0.6), at, stop: REEL_STOPS[i] };
    });
    return {
      update(k) {
        reels.forEach(({ item, at, stop }, i) => {
          if (k >= POP) {
            item.show(null);
            return;
          }
          const stopped = k >= stop;
          const mark = stopped ? JACKPOT : (Math.floor(k * 45) + i) % JACKPOT;
          if (k >= REVEAL) item.show('white', REELS[JACKPOT], REEL_WHITE);
          else item.show(`reel${mark}`, REELS[mark], REEL);
          // Le rouleau tremble tant qu'il tourne, et grossit un instant en s'arrêtant
          item.sprite.position.set(at.x, at.y + (stopped ? 0 : 0.025 * ((Math.floor(k * 45) + i) % 2 ? 1 : -1)), at.z);
          item.setZoom(Math.max(0.001, popIn(clamp01((k - i * 0.04) / 0.1)) * (1 + 0.25 * bump(k, stop + 0.015, 0.03))));
        });
        showBurst(burst, k);
        fidget(mesh, size, k);
      },
      dispose() {
        for (const { item } of reels) item.dispose();
        burst.dispose();
      },
    };
  }

  // Battage : à chaque étape, deux cartes échangent leur place dans l'éventail
  const orders = [Array.from({ length: FAN }, (_, i) => i)];
  for (let step = 0; step < SHUFFLE_STEPS; step++) {
    const order = orders[step].slice();
    const a = Math.floor(random() * FAN);
    const b = (a + 1 + Math.floor(random() * (FAN - 1))) % FAN;
    [order[a], order[b]] = [order[b], order[a]];
    orders.push(order);
  }
  const final = orders[SHUFFLE_STEPS];
  const cards = Array.from({ length: FAN }, (_, i) => ({ item: pixelSprite(group, pivot, CARD_BACK.width, CARD_BACK.height, 41, PIXEL * 0.42), picked: final[i] === (FAN - 1) / 2 }));

  return {
    update(k) {
      const beat = clamp01((k - SHUFFLE_FROM) / SHUFFLE_STEP / SHUFFLE_STEPS) * SHUFFLE_STEPS;
      const step = Math.min(SHUFFLE_STEPS - 1, Math.floor(beat));
      const moved = easeOut(clamp01(beat - step));
      const out = clamp01((k - PICK) / (REVEAL - PICK));
      cards.forEach(({ item, picked }, i) => {
        if (k >= POP || (!picked && out >= 1)) {
          item.show(null);
          return;
        }
        // Sa place dans l'éventail, entre celle d'avant l'échange et celle d'après
        const place = lerp(orders[step][i], orders[step + 1][i], moved) - (FAN - 1) / 2;
        const lean = place * 0.3;
        const far = 0.5 + (picked ? 0.28 * easeOut(out) : 0);
        position.copy(pivot).addScaledVector(right, Math.sin(lean) * far);
        position.y += Math.cos(lean) * far;
        item.sprite.position.copy(position);
        item.material.rotation = -lean;
        // La carte tirée se retourne en sortant du jeu ; les autres s'effacent
        const flip = picked ? Math.cos(out * Math.PI) : 1;
        const zoom = popIn(clamp01((k - i * 0.02) / 0.1)) * (picked ? 1 + 0.3 * out : 1 - out);
        item.sprite.scale.set(item.size.x * Math.max(0.001, zoom) * Math.max(0.08, Math.abs(flip)), item.size.y * Math.max(0.001, zoom), 1);
        if (k >= REVEAL) item.show('white', CARD_FACES[STAR_FACE], CARD_WHITE);
        else if (flip < 0) item.show('star', CARD_FACES[STAR_FACE], CARD);
        else item.show('back', CARD_BACK, CARD);
      });
      showBurst(burst, k);
      fidget(mesh, size, k);
    },
    dispose() {
      for (const { item } of cards) item.dispose();
      burst.dispose();
    },
  };
}

// --- Roue de la fortune : une roue tourne au-dessus du pion sous son aiguille, et ralentit ---

const WHEEL_TURNS = 78; // images parcourues pendant l'effet (douze par quart de tour)

function rouletteWheel({ group, golden, mesh, size, top }) {
  const centre = new THREE.Vector3(top.x, top.y + 0.5, top.z);
  const wheel = pixelSprite(group, centre, WHEEL_SIZE, WHEEL_SIZE, 41, PIXEL * 0.6);
  const pointer = pixelSprite(group, centre, POINTER_ART.width, POINTER_ART.height, 42, PIXEL * 0.6);
  pointer.sprite.position.set(centre.x, centre.y + 0.36, centre.z);
  const burst = pixelSprite(group, centre, 15, 15, 43, PIXEL * 1.2);

  return {
    update(k) {
      const turned = easeOut(clamp01(k / REVEAL)) * WHEEL_TURNS;
      const frame = Math.floor(turned) % WHEEL_STEPS;
      if (k >= POP) {
        wheel.show(null);
        pointer.show(null);
      } else {
        if (k >= REVEAL) wheel.show('white', WHEELS[frame], WHEEL_WHITE);
        else wheel.show(`wheel${frame}`, WHEELS[frame], golden ? WHEEL_GOLDEN : WHEEL_JOKER);
        pointer.show('pointer', POINTER_ART, GOLDEN);
        wheel.setZoom(Math.max(0.001, popIn(clamp01(k / 0.12))));
        pointer.setZoom(Math.max(0.001, popIn(clamp01(k / 0.12))));
        // L'aiguille claque à chaque quartier qui passe
        pointer.material.rotation = k < REVEAL ? Math.sin((turned / (WHEEL_STEPS / 2)) * Math.PI) * 0.3 : 0;
      }
      showBurst(burst, k);
      fidget(mesh, size, k);
    },
    dispose() {
      wheel.dispose();
      pointer.dispose();
      burst.dispose();
    },
  };
}

const BUILDERS = { drop: rouletteDrop, ring: rouletteRing, row: rouletteRow, wheel: rouletteWheel };

// Construit la roulette au-dessus d'un pion.
//   symbol : 'joker' ou 'golden' ; mesh : le pion ; size : son échelle ; top : sommet de sa tête ;
//   ground : hauteur du dessus de sa case ; right : la droite de l'écran, à plat ; camera : la
//   caméra ; random : source de hasard.
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildRoulette(style, { symbol, mesh, size, top, ground, right, camera, random = Math.random }) {
  const group = new THREE.Group();
  const roulette = BUILDERS[style]({ group, golden: symbol === 'golden', mesh, size, top, ground, right, camera, random });
  return { group, update: k => roulette.update(k), dispose: () => roulette.dispose() };
}
