// Pion d'un joueur : un petit personnage en cubes, à la couleur du joueur.
//
// Une grosse tête, un corps, deux mains et deux pieds détachés. Il se tient debout sur la case
// (l'origine du groupe est entre ses pieds), respire doucement au repos, et balance pieds et
// mains quand il avance. Il regarde vers +z dans son repère.

import * as THREE from 'three';

// Dimensions en unités de case (une case fait 1 de côté) : [largeur, hauteur, profondeur]
const HEAD = [0.235, 0.21, 0.21];
const BODY = [0.19, 0.19, 0.135];
const HAND = [0.08, 0.08, 0.08];
const FOOT = [0.095, 0.08, 0.12];

const FOOT_X = 0.06;   // écart des pieds de part et d'autre de l'axe
const HAND_X = 0.17;   // les mains flottent de chaque côté du corps
const FOOT_Y = FOOT[1] / 2;
const BODY_Y = FOOT[1] + 0.015 + BODY[1] / 2;
const HEAD_Y = BODY_Y + BODY[1] / 2 + HEAD[1] / 2;
const HAND_Y = BODY_Y + 0.015;
const SWING = 0.07;    // amplitude du pas

// Hauteur du personnage, du sol au sommet de la tête
export const PAWN_HEIGHT = HEAD_Y + HEAD[1] / 2;

// color : couleur du joueur ; gradientMap : dégradé de l'ombrage « toon » ;
// box : géométrie d'un cube de côté 1, partagée (chaque partie n'en est qu'une mise à l'échelle).
// Retourne { group, pose(time, stride) }.
export function buildPawn({ color, gradientMap, box }) {
  const base = new THREE.Color(color);
  const skin = new THREE.MeshToonMaterial({ color: base, gradientMap });
  // Le corps un ton plus sombre, pour détacher la tête et les mains
  const shade = new THREE.MeshToonMaterial({ color: base.clone().multiplyScalar(0.8), gradientMap });

  const group = new THREE.Group();
  const part = (size, material, x, y) => {
    const mesh = new THREE.Mesh(box, material);
    mesh.scale.set(...size);
    mesh.position.set(x, y, 0);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const head = part(HEAD, skin, 0, HEAD_Y);
  const body = part(BODY, shade, 0, BODY_Y);
  const leftHand = part(HAND, skin, -HAND_X, HAND_Y);
  const rightHand = part(HAND, skin, HAND_X, HAND_Y);
  const leftFoot = part(FOOT, skin, -FOOT_X, FOOT_Y);
  const rightFoot = part(FOOT, skin, FOOT_X, FOOT_Y);

  // time : temps de la scène (décalé d'un pion à l'autre pour qu'ils ne respirent pas ensemble) ;
  // stride : de -1 à 1, position dans le pas (0 au repos). Un pied avance pendant que l'autre
  // recule, et les mains font l'inverse.
  const pose = (time, stride = 0) => {
    const breath = Math.sin(time * 2.4);
    body.position.y = BODY_Y + breath * 0.006;
    head.position.y = HEAD_Y + breath * 0.012;
    const sway = Math.sin(time * 2.4 + 0.9) * 0.012;
    leftHand.position.set(-HAND_X, HAND_Y + sway, -stride * SWING);
    rightHand.position.set(HAND_X, HAND_Y + sway, stride * SWING);
    // Le pied qui avance se soulève
    leftFoot.position.set(-FOOT_X, FOOT_Y + Math.max(0, stride) * 0.035, stride * SWING);
    rightFoot.position.set(FOOT_X, FOOT_Y + Math.max(0, -stride) * 0.035, -stride * SWING);
  };
  pose(0);
  return { group, pose };
}
