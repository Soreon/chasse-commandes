// Image en pixel art d'un effet : une grille de points (pixelGrid.js) peinte dans une texture et
// montrée par une image toujours tournée vers l'écran, dont le dessin change au fil de l'animation.

import * as THREE from 'three';

export const PIXEL = 0.05; // côté d'un point du dessin, en unités de case
const TEXEL = 6;           // pixels de texture par point

export class PixelSprite {
  // width, height : taille de la grille, en points ; pixel : côté d'un point dans la scène
  constructor(width, height, pixel = PIXEL) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * TEXEL;
    this.canvas.height = height * TEXEL;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    // Dessinée par-dessus tout par défaut ; depthTest se rétablit pour passer derrière un pion
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false });
    this.sprite = new THREE.Sprite(this.material);
    this.size = { x: width * pixel, y: height * pixel };
    this.sprite.scale.set(this.size.x, this.size.y, 1);
    this.sprite.frustumCulled = false; // l'accroche peut être hors de l'écran alors que le dessin y est
    this.sprite.visible = false;
    this.shown = null;
  }

  // Affiche un dessin, ou rien (key null). `key` nomme l'image : la texture n'est repeinte que
  // s'il change. keep(x, y, code) permet de n'en garder qu'une partie.
  show(key, grid = null, palette = null, keep = null) {
    if (key === this.shown) return;
    this.shown = key;
    this.sprite.visible = key !== null;
    if (key === null) return;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const code = grid.cells[y * grid.width + x];
        if (code === 0 || (keep && !keep(x, y, code))) continue;
        ctx.fillStyle = palette[code];
        ctx.fillRect(x * TEXEL, y * TEXEL, TEXEL, TEXEL);
      }
    }
    this.texture.needsUpdate = true;
  }

  // Grossit ou rétrécit l'image (1 : taille normale)
  setZoom(zoom) {
    this.sprite.scale.set(this.size.x * zoom, this.size.y * zoom, 1);
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}

// Crée une image dans `group`, posée en `at`. order : ordre de dessin parmi les effets.
export function pixelSprite(group, at, width, height, order, pixel = PIXEL) {
  const item = new PixelSprite(width, height, pixel);
  item.sprite.position.copy(at);
  item.sprite.renderOrder = order;
  group.add(item.sprite);
  return item;
}
