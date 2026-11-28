// Double Péage : pendant cinq tours, les péages des cases du joueur sont doublés.
//
// Plusieurs mises en scène à l'essai (essais.html), à la place des « ×2 » qui s'élèvent des cases
// sous un symbole de sac d'or. Chacune se construit avec buildToll(style, options) et se pilote
// par update(k), k allant de 0 à 1 sur la durée de l'effet. L'effet se joue sur les cases du
// joueur ; s'il n'en a aucune, sur la sienne. L'appelant remet le pion à sa taille.

import * as THREE from 'three';
import { EDGE, createGrid, put, addEdge, gridFromRows } from './pixelGrid.js';
import { pixelLabelGrid } from './pixelLabel.js';
import { burstGrid, BURST_STAGES, RIM, CORE } from './lightningArt.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

export const TOLL_STYLES = {
  drop: 'Pièces tombées du ciel',
  ring: 'Ronde de pièces',
  stamp: '« ×2 » frappés sur les cases',
  stack: 'Piles qui doublent',
};

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const GOLD_DARK = '#c99a10';
const PALE = '#fff3a0';
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

// Décalage de chaque case dans le temps : l'effet les parcourt l'une après l'autre
const delayOf = (index, count, spread) => (count > 1 ? (index / (count - 1)) * spread : 0);

// --- Dessins ---

// « ×2 », dans la police du jeu, chaque point doublé : des traits épais, que le liseré ne mange pas
const TIMES = { [EDGE]: INK, 2: GOLD };
const TIMES_WHITE = { [EDGE]: GOLD, 2: '#ffffff' };
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

// Pièce d'or qui tourne sur elle-même : de face, de trois quarts, sur la tranche
const COIN = { [EDGE]: INK, 2: GOLD, 3: PALE, 4: GOLD_DARK };
function coinGrid(half) {
  const size = 11;
  const centre = 5;
  const grid = createGrid(size, size);
  for (let y = 1; y <= 9; y++) {
    for (let x = 1; x <= 9; x++) {
      const dx = (x - centre) / (half + 0.3);
      const dy = (y - centre) / 4.3;
      if (dx * dx + dy * dy > 1) continue;
      // Reflet à gauche, ombre à droite, et une barre claire au milieu de la face
      const mark = half >= 3 && x === centre && Math.abs(y - centre) <= 2;
      put(grid, x, y, mark ? 3 : (x < centre - half / 2 ? 3 : (x > centre + half / 2 ? 4 : 2)));
    }
  }
  return addEdge(grid);
}
const COINS = [4, 3, 1, 3].map(coinGrid);

const TWINKLE = gridFromRows(['..Y..', '..Y..', 'YYWYY', '..Y..', '..Y..'], { Y: RIM, W: CORE });

// --- Pièces en volume : des pavés dorés, cernés de noir ---

const COIN_WIDE = 0.26;
const COIN_HIGH = 0.07;

function createCoins(group, count, gradientMap) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const gold = new THREE.MeshToonMaterial({ color: GOLD, gradientMap });
  const edge = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  const hull = new THREE.InstancedMesh(box, edge, count); // contour : l'envers de pavés plus grands
  const coins = new THREE.InstancedMesh(box, gold, count);
  coins.castShadow = true;
  hull.frustumCulled = false;
  coins.frustumCulled = false;
  group.add(hull, coins);
  const dummy = new THREE.Object3D();
  return {
    gold,
    // Pose la pièce `index` : x, y (son milieu), z, taille (0 pour la cacher), tour sur elle-même, écrasement
    place(index, x, y, z, zoom, spin = 0, squash = 0) {
      const shown = Math.max(zoom, 0.001);
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, spin, 0);
      dummy.scale.set(COIN_WIDE * shown * (1 + 0.2 * squash), COIN_HIGH * shown * (1 - 0.4 * squash), COIN_WIDE * shown * (1 + 0.2 * squash));
      dummy.updateMatrix();
      coins.setMatrixAt(index, dummy.matrix);
      dummy.scale.set(dummy.scale.x + 0.035 * shown, dummy.scale.y + 0.035 * shown, dummy.scale.z + 0.035 * shown);
      dummy.updateMatrix();
      hull.setMatrixAt(index, dummy.matrix);
    },
    commit() {
      coins.instanceMatrix.needsUpdate = true;
      hull.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      box.dispose();
      gold.dispose();
      edge.dispose();
      coins.dispose();
      hull.dispose();
    },
  };
}

// --- Pièces tombées du ciel : sur chaque case du joueur, deux pièces tombent l'une sur l'autre ---

