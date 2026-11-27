// Étiquettes en pixel art, dans le style du plateau.
//
// Le texte est écrit avec une police bitmap de 5 × 7 points, en capitales. Les émojis du texte
// sont remplacés par de petites icônes de 7 × 7 points : la taille des dessins du dessus des
// cases. Le tout est posé sur une plaque sombre à bord net, ou laissé nu avec un simple liseré
// (bg: null) pour les symboles des effets.
//
// pixelLabelGrid calcule la grille de points (sans navigateur, donc testable) ;
// pixelLabelCanvas la dessine, chaque point devenant un carré.

// Police : une ligne par caractère, 7 rangées de haut en bas
const GLYPHS = Object.fromEntries(Object.entries({
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '111 010 010 010 010 010 111',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 01010 01010 00100 00100',
  W: '10001 10001 10001 10101 10101 11011 10001',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110',
  1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11110 00001 00001 01110 00001 00001 11110',
  4: '00010 00110 01010 10010 11111 00010 00010',
  5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110',
  7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  '+': '00000 00100 00100 11111 00100 00100 00000',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '×': '00000 10001 01010 00100 01010 10001 00000',
  '?': '01110 10001 00001 00010 00100 00000 00100',
  '!': '1 1 1 1 1 0 1',
  '.': '0 0 0 0 0 0 1',
  ':': '0 0 1 0 1 0 0',
  '%': '11001 11010 00010 00100 01000 01011 10011',
  '/': '00001 00001 00010 00100 01000 10000 10000',
}).map(([char, rows]) => [char, rows.split(' ')]));

const GOLD = '#ffd21f';
const VARIANT = /\uFE0F/g;           // variante d'affichage d'un émoji : sans effet sur le dessin
const ACCENTS = /[\u0300-\u036f]/g;  // accents détachés des lettres par normalize('NFD')

// Icônes : 7 rangées de 7 points ; « . » est vide, chaque autre lettre renvoie à une couleur
const ICONS = Object.fromEntries(Object.entries({
  '🎲': ['PPPPPPP PYPPPYP PPPPPPP PPPYPPP PPPPPPP PYPPPYP PPPPPPP', { P: '#9a6bff', Y: GOLD }],
  '⚡': ['....YY. ...YY.. ..YY... .YYYYY. ...YY.. ..YY... .YY....', { Y: GOLD }],
  '❓': ['.RRRRR. RR...RR ....RR. ...RR.. ...RR.. ....... ...RR..', { R: '#ff5a7a' }],
  '🛡': ['BBBBBBB BLLLDDB BLLLDDB BLLLDDB BLLLDDB .BLLDB. ..BBB..', { B: '#1c4f9c', L: '#7cc0ff', D: '#3d86e0' }],
  '🦸': ['....... BBBBBBB BWWBWWB BWWBWWB BBBBBBB .BB.BB. .......', { B: '#2f7fe0', W: '#ffffff' }],
  '🦹': ['P.....P PP...PP PPPPPPP PYYPYYP PPYPYPP PPPPPPP .PP.PP.', { P: '#7a3fd0', Y: GOLD }],
  '🍯': ['.YYYYY. .DDDDD. OOYOOOO OOYYOOO OOOOOOO OOOOOOO .OOOOO.', { O: '#d9822b', Y: '#ffd84a', D: '#a85a1a' }],
  '🧭': ['.GGGGG. GWWRWWG GWWRWWG GWWKWWG GWWBWWG GWWBWWG .GGGGG.', { G: '#c9a227', W: '#f6f1dc', R: '#e23d3d', B: '#3d5be2', K: '#333344' }],
  '💰': ['..BBB.. ...D... ..BBB.. .BBYBB. BBYYYBB BBBYBBB .BBBBB.', { B: '#c4853f', D: '#7a4a1e', Y: GOLD }],
  '⭐': ['...Y... ...Y... YYYYYYY .YYYYY. ..YYY.. .YY.YY. .Y...Y.', { Y: GOLD }],
  '💫': ['...Y... ...Y... ..YWY.. YYWWWYY ..YWY.. ...Y... ...Y...', { Y: GOLD, W: '#fff9d6' }],
  '🃏': ['.WWWWW. .WRWWW. .WWWWW. .WWRWW. .WWWWW. .WWWRW. .WWWWW.', { W: '#f6f6fa', R: '#e23d3d' }],
  '🎰': ['RRRRRRR RWWWWWR RYWYWYR RWWWWWR RRRRRRR RDDDDDR RR...RR', { R: '#d83a3a', W: '#ffffff', Y: '#ffb400', D: '#7a1f1f' }],
  '🪙': ['..OOO.. .OYYYO. OYLYYYO OYLYYYO OYYYYYO .OYYYO. ..OOO..', { O: '#a86f00', Y: GOLD, L: '#fff6b0' }],
}).map(([key, [rows, colors]]) => [key.replace(VARIANT, ''), { rows: rows.split(' '), colors }]));
const ICON_KEYS = Object.keys(ICONS);

