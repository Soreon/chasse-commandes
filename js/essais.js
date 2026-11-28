// Banc d'essai (essais.html) : montre les dessins proposés pour un effet, à côté du dessin actuel,
// sans avoir à lancer une partie ni à attendre que l'effet soit joué. L'effet à l'essai est
// décrit par TRIAL, plus bas ; en ce moment : les dés du Double Dé et du Triple Dé.
//
// Chaque vue est la vraie vue 3D du jeu (Renderer3D) sur un vrai plateau. Seule la partie est
// factice : un joueur attend seul sur une case, et l'effet s'y joue.
//   - Grand écran : une vue par dessin, côte à côte.
//   - Petit écran (téléphone) : une seule vue, et un onglet par dessin. Plusieurs vues 3D seraient
//     trop lourdes, et un doigt posé sur une vue déplace sa caméra au lieu de faire défiler la page.
// Page provisoire, à retirer quand tous les effets auront leur dessin.

import { Game } from './engine/game.js';
import { TileType } from './engine/board.js';
import { PLAYER_COLORS } from './engine/player.js';
import { TIMING } from './controller.js';
import { Renderer3D } from './renderer3dThree.js';
import { DICE_STYLES } from './diceFx.js';

const OTHER = 0;   // le joueur dont c'est le tour, resté sur la case Départ
const SUBJECT = 1; // celui sur qui l'effet se joue, seul sur sa case

// L'effet à l'essai
const TRIAL = {
  title: 'Double Dé et Triple Dé',
  type: 'dice', // type d'effet, pour Renderer3D.setFxStyle
  // Les dessins montrés : l'actuel ('classic'), puis les propositions, numérotées
  names: { classic: 'Symboles de dés', ...DICE_STYLES },
  short: { classic: 'Actuel', burst: 'Jet', rain: 'Ciel', pixel: 'Pixel', split: 'Dédoublé' }, // onglets
  notes: {
    classic: 'Le dessin actuel : des symboles de dé tournent et rebondissent au-dessus du joueur.',
    burst: 'De vrais dés en volume sortent du pion, montent en tournoyant et rebondissent en l’air.',
    rain: 'Les dés tombent du ciel, rebondissent sur la case autour du pion, puis sautent vers lui.',
    pixel: 'Des dés dessinés, animés image par image, culbutent au-dessus du pion et scintillent.',
    split: 'Un gros dé tourne au-dessus du pion, tremble, puis éclate en deux ou trois dés.',
  },
  // Variante de l'effet, choisie dans la barre
  option: { label: 'Main', values: { 2: 'Double Dé', 3: 'Triple Dé' }, initial: '2' },
  // Mise en place de la partie factice, avant l'affichage
  prepare() {},
  // L'effet tel que le moteur le décrit, et le joueur qui joue la main
  fx: option => ({ type: 'dice', count: Number(option) }),
  playerId: SUBJECT,
};

const STYLES = Object.keys(TRIAL.names);
// « Actuel » pour le dessin en place, un numéro pour chaque proposition
const numberOf = style => (style === 'classic' ? 'Actuel' : String(STYLES.indexOf(style)));

const PLAYERS = ['Autre', 'Joueur'].map((name, i) => ({ name, isHuman: false, color: PLAYER_COLORS[i] }));
const SKY_SHARE = 0.4; // part du haut de la vue laissée au ciel : le pion est cadré dessous
const SMALL_SCREEN = window.matchMedia('(max-width: 900px), (max-height: 500px)');

// Réglages de la barre. `ambiance` nomme un plateau (chacun des quatre a la sienne) ; `style` est
// le dessin montré sur petit écran ; `option` la variante de l'effet.
const state = { ambiance: 'Verger', speed: 1, mode: 'turns', style: STYLES[1], option: TRIAL.option.initial };

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const bench = document.getElementById('bench');
bench.style.setProperty('--count', STYLES.length);
document.title = `Banc d'essai - ${TRIAL.title}`;
document.querySelector('h1').textContent = TRIAL.title;

let boards = null;
let single = false;   // petit écran : seule la première vue sert, son dessin change avec l'onglet
let building = false;
let rebuild = false;  // l'écran a changé de taille pendant une construction : à refaire
let run = 0;          // numéro de la lecture en boucle : en changer arrête la précédente

const views = STYLES.map(() => {
  const el = document.createElement('section');
  el.className = 'view';
  el.innerHTML = '<header><h2><span class="num"></span><span class="name"></span></h2>'
    + '<button type="button">▶ Rejouer</button><p></p></header><div class="stage"></div>';
  bench.append(el);
  const view = { style: null, el, stage: el.querySelector('.stage'), renderer: null, playing: false };
  el.querySelector('button').addEventListener('click', () => play(view));
  new ResizeObserver(() => frame(view)).observe(view.stage);
  return view;
});

// Vues affichées : toutes, ou la première seulement
const shown = () => (single ? views.slice(0, 1) : views);

// Donne un dessin à une vue : titre, description, et dessin joué par sa vue 3D
function assign(view, style) {
  view.style = style;
  view.el.querySelector('.num').textContent = `${numberOf(style)} · `;
  view.el.querySelector('.name').textContent = TRIAL.names[style];
  view.el.querySelector('p').textContent = TRIAL.notes[style] || '';
  if (view.renderer) view.renderer.setFxStyle(TRIAL.type, style);
}

// Cadre le pion dans le bas de la vue : il reste du ciel au-dessus de lui pour voir l'effet
function frame(view) {
  if (!view.renderer) return;
  view.renderer.setViewInsets({ top: Math.round(view.stage.clientHeight * SKY_SHARE), right: 0, bottom: 0, left: 0 }, true);
}

