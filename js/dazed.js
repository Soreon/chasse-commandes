// Stun, après la foudre : le joueur frappé reste sonné. Une ronde d'étoiles en pixel art tourne
// autour de sa tête et passe derrière elle, pendant qu'il vacille.
//
// buildDazed(options) construit la ronde ; elle se pilote par update(t), t allant de 0 à 1 sur le
// temps qui suit la foudre. Elle penche aussi le pion, que l'appelant redresse à la fin.

import * as THREE from 'three';
import { EDGE, gridFromRows } from './pixelGrid.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

const GOLDEN = { [EDGE]: '#0b0b1c', 2: '#ffd21f', 3: '#fffbe6' };
const STAR_CODES = { Y: 2, W: 3 };
// L'étoile, et son scintillement (deux images de même taille)
const STARS = [
  [
    '....Y....',
    '....Y....',
    '...YWY...',
    'YYYYWYYYY',
    '.YYWWWYY.',
    '..YWWWY..',
    '..YYWYY..',
    '.YY...YY.',
    '.Y.....Y.',
  ],
  [
    '.........',
    '.........',
    '....Y....',
    '....Y....',
    '..YYWYY..',
    '....Y....',
    '....Y....',
    '.........',
    '.........',
  ],
].map(rows => gridFromRows(rows, STAR_CODES));

const COUNT = 4;      // étoiles de la ronde
const RADIUS = 0.24;  // rayon de la ronde, en unités de case
const TURNS = 2.25;   // tours faits pendant l'effet

const clamp01 = v => Math.max(0, Math.min(1, v));

// mesh : le pion ; size : son échelle ; top : sommet de sa tête ; camera : la caméra (pour savoir
// quelles étoiles passent derrière lui).
// Retourne { group (à ajouter à la scène), update(t), dispose() }.
export function buildDazed({ mesh, size, top, camera }) {
  const group = new THREE.Group();
  // La ronde passe à hauteur du front, pas au-dessus de la tête
  const centre = new THREE.Vector3(top.x, top.y - 0.07 * size, top.z);
  const stars = Array.from({ length: COUNT }, () => pixelSprite(group, centre, STARS[0].width, STARS[0].height, 41, PIXEL * 0.42));
  const position = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  return {
    group,
    update(t) {
      const zoom = clamp01(Math.min(t / 0.12, (1 - t) / 0.12)); // les étoiles grossissent, puis s'en vont
      stars.forEach((item, i) => {
        const angle = (t * TURNS + i / COUNT) * Math.PI * 2;
        position.set(centre.x + Math.cos(angle) * RADIUS, centre.y + Math.sin(angle * 2) * 0.025, centre.z + Math.sin(angle) * RADIUS);
        item.sprite.position.copy(position);
        // Derrière la tête, l'étoile est cachée par elle
        item.material.depthTest = camera.position.distanceToSquared(position) > reach;
        const frame = (Math.floor(t * 16) + i) % 3 === 0 ? 1 : 0; // elle scintille
        item.show(`star${frame}`, STARS[frame], GOLDEN);
        item.setZoom(Math.max(zoom, 0.001));
      });
      mesh.scale.setScalar(size);
      mesh.rotation.z = Math.sin(t * 26) * 0.3 * (1 - t);
    },
    dispose() {
      for (const item of stars) item.dispose();
    },
  };
}