function tollDrop({ group, mesh, size, tiles, gradientMap }) {
  const coins = createCoins(group, tiles.length * 2, gradientMap);
  const FALL = 0.16;

  return {
    update(k) {
      const sink = clamp01((k - 0.86) / 0.14);
      let shine = 0;
      tiles.forEach((tile, i) => {
        const start = delayOf(i, tiles.length, 0.3);
        for (let n = 0; n < 2; n++) {
          const since = k - start - n * 0.13;
          const rest = tile.top + COIN_HIGH * (n + 0.5);
          let height = 0;
          if (since < FALL) height = (1 - (since / FALL) ** 2) * 3;                               // la chute
          else if (since < FALL + 0.1) height = Math.sin(((since - FALL) / 0.1) * Math.PI) * 0.16; // un rebond
          const squash = since >= FALL ? Math.max(0, 1 - (since - FALL) / 0.03) : 0;
          shine = Math.max(shine, squash);
          coins.place(i * 2 + n, tile.x, rest + height - sink * COIN_HIGH * 2.5, tile.z, since < 0 ? 0 : 1 - sink, since * 14 + n, squash);
        }
      });
      coins.commit();
      coins.gold.emissive.setScalar(0.35 * shine);
      mesh.scale.setScalar(size * (1 + 0.1 * bump(k, 0.5, 0.06)));
    },
    dispose() {
      coins.dispose();
    },
  };
}

// --- Ronde de pièces : des pièces tournent autour du pion, puis s'envolent chacune vers une case ---

const RING_GO = 0.48;   // les pièces quittent la ronde
const RING_LAND = 0.8;  // elles atterrissent

