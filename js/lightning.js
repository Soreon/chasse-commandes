// Foudre du Stun : une salve d'éclairs en pixel art tombe du ciel sur le pion visé.
//
// Trois éclairs fins frappent tour à tour sa case, autour de lui, puis un gros tombe sur sa tête.
// buildLightning(options) construit la salve ; elle se pilote par update(t), t allant de 0 à 1
// sur la durée de la frappe. update rend la lueur de l'instant (de 0 à 1) : le moteur de rendu
// s'en sert pour illuminer la scène et le pion.
//
// Les dessins sont des images toujours tournées vers l'écran, accrochées par le bas au point
// frappé : un éclair monte donc droit vers le haut de l'écran, quelle que soit l'inclinaison de
// la caméra.

import * as THREE from 'three';
import { boltGrid, burstGrid, BURST_STAGES, EDGE, RIM, CORE } from './lightningArt.js';

const PIXEL = 0.05;  // côté d'un point du dessin, en unités de case
const TEXEL = 6;     // pixels de texture par point

const INK = '#0b0b1c';
const GOLD = '#ffd21f';
const BOLT = { [EDGE]: INK, [RIM]: GOLD, [CORE]: '#fffbe6' };
// Première image d'une frappe : l'éclair tout blanc, cerné d'or
const BOLT_FLASH = { [EDGE]: GOLD, [RIM]: '#ffffff', [CORE]: '#ffffff' };

const THIN_BOLT = { width: 31, height: 110, thick: 2, forks: 1 };
const BIG_BOLT = { width: 41, height: 120, thick: 3, forks: 2 };
const BURSTS = Array.from({ length: BURST_STAGES }, (_, stage) => burstGrid(stage));

// Déroulé d'un éclair, en temps comptés depuis son départ : [fin de l'image, aspect, éclat, lueur].
// Aspects : 'flash' (tout blanc), 'bolt' (normal), 'fade' (un point sur deux, il s'éteint), null
// (rien). Éclat : image de l'éclat d'impact, de 0 à 3 ; -1 pour aucun.
const SMALL_SCRIPT = [
  [0, null, -1, 0],
  [0.06, 'flash', 0, 0.25],
  [0.13, 'bolt', 1, 0.1],
  [0.20, null, 2, 0],
  [0.27, null, 3, 0],
  [Infinity, null, -1, 0],
];
// Le dernier, sur la tête : il frappe, s'éteint, puis frappe une seconde fois
const FINAL_SCRIPT = [
  [0, null, -1, 0],
  [0.05, 'flash', 0, 1],
  [0.10, 'flash', 1, 1],
  [0.20, 'bolt', 2, 0.35],
  [0.26, null, 3, 0],
  [0.34, 'flash', 1, 0.7],
  [0.42, 'fade', 2, 0],
  [Infinity, null, -1, 0],
];
const STARTS = [0, 0.16, 0.32, 0.52]; // départ de chaque éclair ; le dernier est le gros
const SPREAD = 0.36;                  // distance du pion à laquelle tombent les éclairs fins

// Image en cours d'un déroulé : la première ligne dont la fin (première colonne) dépasse t
const stepAt = (script, t) => script.find(step => t < step[0]) || script[script.length - 1];

// Image en pixel art dont le dessin change au fil de l'animation
class PixelSprite {
  constructor(width, height, pixel) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width * TEXEL;
    this.canvas.height = height * TEXEL;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.set(width * pixel, height * pixel, 1);
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

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}

function pixelSprite(group, at, width, height, order, pixel = PIXEL) {
  const item = new PixelSprite(width, height, pixel);
  item.sprite.position.copy(at);
  item.sprite.renderOrder = order;
  group.add(item.sprite);
  return item;
}

function showBolt(item, grid, look) {
  if (!look) {
    item.show(null);
  } else if (look === 'fade') {
    item.show(look, grid, BOLT, (x, y, code) => code !== EDGE && (x + y) % 2 === 0);
  } else {
    item.show(look, grid, look === 'flash' ? BOLT_FLASH : BOLT);
  }
}

function showBurst(item, stage) {
  if (stage < 0) item.show(null);
  else item.show(`burst${stage}`, BURSTS[stage], BOLT);
}

// Construit la foudre qui frappe un pion.
//   top : sommet de sa tête ; ground : hauteur du dessus de sa case ;
//   random : source de hasard, pour la forme des éclairs et l'endroit où tombent les fins.
// Retourne { group (à ajouter à la scène), update(t) -> lueur, dispose() }.
export function buildLightning({ top, ground, random = Math.random }) {
  const group = new THREE.Group();
  const turn = random() * Math.PI * 2;
  const strikes = STARTS.map((start, i) => {
    const last = i === STARTS.length - 1;
    const angle = turn + i * ((Math.PI * 2) / 3) + (random() - 0.5) * 0.6;
    const at = last ? top : new THREE.Vector3(top.x + Math.cos(angle) * SPREAD, ground, top.z + Math.sin(angle) * SPREAD);
    const shape = last ? BIG_BOLT : THIN_BOLT;
    // L'éclair est accroché par sa pointe au point frappé, l'éclat est centré dessus
    const bolt = pixelSprite(group, at, shape.width, shape.height, 41);
    bolt.sprite.center.set(0.5, 0);
    return {
      start,
      script: last ? FINAL_SCRIPT : SMALL_SCRIPT,
      grid: boltGrid(random, shape),
      bolt,
      burst: pixelSprite(group, at, 15, 15, 42, last ? PIXEL : PIXEL * 0.8),
    };
  });

  return {
    group,
    update(t) {
      let glow = 0;
      for (const strike of strikes) {
        const [, look, stage, light] = stepAt(strike.script, t - strike.start);
        showBolt(strike.bolt, strike.grid, look);
        showBurst(strike.burst, stage);
        glow = Math.max(glow, light);
      }
      return glow;
    },
    dispose() {
      for (const strike of strikes) {
        strike.bolt.dispose();
        strike.burst.dispose();
      }
    },
  };
}
