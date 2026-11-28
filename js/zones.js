// Zones de cases commande : identifiants et couleurs proposés par l'éditeur, et passage de la
// grille (chaque case commande porte sa zone) à la liste de zones lue par le jeu. Module pur.

export const ZONE_IDS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const ZONE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

// Grille -> [{ id, name, color, tiles: [[ligne, colonne], ...] }]
export function zoneDefsOf(grid) {
  const cellsByZone = {};
  grid.forEach((row, r) => row.forEach((cell, c) => {
    if (!cell || !cell.zone) return;
    if (!cellsByZone[cell.zone]) cellsByZone[cell.zone] = [];
    cellsByZone[cell.zone].push([r, c]);
  }));
  return Object.entries(cellsByZone).map(([id, tiles], i) => ({
    id,
    name: `Zone ${id}`,
    color: ZONE_COLORS[ZONE_IDS.indexOf(id)] || ZONE_COLORS[i % ZONE_COLORS.length],
    tiles,
  }));
}