// Case ordinaire la plus proche du milieu du plateau : le joueur y est seul, bien en vue
function quietTile(game, renderer) {
  const centers = Object.values(renderer.tileCenters);
  const mid = {
    x: centers.reduce((sum, c) => sum + c.x, 0) / centers.length,
    z: centers.reduce((sum, c) => sum + c.z, 0) / centers.length,
  };
  let best = game.startTileId;
  let bestGap = Infinity;
  for (const tile of Object.values(game.tiles)) {
    const center = renderer.tileCenters[tile.id];
    if (tile.type !== TileType.NORMAL || !center) continue;
    const gap = (center.x - mid.x) ** 2 + (center.z - mid.z) ** 2;
    if (gap < bestGap) {
      best = tile.id;
      bestGap = gap;
    }
  }
  return best;
}

async function buildView(view) {
  const game = new Game({ boardEntry: boards[state.ambiance], boardName: state.ambiance, players: PLAYERS, seed: 1 });
  const renderer = new Renderer3D();
  renderer.init(view.stage);
  renderer.setFxStyle(TRIAL.type, view.style);
  view.renderer = renderer;
  frame(view);
  await renderer.generateBoard(game.boardData);

  const subject = game.players[SUBJECT];
  subject.position = quietTile(game, renderer);
  TRIAL.prepare(game, subject, game.players[OTHER]);
  renderer.sync(game);
  renderer.focusTile(subject.position); // la caméra s'y pose et ne suit plus personne
}

// (Re)construit les vues sur le plateau de l'ambiance choisie, puis relance la lecture
async function build() {
  if (building) {
    rebuild = true;
    return;
  }
  building = true;
  run += 1;
  setEnabled('ambiance', false);
  single = SMALL_SCREEN.matches;
  document.body.classList.toggle('single', single);
  views.forEach((view, i) => {
    if (view.renderer) view.renderer.dispose();
    view.renderer = null;
    view.playing = false;
    view.el.classList.remove('playing');
    view.stage.replaceChildren();
    assign(view, single && i === 0 ? state.style : STYLES[i]);
  });
  try {
    await Promise.all(shown().map(buildView));
  } finally {
    building = false;
    setEnabled('ambiance', true);
  }
  if (rebuild) {
    rebuild = false;
    build();
  } else {
    loop();
  }
}

// Joue l'effet dans une vue ; la promesse se termine avec lui
function play(view) {
  const { renderer } = view;
  if (!renderer || building || view.playing) return Promise.resolve();
  view.playing = true;
  view.el.classList.add('playing');
  return renderer.playEffect(TRIAL.fx(state.option), TRIAL.playerId, TIMING.announce / state.speed).then(() => {
    if (view.renderer !== renderer) return; // vue reconstruite entre-temps
    view.playing = false;
    view.el.classList.remove('playing');
  });
}

// Lecture en boucle. Petit écran : le dessin de l'onglet, sans arrêt. Grand écran : selon le mode.
async function loop() {
  run += 1;
  const mine = run;
  const current = () => mine === run && !building;
  await pause(500);
  while (current()) {
    if (single) {
      await play(views[0]);
    } else if (state.mode === 'manual') {
      return;
    } else if (state.mode === 'together') {
      await Promise.all(views.map(play));
    } else {
      for (const view of views) {
        if (!current() || state.mode !== 'turns') break;
        await play(view);
        await pause(450);
      }
    }
    await pause(single ? 900 : 700);
  }
}

// --- Barre de réglages ---

function setEnabled(setting, enabled) {
  for (const button of document.querySelectorAll(`.seg[data-setting="${setting}"] button`)) button.disabled = !enabled;
}

function addButtons(setting, labels) {
  const group = document.querySelector(`.seg[data-setting="${setting}"]`);
  for (const [value, label] of Object.entries(labels)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.value = value;
    button.textContent = label;
    group.append(button);
  }
}

// Onglets des dessins (petit écran), et variantes de l'effet s'il en a
addButtons('style', Object.fromEntries(STYLES.map((style, i) => [style, style === 'classic' ? TRIAL.short[style] : `${i} ${TRIAL.short[style]}`])));
if (TRIAL.option) {
  document.getElementById('option-label').textContent = TRIAL.option.label;
  addButtons('option', TRIAL.option.values);
} else {
  document.getElementById('option-group').hidden = true;
}

const applied = {
  ambiance: build,
  mode: loop,
  speed() {},
  option() {}, // prise en compte à la prochaine lecture
  // Onglet d'un dessin (petit écran) : la vue le joue dès que l'effet en cours est fini
  style() {
    if (!single) return;
    assign(views[0], state.style);
    loop();
  },
};

for (const group of document.querySelectorAll('.seg')) {
  const { setting } = group.dataset;
  const mark = () => {
    for (const button of group.children) button.classList.toggle('active', button.dataset.value === String(state[setting]));
  };
  mark();
  group.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || button.dataset.value === String(state[setting])) return;
    state[setting] = setting === 'speed' ? Number(button.dataset.value) : button.dataset.value;
    mark();
    applied[setting]();
  });
}

// Téléphone tourné, fenêtre redimensionnée : on passe d'une vue à plusieurs, ou l'inverse
SMALL_SCREEN.addEventListener('change', () => {
  if (boards) build();
});

// --- Démarrage ---

try {
  const response = await fetch('boards.json');
  boards = await response.json();
  await build();
} catch (e) {
  console.error(e);
  const error = document.getElementById('error');
  error.textContent = 'Impossible de préparer les vues. Cette page doit être ouverte par le même serveur que le jeu (pas en double-cliquant sur le fichier).';
  error.hidden = false;
}
