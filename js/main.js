// Point d'entrée : écrans, barre d'état, fenêtres de décision. Les règles sont dans js/engine/,
// le rythme de la partie dans js/controller.js.

import { Game } from './engine/game.js';
import { randomSeed } from './engine/rng.js';
import { RULES } from './engine/config.js';
import { TILE_TYPE_NAMES, countOwnedInZone, countTilesInZone } from './engine/board.js';
import { CardType, CARD_TYPE_LABELS, getHandDef, selectCardsForHand } from './engine/cards.js';
import { PLAYER_COLORS, AI_NAMES } from './engine/player.js';
import { GameController, hasSavedGame, loadSavedGame, clearSavedGame } from './controller.js';
import { Renderer } from './renderer.js';
import { Renderer3D } from './renderer3dThree.js';
import { MapBuilder } from './mapBuilder.js';
import { escapeHtml, tileTooltipHTML, showTooltip, hideTooltip } from './tooltip.js';
import { SessionLog, hasStoredJournal, downloadStoredJournal } from './sessionLog.js';

const $ = id => document.getElementById(id);
const gp = n => n.toLocaleString('fr-FR');

const CARD_TYPE_IMAGES = {
  [CardType.ATTACK]: 'images/attackCard.png',
  [CardType.MAGIC]: 'images/magicCard.png',
  [CardType.MISC]: 'images/miscCard.png',
  [CardType.JOKER]: 'images/jokerCard.png',
};

const SPEEDS = [1, 2, 4];
const SETTINGS_KEY = 'chasseCommandes.reglages';
const MAX_LOG_ENTRIES = 80;

// Partie affichée : { id, game, controller, renderer2d, renderer3d, log, cancelAsk, pick, relabel }
let session = null;
let sessionCounter = 0;
let boardsData = {};

const builder = new MapBuilder();
let builderInitialized = false;

// === Réglages conservés d'une partie à l'autre ===

function loadSettings() {
  const defaults = { speed: 1, follow: true, scenery: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

const settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* stockage indisponible */ }
}

// === Écrans ===

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
}

function showMenu() {
  $('btn-resume').hidden = !hasSavedGame();
  $('btn-last-journal').hidden = !hasStoredJournal();
  showScreen('main-menu');
}

