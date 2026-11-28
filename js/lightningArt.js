// Dessins en pixel art de la foudre du Stun : des grilles de points (voir pixelGrid.js), que
// lightning.js peint dans des textures.

import { EDGE, createGrid, put, dab, addEdge } from './pixelGrid.js';

export { EDGE };
export const RIM = 2;    // bord de l'éclair
export const CORE = 3;   // cœur de l'éclair

// Éclair en zigzag qui traverse la grille de haut en bas ; sa pointe touche le milieu du bas.
// random : fonction qui rend un nombre dans [0, 1) ; thick : épaisseur du trait en points ;
// forks : nombre de ramifications.
export function boltGrid(random, { width, height, thick = 3, forks = 2 }) {
  const grid = createGrid(width, height);
  const margin = thick + 2;
  const hold = x => Math.max(margin, Math.min(width - 1 - margin, x));
  const pick = (min, max) => min + Math.floor(random() * (max - min + 1));
  const centre = Math.floor((width - 1) / 2);

  // Ligne médiane, tracée de la pointe vers le ciel : trois points bien droits pour la pointe,
  // puis une diagonale, un décrochement à contresens sur la rangée du dessus, et ainsi de suite
  const line = [0, 1, 2].map(up => ({ x: centre, y: height - 1 - up }));
  const corners = [];
  let x = centre;
  let y = height - 3;
  let lean = random() < 0.5 ? -1 : 1;
  while (y > 0) {
    const rise = Math.min(y, pick(6, 11));
    // Jamais plus d'un point de côté par rangée : le trait resterait en morceaux
    const toX = hold(x + lean * Math.min(pick(3, 6), rise));
    for (let step = 1; step <= rise; step++) line.push({ x: Math.round(x + ((toX - x) * step) / rise), y: y - step });
    x = toX;
    y -= rise;
    if (y <= 0) break;
    corners.push({ x, y });

    const backX = hold(x - lean * pick(2, 5));
    const dir = Math.sign(backX - x);
    y -= 1;
    for (let cx = x; cx !== backX; cx += dir) line.push({ x: cx, y });
    line.push({ x: backX, y });
    x = backX;
    // L'éclair penche du côté de ses diagonales : on le ramène vers le milieu s'il s'en écarte
    if (x < width * 0.3) lean = 1;
    else if (x > width * 0.7) lean = -1;
    else if (random() < 0.35) lean = -lean;
  }

  // Le trait s'affine sur les dernières rangées, jusqu'à une pointe d'un seul point ; il est
  // plus fin aussi tout en haut, là où il naît dans le ciel
  const sizeAt = (row) => {
    const fromTip = height - 1 - row;
    if (fromTip < 2) return 1;
    return fromTip < 6 || row < 6 ? Math.min(thick, 2) : thick;
  };
  for (const p of line) dab(grid, p.x, p.y, sizeAt(p.y), RIM);
  for (const p of line) if (sizeAt(p.y) >= 2) put(grid, p.x, p.y, CORE);

  // Ramifications : de fins traits qui partent d'un coude et descendent vers l'extérieur
  const usable = corners.filter(c => c.y > height * 0.12 && c.y < height * 0.7);
  for (let n = 0; n < forks && usable.length > 0; n++) {
    const from = usable.splice(Math.floor(random() * usable.length), 1)[0];
    const side = from.x < centre ? -1 : 1;
    const length = pick(7, 13);
    let fx = from.x;
    let fy = from.y;
    for (let step = 0; step < length; step++) {
      fy += 1;
      if (step % 2 === 0) {
        put(grid, fx, fy, RIM); // les points se touchent par un côté, pas seulement par un coin
        fx += side;
      }
      put(grid, fx, fy, RIM);
    }
  }
  return addEdge(grid);
}

// Éclat d'impact : huit rayons qui s'écartent du point touché, en quatre images (stage 0 à 3)
const BURST_SPANS = [[0, 2], [2, 4], [4, 6], [6, 6]];
export const BURST_STAGES = BURST_SPANS.length;

export function burstGrid(stage, size = 15) {
  const grid = createGrid(size, size);
  const centre = (size - 1) / 2;
  const [from, to] = BURST_SPANS[stage];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      for (let r = from; r <= to; r++) {
        const reach = dx !== 0 && dy !== 0 ? Math.round(r * 0.7) : r; // les diagonales vont moins loin
        put(grid, centre + dx * reach, centre + dy * reach, r === to ? RIM : CORE);
      }
    }
  }
  if (stage === 0) dab(grid, centre, centre, 3, CORE);
  return addEdge(grid);
}