function tollRing({ group, mesh, size, top, ground, tiles, camera }) {
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.5, top.z);
  const count = Math.max(4, tiles.length);
  const items = Array.from({ length: count }, (_, i) => {
    const tile = tiles[i % tiles.length];
    const goal = new THREE.Vector3(tile.x, tile.top + 0.2, tile.z);
    return {
      coin: pixelSprite(group, centre, 11, 11, 41, PIXEL * 0.5),
      goal,
      // Une seule étiquette et un seul éclat par case, même si deux pièces s'y posent
      times: i < tiles.length ? pixelSprite(group, goal, TIMES_ART.width, TIMES_ART.height, 42, PIXEL * 0.38) : null,
      burst: i < tiles.length ? pixelSprite(group, goal, 15, 15, 40, PIXEL * 0.5) : null,
    };
  });
  const position = new THREE.Vector3();
  const from = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  return {
    update(k) {
      const flight = clamp01((k - RING_GO) / (RING_LAND - RING_GO));
      items.forEach(({ coin, goal, times, burst }, i) => {
        const angle = (k * 2.4 + i / count) * Math.PI * 2;
        from.set(centre.x + Math.cos(angle) * 0.36, centre.y, centre.z + Math.sin(angle) * 0.36);
        position.copy(from).lerp(goal, easeOut(flight));
        position.y += Math.sin(flight * Math.PI) * 1.1;
        coin.sprite.position.copy(position);
        // En ronde, la pièce passe derrière le pion ; en vol, elle reste visible
        coin.material.depthTest = flight === 0 && camera.position.distanceToSquared(position) > reach;
        coin.setZoom(Math.max(0.001, popIn(clamp01(k / 0.1))));
        if (flight >= 1) coin.show(null);
        else {
          const frame = (Math.floor(k * 40) + i) % COINS.length;
          coin.show(`coin${frame}`, COINS[frame], COIN);
        }
        if (!times) return;
        showBurst(burst, k, RING_LAND);
        // Le « ×2 » jaillit de la case à l'arrivée de la pièce, puis s'efface
        const shown = clamp01((k - RING_LAND) / 0.08);
        if (k < RING_LAND || k >= 0.98) times.show(null);
        else times.show('times', TIMES_ART, TIMES);
        times.sprite.position.set(goal.x, goal.y + 0.1 + 0.25 * easeOut(clamp01((k - RING_LAND) / 0.18)), goal.z);
        times.setZoom(Math.max(0.001, popIn(shown) * clamp01((1 - k) / 0.05)));
      });
      mesh.scale.setScalar(size * (1 + 0.1 * bump(k, RING_GO, 0.05)));
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

// --- « ×2 » frappés sur les cases : un « ×2 » tombe du ciel sur chaque case et s'y plante ---

function tollStamp({ group, mesh, size, tiles }) {
  const FALL = 0.18;
  const stamps = tiles.map((tile, i) => {
    const at = new THREE.Vector3(tile.x, tile.top, tile.z);
    const item = pixelSprite(group, at, TIMES_ART.width, TIMES_ART.height, 41, PIXEL * 0.5);
    item.sprite.center.set(0.5, 0);
    return { item, at, start: delayOf(i, tiles.length, 0.3) };
  });

  return {
    update(k) {
      const leave = clamp01((k - 0.88) / 0.12);
      for (const { item, at, start } of stamps) {
        const since = k - start;
        let height = 0;
        if (since < FALL) height = (1 - (since / FALL) ** 2) * 3.2;                                 // la chute
        else if (since < FALL + 0.24) height = Math.abs(Math.sin(((since - FALL) / 0.24) * Math.PI * 2)) * 0.14 * (1 - (since - FALL) / 0.24); // deux rebonds
        item.sprite.position.set(at.x, at.y + height, at.z);
        const squash = since >= FALL ? Math.max(0, 1 - (since - FALL) / 0.03) : 0;
        const zoom = 1 - leave;
        item.sprite.scale.set(item.size.x * zoom * (1 + 0.16 * squash), item.size.y * zoom * (1 - 0.25 * squash), 1);
        if (since < 0 || leave >= 1) item.show(null);
        else if (k >= 0.78 && k < 0.88) item.show('white', TIMES_ART, TIMES_WHITE);
        else item.show('times', TIMES_ART, TIMES);
      }
      mesh.scale.setScalar(size * (1 + 0.1 * bump(k, 0.5, 0.06)));
    },
    dispose() {
      for (const { item } of stamps) item.dispose();
    },
  };
}

// --- Piles qui doublent : une pile de deux pièces sort de chaque case, puis double d'un coup ---

const PILE = 4;          // pièces d'une pile doublée
const STACK_DOUBLE = 0.5; // la pile double

function tollStack({ group, mesh, size, tiles, gradientMap }) {
  const coins = createCoins(group, tiles.length * PILE, gradientMap);
  const twinkles = tiles.map(tile => pixelSprite(group, new THREE.Vector3(tile.x, tile.top + COIN_HIGH * PILE + 0.2, tile.z), TWINKLE.width, TWINKLE.height, 41, PIXEL * 0.7));

  return {
    update(k) {
      const sink = clamp01((k - 0.86) / 0.14);
      tiles.forEach((tile, i) => {
        const start = delayOf(i, tiles.length, 0.2);
        for (let n = 0; n < PILE; n++) {
          // Les deux premières pièces sortent de la case ; les deux autres apparaissent d'un coup
          const born = n < 2 ? clamp01((k - start - n * 0.05) / 0.1) : clamp01((k - STACK_DOUBLE - (n - 2) * 0.04) / 0.08);
          const y = tile.top + COIN_HIGH * (n + 0.5) - sink * COIN_HIGH * PILE * 1.2;
          coins.place(i * PILE + n, tile.x, y, tile.z, popIn(born) * (1 - sink), i + n * 0.4);
        }
        const since = k - STACK_DOUBLE - 0.06;
        if (since < 0 || since >= 0.16) twinkles[i].show(null);
        else twinkles[i].show('twinkle', TWINKLE, SPARK);
      });
      coins.commit();
      coins.gold.emissive.setScalar(0.6 * bump(k, STACK_DOUBLE + 0.03, 0.06));
      mesh.scale.setScalar(size * (1 + 0.12 * bump(k, STACK_DOUBLE + 0.03, 0.06)));
    },
    dispose() {
      coins.dispose();
      for (const item of twinkles) item.dispose();
    },
  };
}

const BUILDERS = { drop: tollDrop, ring: tollRing, stamp: tollStamp, stack: tollStack };

// Construit l'effet du Double Péage.
//   mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de
//   sa case ; tiles : centres { x, z, top } des cases du joueur ; camera : la caméra ;
//   gradientMap : dégradé de l'ombrage « toon ».
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildToll(style, { mesh, size, top, ground, tiles, camera, gradientMap }) {
  const group = new THREE.Group();
  // Sans case à lui, le joueur voit l'effet sur celle où il se tient, à côté de son pion
  const places = tiles.length > 0 ? tiles : [{ x: top.x + 0.3, z: top.z + 0.2, top: ground }];
  const toll = BUILDERS[style]({ group, mesh, size, top, ground, tiles: places, camera, gradientMap });
  return { group, update: k => toll.update(k), dispose: () => toll.dispose() };
}
