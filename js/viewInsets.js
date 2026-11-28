// Place que l'interface prend sur les bords du plateau. Sur téléphone, les fiches des joueurs, la
// main ou une fenêtre de décision recouvrent une partie de la vue 3D : on en déduit la zone restée
// libre, que la caméra vise et où les bandeaux se centrent. Module pur (des rectangles, pas de DOM).

const SIDES = ['top', 'right', 'bottom', 'left'];

// Un élément qui couvre au moins cette part de la largeur est un bandeau (haut ou bas) ;
// sinon c'est une colonne (gauche ou droite)
const BAND_SHARE = 0.6;

// box     rectangle du plateau { left, top, right, bottom }
// covers  éléments posés dessus : [{ rect, side }], side valant 'top', 'right', 'bottom', 'left'
//         ou 'auto' (bord déduit de la forme et de la position de l'élément)
// minFreeShare  part de la largeur et de la hauteur qui doit rester libre quoi qu'il arrive
// -> { top, right, bottom, left } en pixels
export function coveredInsets(box, covers, minFreeShare = 0.4) {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  if (width <= 0 || height <= 0) return insets;

  for (const { rect, side } of covers) {
    // Partie de l'élément qui recouvre réellement le plateau
    const left = Math.max(rect.left, box.left);
    const right = Math.min(rect.right, box.right);
    const top = Math.max(rect.top, box.top);
    const bottom = Math.min(rect.bottom, box.bottom);
    if (right <= left || bottom <= top) continue;

    let edge = side;
    if (!SIDES.includes(edge)) {
      if (right - left >= width * BAND_SHARE) edge = (top + bottom) / 2 < (box.top + box.bottom) / 2 ? 'top' : 'bottom';
      else edge = (left + right) / 2 < (box.left + box.right) / 2 ? 'left' : 'right';
    }
    if (edge === 'top') insets.top = Math.max(insets.top, bottom - box.top);
    else if (edge === 'bottom') insets.bottom = Math.max(insets.bottom, box.bottom - top);
    else if (edge === 'left') insets.left = Math.max(insets.left, right - box.left);
    else insets.right = Math.max(insets.right, box.right - left);
  }

  // Deux bords opposés ne prennent jamais plus que ce qui peut l'être : on les réduit ensemble
  const fit = (a, b, size) => {
    const over = (insets[a] + insets[b]) / (size * (1 - minFreeShare));
    if (over > 1) {
      insets[a] /= over;
      insets[b] /= over;
    }
  };
  fit('left', 'right', width);
  fit('top', 'bottom', height);
  return insets;
}
