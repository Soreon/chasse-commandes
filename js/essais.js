// Banc d'essai (essais.html) : montre les dessins proposés pour un effet, à côté du dessin actuel,
// sans avoir à lancer une partie ni à attendre que l'effet soit joué. L'effet à l'essai est
// décrit par TRIAL, plus bas ; en ce moment : le Double Péage.
//
// Chaque vue est la vraie vue 3D du jeu (Renderer3D) sur un vrai plateau. Seule la partie est
// factice : un joueur attend sur une case à l'écart, et l'effet s'y joue.
//   - Grand écran : une vue par dessin, côte à côte.
//   - Petit écran (téléphone) : une seule vue, et un onglet par dessin. Plusieurs vues 3D seraient
//     trop lourdes, et un doigt posé sur une vue déplace sa caméra au lieu de faire défiler la page.
// Page provisoire, à retirer quand tous les effets auront leur dessin.

import { Game } from './engine/game.js';
import { TileType } from './engine/board.js';
import { PLAYER_COLORS } from './engine/player.js';
import { TIMING } from './controller.js';
import { Renderer3D } from './renderer3dThree.js';
import { TOLL_STYLES } from './tollFx.js';

const OTHER = 0;   // le joueur dont c'est le tour, resté sur la case Départ
const SUBJECT = 1; // celui sur qui l'effet se joue, sur une case à l'écart

// L'effet à l'essai
const TRIAL = {
  title: 'Double Péage',
  type: 'doubleToll', // type d'effet, pour Renderer3D.setFxStyle
  // Les dessins montrés : l'actuel ('classic'), puis les propositions, numérotées
  names: { classic: '« ×2 » qui s’élèvent', ...TOLL_STYLES },
  short: { classic: 'Actuel', drop: 'Ciel', ring: 'Ronde', stamp: '×2', stack: 'Piles' }, // onglets
  notes: {
    classic: 'Le dessin actuel : un « ×2 » s’élève de chaque case du joueur, sous un symbole de sac d’or.',
    drop: 'Sur chaque case du joueur, deux pièces en volume tombent du ciel l’une sur l’autre.',
    ring: 'Des pièces tournent autour du pion, puis s’envolent chacune vers une case, où jaillit un « ×2 ».',
    stamp: 'Un gros « ×2 » tombe du ciel sur chaque case du joueur, y rebondit et s’y plante.',
    stack: 'Une pile de deux pièces sort de chaque case du joueur, puis double d’un coup.',
  },
  // Variante de l'effet, choisie dans la barre : { label, values, initial }, ou null
  option: null,
  // Joueurs de la partie factice : celui dont c'est le tour, puis ceux sur qui l'effet se joue
  players: ['Autre', 'Joueur'],
  // Mise en place de la partie factice, avant l'affichage. spot : la case à l'écart, où se trouve
  // déjà le joueur SUBJECT. Il possède les cases alentour et, comme en partie, porte déjà
  // l'étiquette « ×2 » quand l'effet se joue.
  prepare(game, spot, renderer) {
    // Pas la sienne : l'effet s'y jouerait sous son pion
    for (const tile of nearestTiles(game, renderer, spot, 6).filter(tile => tile.id !== spot)) {
      tile.owner = SUBJECT;
      tile.level = 1;
    }
    game.players[SUBJECT].doubleTollTurns = 5;
  },
  // L'effet tel que le moteur le décrit, et le joueur qui joue la main
  fx: (option, game) => ({ type: 'doubleToll', tileIds: game.tiles.filter(tile => tile.owner === SUBJECT).map(tile => tile.id) }),
  playerId: SUBJECT,
};

const STYLES = Object.keys(TRIAL.names);
// « Actuel » pour le dessin en place, un numéro pour chaque proposition
const numberOf = style => (style === 'classic' ? 'Actuel' : String(STYLES.indexOf(style)));

const PLAYERS = TRIAL.players.map((name, i) => ({ name, isHuman: false, color: PLAYER_COLORS[i] }));
const SKY_SHARE = 0.4; // part du haut de la vue laissée au ciel : le pion est cadré dessous
const SMALL_SCREEN = window.matchMedia('(max-width: 900px), (max-height: 500px)');

// Réglages de la barre. `ambiance` nomme un plateau (chacun des quatre a la sienne) ; `style` est
// le dessin montré sur petit écran ; `option` la variante de l'effet.
const state = { ambiance: 'Verger', speed: 1, mode: 'turns', style: STYLES[1], option: TRIAL.option ? TRIAL.option.initial : null };

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
  const view = { style: null, el, stage: el.querySelector('.stage'), renderer: null, game: null, playing: false };
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

// Cases ordinaires les plus proches d'une case (elle comprise), de la plus proche à la plus lointaine
function nearestTiles(game, renderer, tileId, count) {
  const from = renderer.tileCenters[tileId];
  const gap = (tile) => {
    const center = renderer.tileCenters[tile.id];
    return (center.x - from.x) ** 2 + (center.z - from.z) ** 2;
  };
  return Object.values(game.tiles)
    .filter(tile => tile.type === TileType.NORMAL && renderer.tileCenters[tile.id])
    .sort((a, b) => gap(a) - gap(b))
    .slice(0, count);
}

async function buildView(view) {
  const game = new Game({ boardEntry: boards[state.ambiance], boardName: state.ambiance, players: PLAYERS, seed: 1 });
  const renderer = new Renderer3D();
  renderer.init(view.stage);
  renderer.setFxStyle(TRIAL.type, view.style);
  view.renderer = renderer;
  frame(view);
  await renderer.generateBoard(game.boardData);

  const spot = quietTile(game, renderer);
  game.players[SUBJECT].position = spot;
  TRIAL.prepare(game, spot, renderer);
  view.game = game;
  renderer.sync(game);
  renderer.focusTile(spot); // la caméra s'y pose et ne suit plus personne
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
  return renderer.playEffect(TRIAL.fx(state.option, view.game), TRIAL.playerId, TIMING.announce / state.speed).then(() => {
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
