// Navigateur : ce tour-ci, le joueur peut partir dans n'importe quelle direction.
//
// Plusieurs mises en scène à l'essai (essais.html), à la place des quatre flèches surmontées d'un
// symbole de boussole. Chacune se construit avec buildNavigator(style, options) et se pilote par
// update(k), k allant de 0 à 1 sur la durée de l'effet. L'appelant remet le pion à sa taille.

import * as THREE from 'three';
import { EDGE, createGrid, put, addEdge, gridFromRows } from './pixelGrid.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

export const NAVIGATOR_STYLES = {
  drop: 'Boussole tombée du ciel',
  ring: 'Ronde de flèches',
  rose: 'Rose des vents',
  cubes: 'Flèches en cubes',
};

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const PALE = '#fff3a0';
const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - (1 - t) ** 2;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);

// Les quatre directions du plateau, dans l'ordre où l'on tourne
const DIRECTIONS = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
const STEP = 1.1; // distance entre deux cases voisines

// --- Dessins ---

// Flèche pointée vers le haut
const ARROW = { [EDGE]: INK, 2: GOLD, 3: PALE };
const ARROW_WHITE = { [EDGE]: GOLD, 2: '#ffffff', 3: '#ffffff' };
const ARROW_ART = gridFromRows([
  '....Y....',
  '...YWY...',
  '..YWWWY..',
  '.YWWWWWY.',
  'YYYWWWYYY',
  '..YWWWY..',
  '..YWWWY..',
  '..YWWWY..',
  '..YYYYY..',
], { Y: 2, W: 3 });

// Boussole : boîtier doré, cadran clair, aiguille rouge et bleue ; `turn` (0 à 7) tourne l'aiguille
const COMPASS = { [EDGE]: INK, 2: GOLD, 3: '#fff8e0', 4: '#e23d3d', 5: '#3f6fe0', 6: '#c99a10' };
const COMPASS_WHITE = { [EDGE]: GOLD, 2: '#ffffff', 3: '#ffffff', 4: '#ffffff', 5: '#ffffff', 6: '#ffffff' };
// Direction de la pointe rouge à chaque huitième de tour ; la bleue est à l'opposé
const NEEDLES = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
function compassGrid(turn) {
  const size = 15;
  const centre = 7;
  const grid = createGrid(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const reach = Math.hypot(x - centre, y - centre);
      if (reach <= 6.3) put(grid, x, y, reach > 4.9 ? (y > centre + 2 ? 6 : 2) : 3);
    }
  }
  const [dx, dy] = NEEDLES[turn];
  for (let r = 1; r <= (dx && dy ? 3 : 4); r++) {
    put(grid, centre + dx * r, centre + dy * r, 4);
    put(grid, centre - dx * r, centre - dy * r, 5);
  }
  grid.cells[centre * size + centre] = 2;
  return addEdge(grid);
}
const COMPASSES = NEEDLES.map((_, turn) => compassGrid(turn));

// Rose des vents, à plat : quatre grandes pointes bicolores, quatre petites, un cœur clair
const ROSE = { [EDGE]: INK, 2: GOLD, 3: PALE, 4: '#c99a10', 5: '#ffffff' };
function roseGrid() {
  const size = 25;
  const centre = 12;
  const grid = createGrid(size, size);
  // Pointe le long de (dx, dy), de longueur `length` et de demi-largeur `half` à sa base
  const point = (dx, dy, length, half, light, dark) => {
    for (let r = 1; r <= length; r++) {
      const wide = Math.round(half * (1 - r / (length + 1)));
      for (let s = -wide; s <= wide; s++) {
        // Côté de la pointe : perpendiculaire à sa direction
        put(grid, centre + dx * r - dy * s, centre + dy * r + dx * s, s < 0 ? light : (s > 0 ? dark : light));
      }
    }
  };
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) point(dx, dy, 11, 3, 3, 2);
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (let r = 1; r <= 5; r++) put(grid, centre + dx * r, centre + dy * r, 4);
  }
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) grid.cells[(centre + y) * size + centre + x] = 5;
  return addEdge(grid);
}

