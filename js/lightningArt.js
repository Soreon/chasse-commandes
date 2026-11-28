// Dessins en pixel art de la foudre du Stun : des grilles de points, sans dépendance (donc
// vérifiables hors navigateur). lightning.js les peint dans des textures.
//
// Une grille : { width, height, cells }, où cells[y * width + x] vaut 0 (vide) ou l'un des codes
// ci-dessous, que chaque palette traduit en couleur.

export const EDGE = 1;   // liseré sombre autour du dessin
export const RIM = 2;    // bord de l'éclair, corps du nuage
export const CORE = 3;   // cœur de l'éclair, reflet du nuage
export const SHADE = 4;  // dessous du nuage

function createGrid(width, height) {
  return { width, height, cells: new Uint8Array(width * height) };
}

// Pose un point s'il tombe dans la grille ; le code le plus fort l'emporte (le cœur sur le bord)
function put(grid, x, y, code) {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
  const i = y * grid.width + x;
  if (grid.cells[i] < code) grid.cells[i] = code;
}

// Carré de `size` points autour de (x, y)
function dab(grid, x, y, size, code) {
  const start = -Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) put(grid, x + start + dx, y + start + dy, code);
  }
}

// Liseré : chaque point vide qui touche le dessin par un côté
function addEdge(grid) {
  const { width, height, cells } = grid;
  const full = (x, y) => x >= 0 && y >= 0 && x < width && y < height && cells[y * width + x] > EDGE;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cells[y * width + x] !== 0) continue;
      if (full(x - 1, y) || full(x + 1, y) || full(x, y - 1) || full(x, y + 1)) cells[y * width + x] = EDGE;
    }
  }
  return grid;
}

// Éclair en zigzag qui traverse la grille de haut en bas ; sa pointe touche le milieu du bas.
// random : fonction qui rend un nombre dans [0, 1) ; thick : épaisseur du trait en points ;
// forks : nombre de ramifications ; stride : hauteur d'une diagonale, [mini, maxi].
export function boltGrid(random, { width, height, thick = 3, forks = 2, stride = [6, 11] }) {
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
    const rise = Math.min(y, pick(stride[0], stride[1]));
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

// Nuage d'orage à fond plat : des disques qui se chevauchent, un reflet sur le dessus, une ombre
// dessous. L'éclair sort du milieu de sa base.
export function cloudGrid() {
  const width = 29;
  const height = 14;
  const floor = 11; // dernière rangée pleine
  const puffs = [[6.5, 8.5, 4.2], [12.5, 5.8, 5.2], [19.5, 7, 4.4], [23.5, 9, 3.2], [9.5, 9, 3.5], [13.5, 9, 3.5], [17.5, 9, 3.5]];
  const grid = createGrid(width, height);
  for (let y = 1; y <= floor; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (puffs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r)) put(grid, x, y, RIM);
    }
  }
  const body = (x, y) => y >= 0 && grid.cells[y * width + x] !== 0;
  for (let y = 1; y <= floor; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!body(x, y)) continue;
      if (y >= floor - 1) grid.cells[y * width + x] = SHADE;
      else if (!body(x, y - 1)) grid.cells[y * width + x] = CORE;
    }
  }
  return addEdge(grid);
}