const PLAQUE = '#23234a';   // fond de la plaque
const OUTLINE = '#0b0b1c';  // bord de la plaque, liseré des icônes
const INK = '#ffffff';      // couleur du texte

// Éclaircit une couleur « #rrggbb » en la mêlant de blanc
function lighten(hex, amount) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `#${channels.map(c => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')).join('')}`;
}

// Découpe le texte en icônes, lettres et espaces. Les minuscules et les accents se ramènent
// aux capitales ; `unknown` reçoit les caractères sans dessin, qui sont ignorés.
function tokenize(text, unknown = []) {
  const items = [];
  let rest = text.replace(VARIANT, '');
  while (rest.length > 0) {
    const key = ICON_KEYS.find(icon => rest.startsWith(icon));
    if (key) {
      items.push({ rows: ICONS[key].rows, colors: ICONS[key].colors });
      rest = rest.slice(key.length);
      continue;
    }
    const char = String.fromCodePoint(rest.codePointAt(0));
    rest = rest.slice(char.length);
    if (char === ' ') {
      items.push({ space: true });
      continue;
    }
    const plain = char.normalize('NFD').replace(ACCENTS, '').toUpperCase();
    if (GLYPHS[plain]) items.push({ rows: GLYPHS[plain], colors: null });
    else unknown.push(char);
  }
  return items;
}

// Caractères du texte qui n'ont ni lettre ni icône (pour vérifier qu'une étiquette est complète)
export function unknownCharacters(text) {
  const unknown = [];
  tokenize(text, unknown);
  return unknown;
}

// Grille de points d'une étiquette : { width, height, pixels } où pixels[y][x] est une couleur
// « #rrggbb » ou null (vide). bg : fond de la plaque, ou null pour un dessin nu ; fg : couleur
// du texte.
export function pixelLabelGrid(text, { bg = PLAQUE, fg = INK } = {}) {
  // Mise en ligne : 1 point entre deux lettres, 2 autour d'une icône, 3 pour une espace
  const placed = [];
  let cursor = 0;
  let previous = null;
  for (const item of tokenize(text)) {
    if (item.space) {
      cursor += 3;
      previous = null;
      continue;
    }
    if (previous) cursor += previous.colors || item.colors ? 2 : 1;
    placed.push({ ...item, x: cursor });
    cursor += item.rows[0].length;
    previous = item;
  }

  // Plaque : bord de 1 point, marge de 2 sur les côtés et de 1 en haut et en bas.
  // Dessin nu : 1 point de marge pour le liseré.
  const originX = bg ? 3 : 1;
  const originY = bg ? 2 : 1;
  const width = cursor + 2 * originX;
  const height = 7 + 2 * originY;
  const pixels = Array.from({ length: height }, () => new Array(width).fill(null));
  const outlined = Array.from({ length: height }, () => new Array(width).fill(false));

  const highlight = bg ? lighten(bg, 0.14) : null;
  if (bg) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const edgeX = x === 0 || x === width - 1;
        const edgeY = y === 0 || y === height - 1;
        if (edgeX && edgeY) continue; // coins rognés
        // Un reflet sur la première rangée donne un peu de volume à la plaque
        pixels[y][x] = edgeX || edgeY ? OUTLINE : (y === 1 ? highlight : bg);
      }
    }
  }

  for (const item of placed) {
    item.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const mark = row[c];
        if (mark === '0' || mark === '.') continue;
        const x = originX + item.x + c;
        const y = originY + r;
        pixels[y][x] = item.colors ? item.colors[mark] : fg;
        // Liseré sombre autour des icônes ; autour du texte aussi quand il n'y a pas de plaque
        outlined[y][x] = Boolean(item.colors) || !bg;
      }
    });
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (outlined[y][x]) continue;
      const touches = outlined[y - 1]?.[x] || outlined[y + 1]?.[x] || outlined[y][x - 1] || outlined[y][x + 1];
      const free = bg ? pixels[y][x] === bg || pixels[y][x] === highlight : pixels[y][x] === null;
      if (touches && free) pixels[y][x] = OUTLINE;
    }
  }
  return { width, height, pixels };
}

// Dessine l'étiquette dans un canvas, chaque point devenant un carré de `scale` pixels
export function pixelLabelCanvas(text, options, scale = 8) {
  const grid = pixelLabelGrid(text, options);
  const canvas = document.createElement('canvas');
  canvas.width = grid.width * scale;
  canvas.height = grid.height * scale;
  const ctx = canvas.getContext('2d');
  grid.pixels.forEach((row, y) => row.forEach((color, x) => {
    if (!color) return;
    ctx.fillStyle = color;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }));
  return canvas;
}
