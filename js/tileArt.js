// Les petites images de cases (pixel art, 7 × 7) ne sont plus collées sur les cubes : elles
// servent de modèle. On lit leurs pixels pour en tirer la couleur du cube et son dessin, que la
// vue 3D sculpte ensuite en relief.
//
// Lecture d'une image :
//   - l'anneau extérieur est le cadre : sa colonne de gauche donne la teinte du cube,
//     sa ligne du haut (les reflets) celle du rebord ;
//   - l'intérieur est le dessin : la couleur la plus présente sur son pourtour est le fond,
//     les autres couleurs forment le motif, les pixels transparents un emplacement en creux
//     (là où apparaît la couleur du propriétaire d'une case commande).

const MAX_ART_SIZE = 32;      // au-delà, ce n'est plus du pixel art exploitable
const SAME_COLOR_DISTANCE = 60;

const cache = new Map();

// Promesse du modèle d'une image (null si elle est illisible), mise en cache par chemin
export function loadTileArt(path) {
  if (!cache.has(path)) {
    cache.set(path, readPixels(path).then(analyzeTileArt).catch(() => null));
  }
  return cache.get(path);
}

function readPixels(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      resolve({ size, data: ctx.getImageData(0, 0, size, size).data });
    };
    img.onerror = reject;
    img.src = path;
  });
}

const toHex = ([r, g, b]) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

function average(colors) {
  const sum = [0, 0, 0];
  for (const c of colors) {
    sum[0] += c[0];
    sum[1] += c[1];
    sum[2] += c[2];
  }
  return sum.map(v => v / Math.max(1, colors.length));
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// { size, data } (pixels RGBA à la suite) -> modèle de la case :
// { size, body, rim, motif, cells: [{ x, y, kind: 'rim' | 'bg' | 'motif' | 'slot', color }] }
// Les couleurs sont des entiers 0xRRGGBB ; `motif` est la couleur principale du motif, ou null
// s'il n'y en a pas. Retourne null si l'image ne convient pas.
export function analyzeTileArt({ size, data }) {
  if (size < 5 || size > MAX_ART_SIZE) return null;

  const pixel = (x, y) => {
    const i = (y * size + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const last = size - 1;
  const opaque = list => list.filter(p => p[3] >= 128);

  // Cadre : teinte du cube (colonne de gauche) et du rebord (ligne du haut)
  const left = [];
  const top = [];
  for (let i = 1; i < last; i++) {
    left.push(pixel(0, i));
    top.push(pixel(i, 0));
  }
  if (opaque(left).length === 0 || opaque(top).length === 0) return null;
  const body = toHex(average(opaque(left)));
  const rim = toHex(average(opaque(top)));

  // Intérieur : regrouper les couleurs proches
  const clusters = []; // { colors: [], onBorder, cells: [] }
  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onRim = x === 0 || y === 0 || x === last || y === last;
      if (onRim) {
        cells.push({ x, y, kind: 'rim', color: rim });
        continue;
      }
      const p = pixel(x, y);
      if (p[3] < 128) {
        cells.push({ x, y, kind: 'slot', color: 0xf4f4f4 });
        continue;
      }
      let cluster = clusters.find(c => distance(average(c.colors), p) < SAME_COLOR_DISTANCE);
      if (!cluster) {
        cluster = { colors: [], onBorder: 0, cells: [] };
        clusters.push(cluster);
      }
      cluster.colors.push(p);
      if (x === 1 || y === 1 || x === last - 1 || y === last - 1) cluster.onBorder++;
      const cell = { x, y, kind: 'motif', color: 0 };
      cluster.cells.push(cell);
      cells.push(cell);
    }
  }

  // Le fond est la couleur la plus présente sur le pourtour du dessin
  const background = [...clusters].sort((a, b) => (b.onBorder - a.onBorder) || (b.cells.length - a.cells.length))[0];
  for (const cluster of clusters) {
    const color = toHex(average(cluster.colors));
    for (const cell of cluster.cells) {
      cell.color = color;
      if (cluster === background) cell.kind = 'bg';
    }
  }

  // Couleur du motif : celle qui y occupe le plus de pixels (null s'il n'y a pas de motif)
  const main = clusters.filter(c => c !== background).sort((a, b) => b.cells.length - a.cells.length)[0];
  const motif = main ? toHex(average(main.colors)) : null;

  return { size, body, rim, motif, cells };
}
