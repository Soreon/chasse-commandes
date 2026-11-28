// Pièce d'or en pixel art, qui tourne sur elle-même : quatre images (de face, de trois quarts,
// sur la tranche, de trois quarts). Sans dépendance ; les effets la montrent avec pixelSprite.js.

import { EDGE, createGrid, put, addEdge } from './pixelGrid.js';

export const COIN_PALETTE = { [EDGE]: '#0b0b1c', 2: '#ffd21f', 3: '#fff3a0', 4: '#c99a10' };
export const COIN_SIZE = 11; // côté de la grille, en points

// half : demi-largeur de la pièce, selon qu'on la voit de face (4) ou sur la tranche (1)
function coinGrid(half) {
  const centre = 5;
  const grid = createGrid(COIN_SIZE, COIN_SIZE);
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

export const COIN_FRAMES = [4, 3, 1, 3].map(coinGrid);
