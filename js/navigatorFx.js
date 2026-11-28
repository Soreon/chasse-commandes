// Navigateur : ce tour-ci, le joueur peut partir dans n'importe quelle direction. Une boussole en
// pixel art tombe du ciel sur la tête de son pion ; son aiguille s'affole, s'arrête, et quatre
// flèches filent sur le sol vers les cases voisines.
//
// buildNavigator(options) construit l'effet ; il se pilote par update(k), k allant de 0 à 1.
// L'appelant remet le pion à sa taille.

import * as THREE from 'three';
import { EDGE, createGrid, put, addEdge, gridFromRows } from './pixelGrid.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const clamp01 = v => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - (1 - t) ** 2;
const popIn = t => (t < 0.6 ? (t / 0.6) * 1.2 : 1.2 - 0.2 * ((t - 0.6) / 0.4));
// Bosse de 0 à 1 autour de l'instant `at`, large de `width` de chaque côté
const bump = (k, at, width) => Math.max(0, 1 - Math.abs(k - at) / width);

// Les quatre directions du plateau
const DIRECTIONS = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
const STEP = 1.1; // distance entre deux cases voisines

// Flèche pointée vers le haut (codes : 2 le bord, 3 l'intérieur)
export const ARROW_ART = gridFromRows([
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
const ARROW = { [EDGE]: INK, 2: GOLD, 3: '#fff3a0' };

// Boussole : boîtier doré, cadran clair, aiguille rouge et bleue ; `turn` (0 à 7) tourne l'aiguille
const COMPASS = { [EDGE]: INK, 2: GOLD, 3: '#fff8e0', 4: '#e23d3d', 5: '#3f6fe0', 6: '#c99a10' };
// Quand l'aiguille s'arrête : toute blanche, cernée d'or
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

const LAND = 0.22;       // la boussole touche la tête du pion
const FOUND = 0.6;       // l'aiguille s'arrête, les flèches partent
const DART_SPAN = 0.3;   // durée de la course des flèches
const LEAVE = 0.86;      // la boussole s'en va

// Flèche peinte à plat sur le sol (les pions passent dessus), pointée dans la direction `dir`
function groundArrow(group, dir) {
  const unit = 6;
  const canvas = document.createElement('canvas');
  canvas.width = ARROW_ART.width * unit;
  canvas.height = ARROW_ART.height * unit;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < ARROW_ART.height; y++) {
    for (let x = 0; x < ARROW_ART.width; x++) {
      const code = ARROW_ART.cells[y * ARROW_ART.width + x];
      if (code === 0) continue;
      ctx.fillStyle = ARROW[code];
      ctx.fillRect(x * unit, y * unit, unit, unit);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  const pixel = PIXEL * 0.75;
  const geometry = new THREE.PlaneGeometry(ARROW_ART.width * pixel, ARROW_ART.height * pixel);
  geometry.rotateX(-Math.PI / 2); // à plat : le haut du dessin regarde vers -z
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = Math.atan2(-dir.x, -dir.z);
  mesh.renderOrder = 38;
  mesh.visible = false;
  group.add(mesh);
  return {
    mesh,
    material,
    dir,
    dispose() {
      texture.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

// mesh : le pion ; size : son échelle ; top : sommet de sa tête ; ground : hauteur du dessus de sa case.
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildNavigator({ mesh, size, top, ground }) {
  const group = new THREE.Group();
  const compass = pixelSprite(group, top, 15, 15, 41, PIXEL * 0.6);
  compass.sprite.center.set(0.5, 0); // posée sur la tête
  const arrows = DIRECTIONS.map(dir => groundArrow(group, dir));

  return {
    group,
    update(k) {
      const since = k - LAND;
      const leave = clamp01((k - LEAVE) / (1 - LEAVE));
      let height = 0;
      if (since < 0) height = (1 - (k / LAND) ** 2) * 3.2;                       // la chute
      else if (since < 0.12) height = Math.sin((since / 0.12) * Math.PI) * 0.14; // un rebond
      compass.sprite.position.set(top.x, top.y + 0.02 + height, top.z);
      // Elle s'écrase un instant en touchant la tête
      const squash = since >= 0 ? Math.max(0, 1 - since / 0.03) : 0;
      const zoom = 1 - leave;
      compass.sprite.scale.set(compass.size.x * zoom * (1 + 0.14 * squash), compass.size.y * zoom * (1 - 0.22 * squash), 1);

      if (leave >= 1) {
        compass.show(null);
      } else if (k >= FOUND && k < FOUND + 0.07) {
        compass.show('white', COMPASSES[0], COMPASS_WHITE);
      } else {
        // L'aiguille tourne vite, ralentit, puis s'arrête vers le haut
        const spun = k < FOUND ? Math.floor(clamp01(since / (FOUND - LAND)) ** 0.55 * 24) % 8 : 0;
        compass.show(`compass${spun}`, COMPASSES[spun], COMPASS);
      }

      // Les flèches filent du pion vers les cases voisines, et s'effacent en arrivant
      const run = (k - FOUND) / DART_SPAN;
      for (const arrow of arrows) {
        arrow.mesh.visible = run > 0 && run < 1;
        if (!arrow.mesh.visible) continue;
        const reach = lerp(0.35, STEP + 0.15, easeOut(run));
        arrow.mesh.position.set(top.x + arrow.dir.x * reach, ground + 0.05, top.z + arrow.dir.z * reach);
        arrow.mesh.scale.setScalar(popIn(clamp01(run / 0.2)));
        arrow.material.opacity = clamp01((1 - run) / 0.25);
      }

      // Le pion s'écrase sous la boussole, puis sursaute quand elle trouve
      const hit = bump(k, LAND + 0.02, 0.04);
      const found = bump(k, FOUND + 0.03, 0.05);
      mesh.scale.set(size * (1 + 0.1 * hit), size * (1 - 0.16 * hit + 0.1 * found), size * (1 + 0.1 * hit));
    },
    dispose() {
      compass.dispose();
      for (const arrow of arrows) arrow.dispose();
    },
  };
}