function populateBoardSelect() {
  const select = $('board-select');
  const previous = select.value;
  select.innerHTML = '';

  for (const name of Object.keys(MapBuilder.getCustomBoards())) {
    const opt = document.createElement('option');
    opt.value = `custom:${name}`;
    opt.textContent = `Perso : ${name}`;
    select.appendChild(opt);
  }
  for (const name of Object.keys(boardsData).reverse()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}

async function loadBoards() {
  try {
    const resp = await fetch('boards.json');
    boardsData = await resp.json();
    populateBoardSelect();
  } catch (e) {
    console.error('Erreur de chargement de boards.json :', e);
  }
}

$('btn-start').addEventListener('click', () => {
  populateBoardSelect();
  $('setup-error').hidden = true;
  showScreen('setup-screen');
});
$('btn-rules').addEventListener('click', () => showScreen('rules-screen'));
$('btn-builder').addEventListener('click', () => {
  if (!builderInitialized) {
    builder.init($('builder-screen'), boardsData);
    builderInitialized = true;
  }
  builder.activate();
  showScreen('builder-screen');
});
$('btn-back-menu').addEventListener('click', showMenu);
$('btn-back-rules').addEventListener('click', showMenu);
$('btn-back-builder').addEventListener('click', () => {
  builder.deactivate();
  showMenu();
});
$('btn-back-to-menu').addEventListener('click', () => {
  endSession();
  showMenu();
});

// === Lancement, reprise et fin de partie ===

$('btn-play').addEventListener('click', () => {
  const selection = $('board-select').value;
  const isCustom = selection.startsWith('custom:');
  const boardName = isCustom ? selection.substring(7) : selection;
  const boardEntry = isCustom ? MapBuilder.getCustomBoards()[boardName] : boardsData[boardName];

  if (!boardEntry) {
    $('setup-error').textContent = 'Plateau introuvable.';
    $('setup-error').hidden = false;
    return;
  }

  const spectator = $('spectator-mode').checked;
  const opponentCount = parseInt($('opponent-count').value, 10);
  const players = [];
  if (!spectator) {
    players.push({ name: $('player-name').value.trim() || 'Ventus', isHuman: true });
  }
  const aiCount = spectator ? opponentCount + 1 : opponentCount;
  for (let i = 0; i < aiCount; i++) {
    players.push({ name: AI_NAMES[i] || `IA ${i + 1}`, isHuman: false });
  }
  players.forEach((p, i) => { p.color = PLAYER_COLORS[i % PLAYER_COLORS.length]; });

  try {
    const game = new Game({
      boardEntry,
      boardName,
      players,
      gpGoal: parseInt($('gp-goal').value, 10),
      seed: randomSeed(),
    });
    launch(game);
  } catch (e) {
    console.error(e);
    $('setup-error').textContent = 'Ce plateau ne peut pas être joué (vérifiez-le dans l\'éditeur).';
    $('setup-error').hidden = false;
  }
});

$('btn-resume').addEventListener('click', () => {
  const game = loadSavedGame();
  if (!game) {
    clearSavedGame();
    showMenu();
    return;
  }
  launch(game);
});

function launch(game) {
  endSession();
  showScreen('game-screen');

  $('goal-value').textContent = gp(game.gpGoal);
  $('hud-bottom').style.display = game.players.some(p => p.isHuman) ? '' : 'none';
  $('log-entries').innerHTML = '';
  $('notif-stack').innerHTML = '';
  $('dice-display').classList.add('hidden');
  setActionButtons(null);

  const renderer2d = new Renderer($('board-canvas'));
  renderer2d.loadImages();

  const renderer3d = new Renderer3D();
  renderer3d.init($('board-3d-wrapper'));
  renderer3d.setFollow(settings.follow);
  renderer3d.setEnvironmentVisible(settings.scenery);
  $('opt-scenery').checked = settings.scenery;
  $('debug-tilt').value = renderer3d.cameraTilt;
  $('debug-tilt-val').textContent = renderer3d.cameraTilt;
  $('debug-pan').value = 0;
  $('debug-pan-val').textContent = 0;

  const controller = new GameController(game, ui, { speed: settings.speed });
  // Journal détaillé : le moteur note le jeu, SessionLog y ajoute le versant technique
  const log = new SessionLog(game, {
    settings: { ...settings },
    getRenderInfo: () => {
      const info = renderer3d.webglRenderer?.info;
      return info ? { drawCalls: info.render.calls, triangles: info.render.triangles, textures: info.memory.textures, geometries: info.memory.geometries } : null;
    },
  });
  renderer3d.webglRenderer.domElement.addEventListener('webglcontextlost', () => log.error('3d', 'contexte WebGL perdu'));
  renderer3d.webglRenderer.domElement.addEventListener('webglcontextrestored', () => log.ui('contexte WebGL rétabli'));
  session = { id: ++sessionCounter, game, controller, renderer2d, renderer3d, log, cancelAsk: null, pick: null, relabel: null };

  const tooltipEl = $('tile-tooltip');
  const hover = (tileId, x, y) => {
    if (tileId === null) hideTooltip(tooltipEl);
    else showTooltip(tooltipEl, tileTooltipHTML(game, tileId), x, y);
  };
  renderer3d.onTileHover = hover;
  renderer3d.onTileClick = hover; // au doigt, un appui sur une case affiche ses informations
  renderer3d.onViewChange = () => session?.relabel?.();
  renderer3d.onFollowChange = (follow) => {
    log.ui('suivi caméra coupé par un déplacement manuel');
    settings.follow = follow;
    saveSettings();
    refreshControlButtons();
  };
  renderer2d.onTileHover = hover;
  renderer2d.onTileClick = (tileId) => {
    if (!session) return;
    if (session.pick) {
      if (session.pick.ids.has(tileId)) session.pick.finish(tileId);
    } else {
      renderer3d.focusTile(tileId);
    }
  };

  refreshControlButtons();

  // Le plateau 3D lit d'abord les images des cases, puis la partie démarre
  const mine = session;
  renderer3d.generateBoard(game.boardData)
    .then(() => (session === mine ? controller.run() : null)) // sinon : partie quittée entre-temps
    .catch((e) => {
      console.error(e);
      log.error('boucle de jeu', e.message, { stack: e.stack, pending: game.pending });
      addLogEntry(`Erreur : ${e.message} (le journal de la partie en garde le détail)`, 'negative');
    });
}

// Arrête la partie affichée et libère tout ce qu'elle utilisait
function endSession() {
  if (!session) return;
  const ended = session;
  ended.controller.abort();
  if (ended.cancelAsk) ended.cancelAsk();
  if (ended.pick) ended.pick.finish(null);
  session = null;
  ended.log.ui('fin de session', { over: ended.game.over, turn: ended.game.turnNumber });
  ended.log.dispose();
  ended.renderer2d.dispose();
  ended.renderer3d.dispose();
  closeModal();
  closeBanner();
  hideTooltip($('tile-tooltip'));
  $('quit-overlay').classList.add('hidden');
  $('announce-banner').classList.add('hidden');
}

// === Barre du haut : menu, pause, vitesse, caméra ===

function refreshControlButtons() {
  $('btn-speed').textContent = `Vitesse ×${settings.speed}`;
  $('btn-follow').classList.toggle('active', settings.follow);
  const paused = !!session?.controller.paused;
  $('btn-pause').textContent = paused ? 'Reprendre' : 'Pause';
  $('btn-pause').classList.toggle('active', paused);
}

$('btn-quit').addEventListener('click', () => $('quit-overlay').classList.remove('hidden'));
$('btn-quit-cancel').addEventListener('click', () => $('quit-overlay').classList.add('hidden'));
$('btn-quit-confirm').addEventListener('click', () => {
  if (session) session.log.ui('retour au menu');
  endSession();
  showMenu();
});

// Journal détaillé : partie en cours, partie terminée, ou dernière partie conservée
$('btn-journal').addEventListener('click', () => session?.log.download());
$('btn-victory-journal').addEventListener('click', () => {
  if (session) session.log.download();
  else downloadStoredJournal();
});
$('btn-last-journal').addEventListener('click', () => downloadStoredJournal());

$('btn-pause').addEventListener('click', () => {
  if (!session) return;
  session.controller.setPaused(!session.controller.paused);
  session.log.ui(session.controller.paused ? 'pause' : 'reprise');
  refreshControlButtons();
});

$('btn-speed').addEventListener('click', () => {
  settings.speed = SPEEDS[(SPEEDS.indexOf(settings.speed) + 1) % SPEEDS.length];
  saveSettings();
  if (session) {
    session.controller.setSpeed(settings.speed);
    session.log.ui('vitesse', { speed: settings.speed });
  }
  refreshControlButtons();
});

$('btn-follow').addEventListener('click', () => {
  settings.follow = !settings.follow;
  saveSettings();
  if (session) {
    session.renderer3d.setFollow(settings.follow);
    session.log.ui('suivi caméra', { follow: settings.follow });
  }
  refreshControlButtons();
});

$('debug-toggle').addEventListener('click', () => $('debug-panel').classList.toggle('hidden'));
$('opt-scenery').addEventListener('change', (e) => {
  settings.scenery = e.target.checked;
  saveSettings();
  if (session) {
    session.renderer3d.setEnvironmentVisible(settings.scenery);
    session.log.ui('décor', { visible: settings.scenery });
  }
});
$('debug-tilt').addEventListener('input', (e) => {
  const val = Number(e.target.value);
  $('debug-tilt-val').textContent = val;
  if (session) session.renderer3d.setCameraTilt(val);
});
$('debug-pan').addEventListener('input', (e) => {
  const val = Number(e.target.value);
  $('debug-pan-val').textContent = val;
  if (session) session.renderer3d.setCameraPan(val);
});

// === Cartes ===

// Carte : bandeau du type (ce qui compte pour former une main), nom, puis valeur (ce qui compte
// pour acheter une case). `footer` remplace la valeur par un prix dans les fenêtres d'achat.
function cardElement(card, { small = false, footer = '' } = {}) {
  const placeable = card.type !== CardType.JOKER;
  const tileGP = RULES.baseTileCost + card.value * RULES.cardValueGP;
  const el = document.createElement('div');
  el.className = `card type-${card.type}${small ? ' small' : ''}`;
  el.dataset.instanceId = card.instanceId;
  el.title = placeable
    ? `${card.description} Valeur ${card.value} : posée sur une case, elle la fait valoir ${gp(tileGP)} GP.`
    : card.description;

  let foot;
  if (footer) foot = `<span class="card-foot-label">Prix</span><span class="card-value">${footer}</span>`;
  else if (placeable) foot = `<span class="card-foot-label">Valeur</span><span class="card-value">${card.value}</span>`;
  else foot = '<span class="card-foot-label">Non posable</span>';

  el.innerHTML = `
    <div class="card-head">
      <img class="card-icon" src="${CARD_TYPE_IMAGES[card.type]}" alt="">
      <span class="card-type">${CARD_TYPE_LABELS[card.type] || card.type}</span>
    </div>
    <div class="card-name">${escapeHtml(card.name)}</div>
    <div class="card-foot">${foot}</div>
  `;
  return el;
}

function requirementIcons(handDef) {
  return handDef.requiredCards
    .map(req => `<img src="${CARD_TYPE_IMAGES[req.type]}" alt="${CARD_TYPE_LABELS[req.type]}" title="${CARD_TYPE_LABELS[req.type]}">`.repeat(req.count))
    .join('');
}

// === Affichage de l'état ===

function statusChips(game, player) {
  const chips = [];
  const chip = (text, title) => chips.push(`<span class="p-chip" title="${title}">${text}</span>`);
  if (player.stunned) chip('⚡', 'Étourdi : passera son prochain tour');
  if (player.confusedTurns > 0) chip(`❓${player.confusedTurns}`, 'Confus : part au hasard aux intersections');
  if (player.gpProtector > 0) chip(`🛡️${player.gpProtector}`, 'Protecteur GP : prochaine perte bloquée');
  if (player.doubleTollTurns > 0) chip(`×2 (${player.doubleTollTurns})`, 'Péages doublés');
  if (player.justiceTurns > 0) chip(`🦸${player.justiceTurns}`, 'Captain Justice : +GP à chaque tour');
  if (player.darkTurns > 0) chip(`🦹${player.darkTurns}`, 'Captain Dark : −GP à chaque tour');
  const cube = game.cubeOf(player.id);
  if (cube) chip(`🎲 ${cube.counter} pas`, `Sur un Prize Cube : il se brise et paie ${cube.accumulatedGP} GP ou plus dans ${cube.counter} pas`);
  if (game.sparkyEffect && game.sparkyEffect.playerId === player.id) chip(`⚡🐾${game.sparkyEffect.turnsLeft}`, 'Sparky vole des GP aux adversaires');
  if (player.boosterPercent > RULES.boosterStart) chip(`🚀${player.boosterPercent} %`, 'Multiplicateur du Booster');
  return chips.join('');
}

function updateHUD(game) {
  const current = game.currentPlayer;
  const myTurn = current.isHuman && !game.over;

  // Barre du haut : numéro du tour et à qui c'est de jouer
  $('turn-number').textContent = game.turnNumber;
  $('turn-dot').style.background = current.color;
  const who = $('turn-who');
  who.textContent = myTurn ? 'À vous de jouer' : `${current.name} joue…`;
  who.style.color = myTurn ? '' : current.color;
  $('turn-status').classList.toggle('my-turn', myTurn);

  // Barre du bas : rappel au-dessus des boutons d'action
  $('action-status').textContent = myTurn ? 'À vous de jouer' : `Tour de ${current.name}`;
  $('action-panel').classList.toggle('my-turn', myTurn);

  // Main du joueur humain (toujours visible, même pendant le tour des autres)
  const viewer = game.players.find(p => p.isHuman);
  const handEl = $('hand-cards');
  handEl.innerHTML = '';
  if (viewer) {
    if (viewer.eliminated) {
      handEl.innerHTML = '<span class="hand-note">Vous êtes en faillite : la partie continue sans vous.</span>';
    } else {
      for (const card of viewer.hand) handEl.appendChild(cardElement(card));
      if (viewer.hand.length === 0) handEl.innerHTML = '<span class="hand-note">Aucune carte en main.</span>';
    }
  }
  $('hand-count').textContent = viewer && !viewer.eliminated ? `${viewer.hand.length} / ${RULES.maxHandSize}` : '';

  const listEl = $('players-list');
  listEl.innerHTML = '';
  for (const p of game.players) {
    const net = game.netWorth(p);
    const ownedTiles = game.tiles.filter(t => t.owner === p.id).length;
    const isCurrent = p.id === current.id && !game.over;
    const div = document.createElement('div');
    div.className = `player-info-card${isCurrent ? ' active' : ''}${p.eliminated ? ' eliminated' : ''}`;
    div.style.setProperty('--pc', p.color);

    const checkpointNames = { red: 'rouge', blue: 'bleu', yellow: 'jaune', green: 'vert' };
    const checkpoints = Object.keys(checkpointNames)
      .map(c => `<span class="p-cp ${c}${p.checkpoints[c] ? ' active' : ''}" title="Checkpoint ${checkpointNames[c]} : ${p.checkpoints[c] ? 'activé' : 'à activer'}"></span>`)
      .join('');
    const progress = Math.max(0, Math.min(100, Math.round(net / game.gpGoal * 100)));
    const tag = isCurrent ? '<span class="p-tag turn">joue</span>' : (p.isHuman ? '' : '<span class="p-tag">IA</span>');

    div.innerHTML = `
      <div class="p-head"><span class="p-dot"></span><span class="p-name">${escapeHtml(p.name)}</span>${tag}</div>
      ${p.eliminated ? '<div class="p-out">En faillite</div>' : `
        <div class="p-money"><span class="p-gp">${gp(p.gp)}</span><span class="p-unit">GP en poche</span></div>
        <div class="p-fortune" title="Fortune = GP en poche + valeur des cases. Objectif : ${gp(game.gpGoal)} GP">
          <div class="p-fortune-line"><span>Fortune</span><span><b>${gp(net)}</b> / ${gp(game.gpGoal)}</span></div>
          <div class="p-progress"><div style="width:${progress}%"></div></div>
        </div>
        <div class="p-stats">
          <div class="p-stat" title="Cases possédées"><b>${ownedTiles}</b><span>${ownedTiles > 1 ? 'cases' : 'case'}</span></div>
          <div class="p-stat" title="Cartes en main"><b>${p.hand.length}</b><span>${p.hand.length > 1 ? 'cartes' : 'carte'}</span></div>
          <div class="p-stat" title="Les 4 checkpoints à activer pour le bonus de tour"><span class="p-checkpoints">${checkpoints}</span><span>checkpoints</span></div>
        </div>
        <div class="p-status">${statusChips(game, p)}</div>
      `}
    `;
    listEl.appendChild(div);
  }
}

function addLogEntry(message, style) {
  const container = $('log-entries');
  const entry = document.createElement('div');
  entry.className = `log-entry${style ? ` ${style}` : ''}`;
  entry.textContent = message;
  container.appendChild(entry);
  while (container.children.length > MAX_LOG_ENTRIES) container.removeChild(container.firstChild);
  const log = $('message-log');
  log.scrollTop = log.scrollHeight;
}

function showNotif(icon, text, style = 'info') {
  const stack = $('notif-stack');
  const toast = document.createElement('div');
  toast.className = 'notif-toast';
  toast.innerHTML = `<span class="notif-icon"></span><span class="notif-text ${style}"></span>`;
  toast.querySelector('.notif-icon').textContent = icon;
  toast.querySelector('.notif-text').textContent = text;
  stack.appendChild(toast);
  while (stack.children.length > 4) stack.removeChild(stack.firstChild);
  setTimeout(() => toast.remove(), 2200);
}

let diceTimer = null;
function showDice(rolls, ms) {
  const display = $('dice-display');
  display.innerHTML = rolls.map(r => `<div class="dice">${r}</div>`).join('');
  display.classList.remove('hidden');
  clearTimeout(diceTimer);
  diceTimer = setTimeout(() => display.classList.add('hidden'), ms);
}

// Pion en mouvement sur la minimap, en même temps que dans la vue 3D
function animateMinimap(effect, ms) {
  const mine = session;
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      if (session !== mine) return resolve();
      const progress = Math.min(1, (now - start) / Math.max(ms, 1));
      mine.renderer2d.render(mine.game, {
        playerId: effect.playerId, from: effect.from, to: effect.to, progress, withCube: effect.cubeId !== null,
      });
      if (progress < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

// === Fenêtre de décision et bandeau de choix ===

function openModal(html) {
  const content = $('modal-content');
  content.innerHTML = html;
  $('modal-overlay').classList.remove('hidden');
  return content;
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
  $('modal-content').innerHTML = '';
}

function openBanner(text) {
  $('choice-text').textContent = text;
  $('choice-buttons').innerHTML = '';
  $('choice-banner').classList.remove('hidden');
  return $('choice-buttons');
}

function closeBanner() {
  $('choice-banner').classList.add('hidden');
  $('choice-buttons').innerHTML = '';
}

function setActionButtons(request) {
  const rollBtn = $('btn-roll');
  const handBtn = $('btn-play-hand');
  rollBtn.onclick = null;
  handBtn.onclick = null;
  rollBtn.disabled = !request;
  handBtn.disabled = !request || request.hands.length === 0;
  const dice = request ? request.diceCount : 1;
  $('roll-btn-title').textContent = dice > 1 ? `Lancer ${dice} dés` : 'Lancer le dé';
  const hands = request ? request.hands.length : 0;
  $('hand-btn-sub').textContent = !request ? '' : (hands > 0 ? `${hands} possible${hands > 1 ? 's' : ''}` : 'rien à jouer');
}

// Clic sur une case du plateau (vue 3D ou minimap) parmi `tileIds`
function pickTile(tileIds, arrowsFrom = null) {
  const mine = session;
  return new Promise((resolve) => {
    let done = false;
    const finish = (tileId) => {
      if (done) return;
      done = true;
      mine.pick = null;
      mine.renderer2d.setPickable(null);
      mine.renderer3d.cancelPick();
      resolve(tileId);
    };
    mine.pick = { ids: new Set(tileIds), finish };
    mine.renderer2d.setPickable(tileIds);
    mine.renderer3d.pickTile({ tileIds, arrowsFrom }).then((tileId) => {
      if (tileId !== null) finish(tileId);
    });
  });
}

function tileLabel(game, tileId) {
  const tile = game.tiles[tileId];
  let label = TILE_TYPE_NAMES[tile.type] || tile.type;
  if (tile.owner !== null) label += ` (${game.players[tile.owner].name})`;
  return label;
}

// Chaque fonction met en place l'interface d'une décision, appelle `finish(choix)` quand le
// joueur a répondu, et retourne de quoi tout refermer.
const ASKERS = {
  // Début de tour : jouer une main, puis lancer
  turn(request, game, finish) {
    const player = game.players[request.playerId];
    setActionButtons(request);
    $('btn-roll').onclick = () => finish({ action: 'roll' });
    $('btn-play-hand').onclick = () => openHandList(player, request, game, finish);
    return () => {
      setActionButtons(null);
      closeModal();
    };
  },

  // Intersection : flèches cliquables sur le plateau, doublées de boutons
  direction(request, game, finish) {
    const player = game.players[request.playerId];
    const steps = request.stepsRemaining;
    const buttons = openBanner(`Encore ${steps} pas — choisissez une direction (flèche sur le plateau ou bouton)`);

    const relabel = () => {
      buttons.querySelectorAll('button').forEach((btn) => {
        const tileId = Number(btn.dataset.tileId);
        const arrow = session ? session.renderer3d.screenArrow(player.position, tileId) : '';
        btn.querySelector('.dir-arrow').textContent = arrow;
      });
    };
    for (const move of request.moves) {
      const btn = document.createElement('button');
      btn.className = 'overlay-btn';
      btn.dataset.tileId = move.tileId;
      btn.innerHTML = '<span class="dir-arrow"></span> <span class="dir-label"></span>';
      btn.querySelector('.dir-label').textContent = tileLabel(game, move.tileId) + (move.isLink ? ' (téléporteur)' : '');
      btn.addEventListener('click', () => finish({ tileId: move.tileId }));
      buttons.appendChild(btn);
    }
    relabel();
    session.relabel = relabel;

    pickTile(request.moves.map(m => m.tileId), player.position).then((tileId) => {
      if (tileId !== null) finish({ tileId });
    });

    return () => {
      if (session) session.relabel = null;
      if (session?.pick) session.pick.finish(null);
      closeBanner();
    };
  },

  buy(request, game, finish) {
    const player = game.players[request.playerId];
    const tile = game.tiles[request.tileId];
    const zoneDef = game.boardData.zones?.find(z => z.id === tile.zone);
    const zoneLine = tile.zone
      ? `<p>Zone : ${escapeHtml(zoneDef?.name || tile.zone)} — vous y possédez ${countOwnedInZone(game.tiles, tile.zone, player.id)} case(s) sur ${countTilesInZone(game.tiles, tile.zone)}</p>`
      : '';
    const content = openModal(`
      <h3>Acheter cette case ?</h3>
      ${zoneLine}
      <p>Choisissez la carte à poser : elle fixe le prix et la valeur de la case.</p>
      <div class="card-row" id="buy-cards"></div>
      <div>
        <button class="overlay-btn confirm" data-act="ok" disabled>Acheter</button>
        <button class="overlay-btn" data-act="skip">Passer</button>
      </div>
    `);

    let selected = null;
    const okBtn = content.querySelector('[data-act=ok]');
    const row = content.querySelector('#buy-cards');
    const options = request.options
      .map(o => ({ ...o, card: player.hand.find(c => c.instanceId === o.cardId) }))
      .filter(o => o.card)
      .sort((a, b) => a.cost - b.cost);
    for (const option of options) {
      const el = cardElement(option.card, { small: true, footer: `${gp(option.cost)} GP` });
      el.addEventListener('click', () => {
        row.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
        selected = option;
        okBtn.disabled = false;
        okBtn.textContent = `Acheter (${gp(option.cost)} GP)`;
      });
      row.appendChild(el);
    }
    okBtn.addEventListener('click', () => selected && finish({ cardId: selected.cardId }));
    content.querySelector('[data-act=skip]').addEventListener('click', () => finish(null));
    return closeModal;
  },

  upgrade(request, _game, finish) {
    const content = openModal(`
      <h3>Améliorer cette case ?</h3>
      <p>Niveau ${request.level} → ${request.level + 1}</p>
      <p>Coût : <span class="gp-amount">${gp(request.cost)} GP</span></p>
      <div>
        <button class="overlay-btn confirm" data-act="ok">Améliorer</button>
        <button class="overlay-btn" data-act="skip">Passer</button>
      </div>
    `);
    content.querySelector('[data-act=ok]').addEventListener('click', () => finish({ upgrade: true }));
    content.querySelector('[data-act=skip]').addEventListener('click', () => finish({ upgrade: false }));
    return closeModal;
  },

  // N'est demandé que si le joueur a de quoi racheter la case
  toll(request, game, finish) {
    const owner = game.players[request.ownerId];
    const tile = game.tiles[request.tileId];
    const content = openModal(`
      <h3>Péage !</h3>
      <p>Case de <strong style="color:${owner.color}">${escapeHtml(owner.name)}</strong> (niveau ${tile.level})</p>
      <p>Péage : <span class="gp-amount">${gp(request.toll)} GP</span></p>
      <p>Racheter la case la ramène au niveau 1.</p>
      <div>
        <button class="overlay-btn danger" data-act="pay">Payer ${gp(request.toll)} GP</button>
        <button class="overlay-btn confirm" data-act="buyout">Racheter (${gp(request.buyoutCost)} GP)</button>
      </div>
    `);
    content.querySelector('[data-act=pay]').addEventListener('click', () => finish({ action: 'pay' }));
    content.querySelector('[data-act=buyout]').addEventListener('click', () => finish({ action: 'buyout' }));
    return closeModal;
  },

  // Case Bonus : acheter la case, qui porte déjà une carte
  bonus(request, game, finish) {
    const content = openModal(`
      <h3>Acheter cette case Bonus ?</h3>
      <p>Une carte y est déjà posée : vous ne dépensez aucune carte de votre main.</p>
      <div class="card-row static" id="bonus-card"></div>
      <p>La case devient la vôtre : elle rapporte un péage et peut être améliorée.</p>
      <div>
        <button class="overlay-btn confirm" data-act="ok">Acheter (${gp(request.cost)} GP)</button>
        <button class="overlay-btn" data-act="skip">Passer</button>
      </div>
    `);
    content.querySelector('#bonus-card').appendChild(cardElement(request.card, { small: true }));
    content.querySelector('[data-act=ok]').addEventListener('click', () => finish({ buy: true }));
    content.querySelector('[data-act=skip]').addEventListener('click', () => finish({ buy: false }));
    return closeModal;
  },

  forcedSale(request, game, finish) {
    const content = openModal(`
      <h3>Vente forcée</h3>
      <p>Il vous manque <span class="gp-amount negative">${gp(request.debt)} GP</span>. Choisissez une case à vendre :</p>
      <div class="choice-list" id="sale-tiles"></div>
    `);
    const list = content.querySelector('#sale-tiles');
    const owned = request.tileIds.map(id => game.tiles[id]).sort((a, b) => a.currentValue - b.currentValue);
    for (const tile of owned) {
      const btn = document.createElement('button');
      btn.className = 'overlay-btn danger';
      btn.innerHTML = `Case n° ${tile.id}<br><small>Niveau ${tile.level} — ${gp(tile.currentValue)} GP</small>`;
      btn.addEventListener('mouseenter', () => session?.renderer3d.focusTile(tile.id));
      btn.addEventListener('click', () => finish({ tileId: tile.id }));
      list.appendChild(btn);
    }
    return closeModal;
  },

  teleport(request, game, finish) {
    openBanner('Keyblade Glider : cliquez sur la case de destination (plateau ou minimap)');
    pickTile(request.tileIds).then((tileId) => {
      if (tileId !== null) finish({ tileId });
    });
    return () => {
      if (session?.pick) session.pick.finish(null);
      closeBanner();
    };
  },

  pixieDust(request, game, finish) {
    const targets = request.targetIds.map(id => game.players[id]);
    const chooseTile = (target) => {
      closeModal();
      openBanner(`Pixie Dust : cliquez sur la case où envoyer ${target.name}`);
      pickTile(request.tileIds).then((tileId) => {
        if (tileId !== null) finish({ targetId: target.id, tileId });
      });
    };

    if (targets.length === 1) {
      chooseTile(targets[0]);
    } else {
      const content = openModal('<h3>Pixie Dust</h3><p>Quel adversaire déplacer ?</p><div class="choice-list" id="pixie-targets"></div>');
      for (const target of targets) {
        const btn = document.createElement('button');
        btn.className = 'overlay-btn';
        btn.style.borderColor = target.color;
        btn.style.color = target.color;
        btn.textContent = target.name;
        btn.addEventListener('click', () => chooseTile(target));
        content.querySelector('#pixie-targets').appendChild(btn);
      }
    }
    return () => {
      if (session?.pick) session.pick.finish(null);
      closeBanner();
      closeModal();
    };
  },
};

// Liste des mains jouables
function openHandList(player, request, game, finish) {
  const content = openModal('<h3>Jouer une main</h3><div class="choice-list column" id="hand-list"></div><button class="overlay-btn" data-act="cancel">Annuler</button>');
  const list = content.querySelector('#hand-list');
  for (const handDef of request.hands.map(getHandDef)) {
    const btn = document.createElement('button');
    btn.className = 'overlay-btn hand-option';
    btn.innerHTML = `<span><strong>${handDef.name}</strong><br><small>${handDef.description}</small></span><span class="hand-req">${requirementIcons(handDef)}</span>`;
    btn.addEventListener('click', () => openHandDetail(handDef, player, request, game, finish));
    list.appendChild(btn);
  }
  content.querySelector('[data-act=cancel]').addEventListener('click', closeModal);
}

// Détail d'une main : cartes consommées (modifiables) et cible éventuelle
function openHandDetail(handDef, player, request, game, finish) {
  const opponents = game.opponentsOf(player);
  const candidates = player.hand.filter(c => handDef.requiredCards.some(req => req.type === c.type));
  const required = Object.fromEntries(handDef.requiredCards.map(req => [req.type, req.count]));
  const total = handDef.requiredCards.reduce((n, req) => n + req.count, 0);
  const hasChoice = candidates.length > total;

  // Par défaut : les cartes les plus faibles, dans l'ordre où elles ont été choisies
  let selected = selectCardsForHand(player.hand, handDef).map(c => c.instanceId);
  let targetId = handDef.needsTarget && opponents.length === 1 ? opponents[0].id : null;

  const content = openModal(`
    <h3>${handDef.name}</h3>
    <p>${handDef.description}</p>
    <p>${hasChoice ? 'Cartes utilisées (cliquez pour en changer) :' : 'Cartes utilisées :'}</p>
    <div class="card-row" id="hand-pick"></div>
    ${handDef.needsTarget ? '<p>Cible :</p><div class="choice-list" id="hand-targets"></div>' : ''}
    <div>
      <button class="overlay-btn confirm" data-act="ok">Jouer</button>
      <button class="overlay-btn" data-act="back">Retour</button>
    </div>
  `);
  const okBtn = content.querySelector('[data-act=ok]');
  const row = content.querySelector('#hand-pick');

  const refresh = () => {
    row.querySelectorAll('.card').forEach(el => el.classList.toggle('selected', selected.includes(el.dataset.instanceId)));
    const counts = {};
    for (const id of selected) {
      const type = player.hand.find(c => c.instanceId === id).type;
      counts[type] = (counts[type] || 0) + 1;
    }
    const cardsOk = handDef.requiredCards.every(req => counts[req.type] === req.count) && selected.length === total;
    okBtn.disabled = !cardsOk || (handDef.needsTarget && targetId === null);
    content.querySelectorAll('#hand-targets button').forEach(btn => btn.classList.toggle('chosen', Number(btn.dataset.id) === targetId));
  };

  for (const card of (hasChoice ? candidates : candidates.filter(c => selected.includes(c.instanceId)))) {
    const el = cardElement(card, { small: true });
    if (hasChoice) {
      el.addEventListener('click', () => {
        if (selected.includes(card.instanceId)) return;
        // Remplace la plus ancienne carte choisie du même type
        const sameType = selected.filter(id => player.hand.find(c => c.instanceId === id).type === card.type);
        if (sameType.length >= required[card.type]) selected = selected.filter(id => id !== sameType[0]);
        selected.push(card.instanceId);
        refresh();
      });
    }
    row.appendChild(el);
  }

  if (handDef.needsTarget) {
    const targetsEl = content.querySelector('#hand-targets');
    for (const target of opponents) {
      const btn = document.createElement('button');
      btn.className = 'overlay-btn';
      btn.dataset.id = target.id;
      btn.style.borderColor = target.color;
      btn.style.color = target.color;
      btn.textContent = target.name;
      btn.addEventListener('click', () => {
        targetId = target.id;
        refresh();
      });
      targetsEl.appendChild(btn);
    }
  }

  okBtn.addEventListener('click', () => finish({
    action: 'hand', handType: handDef.type, targetId: targetId ?? undefined, cardIds: selected,
  }));
  content.querySelector('[data-act=back]').addEventListener('click', () => openHandList(player, request, game, finish));
  refresh();
}

// Pose une décision au joueur humain ; la promesse rend son choix (ou undefined si on quitte)
function askDecision(request, game) {
  const mine = session;
  return new Promise((resolve) => {
    let settled = false;
    let cleanup = null;
    const finish = (choice) => {
      if (settled) return;
      settled = true;
      if (cleanup) cleanup();
      if (mine) mine.cancelAsk = null;
      resolve(choice);
    };
    mine.cancelAsk = () => finish(undefined);
    const asker = ASKERS[request.type];
    cleanup = asker ? asker(request, game, finish) : null;
    if (!asker) finish(undefined);
  });
}

function showMessage(text) {
  const mine = session;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      closeModal();
      if (mine) mine.cancelAsk = null;
      resolve();
    };
    mine.cancelAsk = finish;
    const content = openModal('<h3></h3><button class="overlay-btn" data-act="ok">OK</button>');
    content.querySelector('h3').textContent = text;
    content.querySelector('[data-act=ok]').addEventListener('click', finish);
  });
}

