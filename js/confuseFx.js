// Confusion : pendant trois tours, les adversaires partent au hasard aux intersections. Trois
// points d'interrogation en pixel art tournent autour de la tête de chacun et passent derrière
// elle, pendant que son pion vacille.
//
// buildConfuse(options) construit l'effet pour un pion visé ; il se pilote par update(k), k allant
// de 0 à 1. Il penche aussi le pion, que l'appelant redresse à la fin.

import * as THREE from 'three';
import { EDGE, gridFromRows } from './pixelGrid.js';
import { pixelSprite, PIXEL } from './pixelSprite.js';

// Le point d'interrogation, dans le rose de la Confusion
const MARK = { [EDGE]: '#0b0b1c', 2: '#ff5a7a', 3: '#ffb3c1' };
const MARK_ART = gridFromRows([
  '.LLLLP.',
  'LLPPPPP',
  'LP...PP',
  '.....PP',
  '....PPP',
  '...LPP.',
  '...LP..',
  '...LP..',
  '.......',
  '...LP..',
  '...PP..',
], { P: 2, L: 3 });

const COUNT = 3;      // points d'interrogation de la ronde
const RADIUS = 0.26;  // rayon de la ronde, en unités de case
const TURNS = 2.25;   // tours faits pendant l'effet

const clamp01 = v => Math.max(0, Math.min(1, v));

// mesh : le pion ; size : son échelle ; top : sommet de sa tête ; camera : la caméra (pour savoir
// ce qui passe derrière lui) ; index : rang du pion parmi les visés (ils ne bougent pas tous ensemble).
// Retourne { group (à ajouter à la scène), update(k), dispose() }.
export function buildConfuse({ mesh, size, top, camera, index = 0 }) {
  const group = new THREE.Group();
  // La ronde passe à hauteur du front, pas au-dessus de la tête
  const centre = new THREE.Vector3(top.x, top.y - 0.07 * size, top.z);
  const marks = Array.from({ length: COUNT }, () => pixelSprite(group, centre, MARK_ART.width, MARK_ART.height, 41, PIXEL * 0.42));
  const position = new THREE.Vector3();
  const reach = camera.position.distanceToSquared(centre);

  return {
    group,
    update(k) {
      const zoom = clamp01(Math.min(k / 0.12, (1 - k) / 0.12)); // ils grossissent, puis s'en vont
      marks.forEach((item, i) => {
        const angle = (k * TURNS + i / COUNT) * Math.PI * 2 + index;
        position.set(centre.x + Math.cos(angle) * RADIUS, centre.y + Math.sin(angle * 2) * 0.03, centre.z + Math.sin(angle) * RADIUS);
        item.sprite.position.copy(position);
        // Derrière la tête, le point d'interrogation est caché par elle
        item.material.depthTest = camera.position.distanceToSquared(position) > reach;
        item.material.rotation = Math.sin(k * 20 + i * 2) * 0.25; // il se dandine
        item.show('mark', MARK_ART, MARK);
        item.setZoom(Math.max(zoom, 0.001));
      });
      mesh.scale.setScalar(size);
      mesh.rotation.z = Math.sin(k * 42 + index) * 0.32 * (1 - k);
    },
    dispose() {
      for (const item of marks) item.dispose();
    },
  };
}