// Image à plat sur le sol (les pions passent dessus), dessin tourné vers -z
function flatImage(group, grid, palette, pixel) {
  const unit = 6;
  const canvas = document.createElement('canvas');
  canvas.width = grid.width * unit;
  canvas.height = grid.height * unit;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const code = grid.cells[y * grid.width + x];
      if (code === 0) continue;
      ctx.fillStyle = palette[code];
      ctx.fillRect(x * unit, y * unit, unit, unit);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  const geometry = new THREE.PlaneGeometry(grid.width * pixel, grid.height * pixel);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 38;
  mesh.visible = false;
  group.add(mesh);
  return {
    mesh,
    material,
    dispose() {
      texture.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

// Quatre flèches peintes sur le sol, qui filent du pion vers les cases voisines.
// update(u) : u de 0 à 1 sur la durée de leur course (rien en dehors).
function groundDarts(group, feet) {
  const darts = DIRECTIONS.map((dir) => {
    const image = flatImage(group, ARROW_ART, ARROW, PIXEL * 0.75);
    image.mesh.rotation.y = Math.atan2(-dir.x, -dir.z);
    return { image, dir };
  });
  return {
    update(u) {
      for (const { image, dir } of darts) {
        image.mesh.visible = u > 0 && u < 1;
        if (!image.mesh.visible) continue;
        const reach = lerp(0.35, STEP + 0.15, easeOut(u));
        image.mesh.position.set(feet.x + dir.x * reach, feet.y + 0.05, feet.z + dir.z * reach);
        image.mesh.scale.setScalar(popIn(clamp01(u / 0.2)));
        image.material.opacity = clamp01((1 - u) / 0.25);
      }
    },
    dispose() {
      for (const { image } of darts) image.dispose();
    },
  };
}

// --- Boussole tombée du ciel : elle se pose sur la tête du pion, son aiguille s'affole, puis
// quatre flèches filent sur le sol vers les cases voisines ---

const DROP_LAND = 0.22;
const DROP_FOUND = 0.6; // l'aiguille s'arrête, les flèches partent

function navigatorDrop({ group, mesh, size, top, ground }) {
  const feet = new THREE.Vector3(top.x, ground, top.z);
  const item = pixelSprite(group, top, 15, 15, 41, PIXEL * 0.6);
  item.sprite.center.set(0.5, 0);
  const darts = groundDarts(group, feet);

  return {
    update(k) {
      const since = k - DROP_LAND;
      const leave = clamp01((k - 0.86) / 0.14);
      let height = 0;
      if (since < 0) height = (1 - (k / DROP_LAND) ** 2) * 3.2;                  // la chute
      else if (since < 0.12) height = Math.sin((since / 0.12) * Math.PI) * 0.14; // un rebond
      item.sprite.position.set(top.x, top.y + 0.02 + height, top.z);
      const squash = since >= 0 ? Math.max(0, 1 - since / 0.03) : 0;
      const zoom = 1 - leave;
      item.sprite.scale.set(item.size.x * zoom * (1 + 0.14 * squash), item.size.y * zoom * (1 - 0.22 * squash), 1);

      if (leave >= 1) {
        item.show(null);
      } else if (k >= DROP_FOUND && k < DROP_FOUND + 0.07) {
        item.show('white', COMPASSES[0], COMPASS_WHITE);
      } else {
        // L'aiguille tourne vite, ralentit, puis s'arrête vers le haut
        const spun = k < DROP_FOUND ? Math.floor(clamp01(since / (DROP_FOUND - DROP_LAND)) ** 0.55 * 24) % 8 : 0;
        item.show(`compass${spun}`, COMPASSES[spun], COMPASS);
      }
      darts.update((k - DROP_FOUND) / 0.3);

      // Le pion s'écrase sous la boussole, puis sursaute quand elle trouve
      const hit = bump(k, DROP_LAND + 0.02, 0.04);
      const found = bump(k, DROP_FOUND + 0.03, 0.05);
      mesh.scale.set(size * (1 + 0.1 * hit), size * (1 - 0.16 * hit + 0.1 * found), size * (1 + 0.1 * hit));
    },
    dispose() {
      item.dispose();
      darts.dispose();
    },
  };
}

// --- Ronde de flèches : quatre flèches tournent autour du pion en passant derrière lui, puis
// s'élancent chacune dans une direction ---

const RING_GO = 0.66; // les flèches s'élancent

function navigatorRing({ group, mesh, size, top, ground, camera }) {
  const centre = new THREE.Vector3(top.x, ground + (top.y - ground) * 0.5, top.z);
  const arrows = DIRECTIONS.map(() => pixelSprite(group, centre, ARROW_ART.width, ARROW_ART.height, 41, PIXEL * 0.55));
  const position = new THREE.Vector3();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);
  // Deux tours, à la fin desquels chaque flèche est en face de sa direction
  const START = -Math.PI * 4;

  return {
    update(k) {
      const turning = clamp01(k / RING_GO);
      const gone = clamp01((k - RING_GO) / 0.28);
      arrows.forEach((item, i) => {
        if (gone >= 1) {
          item.show(null);
          return;
        }
        const angle = START * (1 - easeOut(turning)) + (i * Math.PI) / 2;
        const radius = 0.36 + easeOut(gone) * (STEP - 0.1);
        position.set(centre.x + Math.cos(angle) * radius, centre.y, centre.z + Math.sin(angle) * radius);
        item.sprite.position.copy(position);
        // Derrière le pion, la flèche est cachée par lui
        item.material.depthTest = gone === 0 && camera.position.distanceToSquared(position) > reach;
        // À l'écran, elle pointe vers l'extérieur de la ronde
        from.copy(centre).project(camera);
        to.copy(position).project(camera);
        item.material.rotation = Math.atan2(to.y - from.y, (to.x - from.x) * camera.aspect) - Math.PI / 2;
        item.setZoom(Math.max(0.001, popIn(clamp01(k / 0.12)) * (1 - gone * gone)));
        if (k >= RING_GO - 0.06 && k < RING_GO + 0.04) item.show('white', ARROW_ART, ARROW_WHITE);
        else item.show('arrow', ARROW_ART, ARROW);
      });
      mesh.scale.setScalar(size * (1 + 0.12 * bump(k, RING_GO, 0.06)));
    },
    dispose() {
      for (const item of arrows) item.dispose();
    },
  };
}

// --- Rose des vents : elle grandit en tournant sous le pion, s'aligne sur le plateau, et lance
// quatre flèches vers les cases voisines ---

const ROSE_SET = 0.5; // la rose est alignée

function navigatorRose({ group, mesh, size, top, ground }) {
  const feet = new THREE.Vector3(top.x, ground, top.z);
  const rose = flatImage(group, roseGrid(), ROSE, PIXEL * 1.1);
  rose.mesh.position.set(feet.x, ground + 0.045, feet.z);
  const darts = groundDarts(group, feet);

  return {
    update(k) {
      const grown = clamp01(k / ROSE_SET);
      rose.mesh.visible = k < 1;
      rose.mesh.rotation.y = (1 - easeOut(grown)) * Math.PI * 2.5;
      rose.mesh.scale.setScalar(Math.max(0.001, popIn(clamp01(k / 0.3)) * (1 + 0.08 * bump(k, ROSE_SET + 0.03, 0.05))));
      rose.material.opacity = clamp01((1 - k) / 0.14);
      darts.update((k - ROSE_SET - 0.04) / 0.32);
      // Le pion sautille pendant qu'elle tourne, et sursaute quand elle s'aligne
      const beat = k < ROSE_SET ? Math.abs(Math.sin(k * 22)) * 0.05 : 0;
      mesh.scale.set(size * (1 - beat), size * (1 + beat + 0.12 * bump(k, ROSE_SET + 0.03, 0.05)), size * (1 - beat));
    },
    dispose() {
      rose.dispose();
      darts.dispose();
    },
  };
}

// --- Flèches en cubes : quatre flèches en petits cubes sortent de sous le pion et bondissent
// jusqu'aux cases voisines ---

const CUBE = 0.075;
// Cubes d'une flèche : [vers l'avant, de côté], en nombre de cubes depuis son milieu
const ARROW_CUBES = [
  [-2, 0], [-1, 0], [0, 0],                     // la hampe
  [1, -2], [1, -1], [1, 0], [1, 1], [1, 2],     // la tête, large à sa base…
  [2, -1], [2, 0], [2, 1],                      // … puis plus étroite…
  [3, 0],                                       // … jusqu'à la pointe
];

function navigatorCubes({ group, mesh, size, top, ground, gradientMap }) {
  const feet = new THREE.Vector3(top.x, ground, top.z);
  const total = DIRECTIONS.length * ARROW_CUBES.length;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const gold = new THREE.MeshToonMaterial({ color: GOLD, gradientMap });
  const edge = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  const hull = new THREE.InstancedMesh(box, edge, total); // contour : l'envers de cubes plus grands
  const cubes = new THREE.InstancedMesh(box, gold, total);
  cubes.castShadow = true;
  hull.frustumCulled = false;
  cubes.frustumCulled = false;
  group.add(hull, cubes);
  const dummy = new THREE.Object3D();

  return {
    update(k) {
      // Elles sortent, bondissent jusqu'à la case voisine, y rebondissent, puis s'enfoncent
      const out = popIn(clamp01(k / 0.14));
      const leap = clamp01((k - 0.14) / 0.36);
      const hop = clamp01((k - 0.5) / 0.2);
      const sink = clamp01((k - 0.84) / 0.16);
      const reach = 0.32 + easeOut(leap) * (STEP - 0.32) + hop * 0.12;
      const height = Math.sin(leap * Math.PI) * 0.5 + Math.sin(hop * Math.PI) * 0.16;
      const squash = Math.max(bump(k, 0.51, 0.025), bump(k, 0.71, 0.025));
      gold.emissive.setScalar(0.5 * Math.max(bump(k, 0.51, 0.04), bump(k, 0.71, 0.04)));
      DIRECTIONS.forEach((dir, a) => {
        ARROW_CUBES.forEach(([ahead, aside], c) => {
          const along = reach + ahead * CUBE;
          dummy.position.set(
            feet.x + dir.x * along - dir.z * aside * CUBE,
            ground + CUBE / 2 + height - sink * CUBE * 1.2,
            feet.z + dir.z * along + dir.x * aside * CUBE,
          );
          const zoom = Math.max(0.001, out * (1 - sink));
          dummy.scale.set(zoom * CUBE, zoom * CUBE * (1 - 0.35 * squash), zoom * CUBE);
          dummy.updateMatrix();
          const index = a * ARROW_CUBES.length + c;
          cubes.setMatrixAt(index, dummy.matrix);
          dummy.scale.multiplyScalar(1.2);
          dummy.updateMatrix();
          hull.setMatrixAt(index, dummy.matrix);
        });
      });
      cubes.instanceMatrix.needsUpdate = true;
      hull.instanceMatrix.needsUpdate = true;
      // Le pion sursaute quand elles jaillissent
      const start = bump(k, 0.06, 0.06);
      mesh.scale.set(size * (1 - 0.08 * start), size * (1 + 0.14 * start), size * (1 - 0.08 * start));
    },
    dispose() {
      box.dispose();
      gold.dispose();
      edge.dispose();
      cubes.dispose();
      hull.dispose();
    },
  };
}

const BUILDERS = { drop: navigatorDrop, ring: navigatorRing, rose: navigatorRose, cubes: navigatorCubes };

// Construit l'effet du Navigateur sur un pion.
//   mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de
//   sa case ; camera : la caméra ; gradientMap : dégradé de l'ombrage « toon ».
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildNavigator(style, { mesh, size, top, ground, camera, gradientMap }) {
  const group = new THREE.Group();
  const navigator = BUILDERS[style]({ group, mesh, size, top, ground, camera, gradientMap });
  return { group, update: k => navigator.update(k), dispose: () => navigator.dispose() };
}