function showVictory(game) {
  const winner = game.players[game.winnerId];
  const winnerEl = $('winner-name');
  winnerEl.textContent = winner.name;
  winnerEl.style.color = winner.color;
  $('winner-reason').textContent = game.winReason === 'lastStanding'
    ? 'Dernier joueur en lice : tous les autres ont fait faillite.'
    : `Objectif de ${gp(game.gpGoal)} GP atteint au tour ${game.turnNumber}.`;

  const scoresEl = $('final-scores');
  scoresEl.innerHTML = '';
  game.getScores().forEach((score, i) => {
    const row = document.createElement('div');
    row.className = 'final-score-row';
    row.innerHTML = `
      <span class="rank">#${i + 1}</span>
      <span class="name" style="color:${score.color}"></span>
      <span class="score">${score.eliminated ? 'faillite' : `${gp(score.netWorth)} GP`}</span>
    `;
    row.querySelector('.name').textContent = score.name;
    scoresEl.appendChild(row);
  });

  showScreen('victory-screen');
}

// Interface fournie au chef d'orchestre de la partie (js/controller.js)
const ui = {
  sync(game) {
    if (!session) return;
    updateHUD(game);
    session.renderer2d.render(game);
    session.renderer3d.sync(game);
  },
  log: addLogEntry,
  notif: showNotif,
  showDice,
  animateMove(effect, ms) {
    if (!session) return Promise.resolve();
    return Promise.all([session.renderer3d.animateMove(effect, ms), animateMinimap(effect, ms)]);
  },
  animateTeleport(effect, ms) {
    return session ? session.renderer3d.animateTeleport(effect, ms) : Promise.resolve();
  },
  animateCubeBreak(effect, ms) {
    return session ? session.renderer3d.animateCubeBreak(effect, ms) : Promise.resolve();
  },
  // Annonce : qui joue quoi, avec quel effet. Si des cases changent de mains à distance, la caméra
  // s'y rend ensuite et le nouveau propriétaire y apparaît.
  async announce(event, ms, tileMs) {
    const mine = session;
    if (!mine) return;
    const player = mine.game.players[event.playerId];
    const tileIds = event.tileIds || [];

    const banner = $('announce-banner');
    banner.style.setProperty('--pc', player.color);
    $('announce-icon').textContent = event.icon;
    $('announce-title').innerHTML = `<b>${escapeHtml(player.name)}</b> — ${escapeHtml(event.title)}`;
    $('announce-text').textContent = event.text;
    banner.classList.remove('hidden');

    // La plaque du nouveau propriétaire n'apparaîtra qu'à l'arrivée de la caméra
    if (tileIds.length > 0) mine.renderer3d.hideOwnership(tileIds);
    await Promise.all([
      new Promise(resolve => setTimeout(resolve, ms)),
      mine.renderer3d.playEffect(event.fx, event.playerId, ms),
    ]);

    if (session === mine && tileIds.length > 0) {
      if (!mine.pick) mine.renderer2d.setPickable(tileIds);
      await mine.renderer3d.spotlight(tileIds, tileMs, player.color);
      if (session === mine && !mine.pick) mine.renderer2d.setPickable(null);
    }
    banner.classList.add('hidden');
  },
  ask: askDecision,
  showMessage,
  showVictory,
  persistJournal() {
    if (session) session.log.persist();
  },
};

loadBoards();
showMenu();
