// Liaison entre deux cases reliées : un rayon lumineux.
//
// Un trait fin et blanc dans un halo translucide qui respire, un embout sur chaque case, et des
// étincelles qui filent dans les deux sens. Le rayon passe à mi-hauteur des cases, sans ombre
// portée, et s'anime avec le temps de la scène.

import * as THREE from 'three';

const SPARK_SIZE = 0.75 / 7; // un peu moins qu'un mini-cube du décor

const CAP_COLOR = '#1f9fd6';
const HALO_COLOR = '#71dff8';
const CORE_COLOR = '#f2ffff';

// start, end : pied des faces en regard des deux cases reliées (Vector3, y = 0) ;
// height : hauteur des cases ; gradientMap : dégradé de l'ombrage « toon ».
// Retourne { group, update(time) } ; le groupe est à ajouter au plateau.
export function buildBeam({ start, end, height, gradientMap }) {
  const length = start.distanceTo(end);
  const y = height / 2;

  // Repère local : x court d'une case à l'autre, y monte
  const group = new THREE.Group();
  group.position.copy(start);
  group.rotation.y = Math.atan2(start.z - end.z, end.x - start.x);

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.055, 0.055),
    new THREE.MeshBasicMaterial({ color: CORE_COLOR }),
  );
  core.position.set(length / 2, y, 0);
  // Halo translucide : on voit le plateau à travers
  const haloMaterial = new THREE.MeshBasicMaterial({ color: HALO_COLOR, transparent: true, opacity: 0.3, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.BoxGeometry(length, 0.2, 0.2), haloMaterial);
  halo.position.copy(core.position);
  group.add(core, halo);

  // Embouts plaqués sur le flanc des deux cases
  const capGeometry = new THREE.BoxGeometry(0.06, 0.32, 0.32);
  const capMaterial = new THREE.MeshToonMaterial({ color: CAP_COLOR, gradientMap });
  for (const x of [0.03, length - 0.03]) {
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.position.set(x, y, 0);
    group.add(cap);
  }

  // Étincelles : d'autant plus nombreuses que la liaison est longue, une sur deux dans chaque sens
  const sparkGeometry = new THREE.BoxGeometry(SPARK_SIZE, SPARK_SIZE, SPARK_SIZE);
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const sparks = [];
  for (let n = 0; n < Math.max(2, Math.round(length / 1.1)); n++) {
    const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
    group.add(spark);
    sparks.push(spark);
  }

  const update = (time) => {
    const breath = Math.sin(time * 2.2);
    halo.scale.set(1, 1 + breath * 0.12, 1 + breath * 0.12);
    haloMaterial.opacity = 0.28 + breath * 0.07;
    sparks.forEach((spark, n) => {
      const u = (time * 0.35 + n / sparks.length) % 1;
      spark.position.set((n % 2 === 0 ? u : 1 - u) * length, y, 0);
      spark.rotation.set(time * 2 + n, time * 1.5, 0);
    });
  };
  update(0);
  return { group, update };
}
