// Grilles de points des dessins en pixel art des effets, sans dépendance (donc vérifiables hors
// navigateur). pixelSprite.js les peint dans des textures.
//
// Une grille : { width, height, cells }, où cells[y * width + x] vaut 0 (vide) ou un code de
// couleur, que la palette du dessin traduit. Le code 1 est toujours le liseré sombre.

export const EDGE = 1;

export function createGrid(width, height) {
  return { width, height, cells: new Uint8Array(width * height) };
}

// Pose un point s'il tombe dans la grille ; le code le plus fort l'emporte
export function put(grid, x, y, code) {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
  const i = y * grid.width + x;
  if (grid.cells[i] < code) grid.cells[i] = code;
}

// Carré de `size` points autour de (x, y)
export function dab(grid, x, y, size, code) {
  const start = -Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) put(grid, x + start + dx, y + start + dy, code);
  }
}

// Liseré : chaque point vide qui touche le dessin par un côté
export function addEdge(grid) {
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

// Dessin écrit à la main : une chaîne par rangée, un caractère par point (« . » pour le vide).
// `codes` donne le code de couleur de chaque caractère. Le dessin reçoit un point de marge tout
// autour, où vient son liseré.
export function gridFromRows(rows, codes) {
  const grid = createGrid(rows[0].length + 2, rows.length + 2);
  rows.forEach((row, y) => {
    if (row.length !== rows[0].length) throw new Error(`Rangée ${y} : ${row.length} points au lieu de ${rows[0].length}`);
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '.') continue;
      const code = codes[row[x]];
      if (!code || code === EDGE) throw new Error(`Rangée ${y} : caractère « ${row[x]} » sans couleur`);
      grid.cells[(y + 1) * grid.width + x + 1] = code;
    }
  });
  return addEdge(grid);
}
