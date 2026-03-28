// Point d'entree principal - connecte le GameManager a l'UI

import { GameManager } from './gameManager.js';
import { CardType } from './cards.js';
import { getBuyoutCost, getUpgradeCost, parseBoardJSON } from './board.js';
import { calculateNetWorth } from './player.js';

const game = new GameManager();

// === Chargement des plateaux depuis boards.json ===
let boardsData = {};

async function loadBoards() {
  try {
    const resp = await fetch('boards.json');
    boardsData = await resp.json();
    const select = document.getElementById('board-select');
    select.innerHTML = '';
    for (const name of Object.keys(boardsData)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    }
  } catch (e) {
    console.error('Erreur chargement boards.json:', e);
  }
}

loadBoards();

// === Navigation entre ecrans ===
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

document.getElementById('btn-start').addEventListener('click', () => showScreen('setup-screen'));
document.getElementById('btn-rules').addEventListener('click', () => showScreen('rules-screen'));
document.getElementById('btn-back-menu').addEventListener('click', () => showScreen('main-menu'));
document.getElementById('btn-back-rules').addEventListener('click', () => showScreen('main-menu'));
document.getElementById('btn-back-to-menu').addEventListener('click', () => showScreen('main-menu'));

// === Lancement de partie ===
document.getElementById('btn-play').addEventListener('click', () => {
  const playerName = document.getElementById('player-name').value.trim() || 'Ventus';
  const opponentCount = parseInt(document.getElementById('opponent-count').value);
  const gpGoal = parseInt(document.getElementById('gp-goal').value);
  const boardName = document.getElementById('board-select').value;

  const gridData = boardsData[boardName];
  if (!gridData) {
    alert('Plateau introuvable !');
    return;
  }

  const boardData = parseBoardJSON(gridData);
  const spectator = document.getElementById('spectator-mode').checked;

  showScreen('game-screen');
  document.getElementById('goal-value').textContent = gpGoal.toLocaleString();

  // Masquer la main et les actions en mode spectateur
  if (spectator) {
    document.getElementById('hud-bottom').style.display = 'none';
  } else {
    document.getElementById('hud-bottom').style.display = '';
  }

  // Connecter les callbacks
  game.onUpdate = updateHUD;
  game.onLog = addLogEntry;
  game.onShowOverlay = showOverlay;
  game.onDirectionChoice = showDirectionChoice;
  game.onVictory = showVictory;

  game.init(playerName, opponentCount, gpGoal, boardData, spectator);
});

// === Selection de cartes dans la main ===
let selectedCards = [];

function renderHand(player) {
  const container = document.getElementById('hand-cards');
  container.innerHTML = '';
  selectedCards = [];

  for (const card of player.hand) {
    const el = document.createElement('div');
    el.className = `card type-${card.type}`;
    el.dataset.instanceId = card.instanceId;
    el.innerHTML = `
      <div class="card-name">${card.name}</div>
      <div class="card-value">${card.value}</div>
      <div class="card-type">${card.type === CardType.MAGIC ? 'Magie' : card.type === CardType.DEFENSE ? 'Defense' : 'Attaque'}</div>
    `;
    el.title = card.description;

    el.addEventListener('click', () => {
      if (game.phase === 'roll') {
        // Selection pour sacrifice (des supplementaires)
        if (card.type !== CardType.MAGIC) {
          el.classList.toggle('selected');
          if (el.classList.contains('selected')) {
            selectedCards.push(card.instanceId);
          } else {
            selectedCards = selectedCards.filter(id => id !== card.instanceId);
          }
          updateRollButtons();
        }
      }
    });

    container.appendChild(el);
  }
}

function updateRollButtons() {
  const btn2 = document.getElementById('btn-roll2');
  const btn3 = document.getElementById('btn-roll3');
  btn2.disabled = selectedCards.length < 1;
  btn3.disabled = selectedCards.length < 2;

  document.getElementById('btn-roll').textContent =
    selectedCards.length === 0 ? 'Lancer (1 de)' :
    `Lancer (${1 + selectedCards.length} des)`;
}

// === Boutons d'action ===

document.getElementById('btn-roll').addEventListener('click', () => {
  if (game.phase !== 'roll') return;
  disableActions();
  game.roll(selectedCards);
});

document.getElementById('btn-roll2').addEventListener('click', () => {
  if (game.phase !== 'roll' || selectedCards.length < 1) return;
  disableActions();
  game.roll(selectedCards.slice(0, 1));
});

document.getElementById('btn-roll3').addEventListener('click', () => {
  if (game.phase !== 'roll' || selectedCards.length < 2) return;
  disableActions();
  game.roll(selectedCards.slice(0, 2));
});

document.getElementById('btn-use-magic').addEventListener('click', () => {
  if (game.phase !== 'magic') return;
  showMagicSelection();
});

document.getElementById('btn-end-turn').addEventListener('click', () => {
  if (game.phase === 'magic') {
    game.skipMagic();
  }
});

function disableActions() {
  document.getElementById('btn-roll').disabled = true;
  document.getElementById('btn-roll2').disabled = true;
  document.getElementById('btn-roll3').disabled = true;
  document.getElementById('btn-use-magic').disabled = true;
  document.getElementById('btn-end-turn').disabled = true;
}

function enableActions() {
  const player = game.currentPlayer;
  if (!player.isHuman) {
    disableActions();
    return;
  }

  const hasMagic = player.hand.some(c => c.type === CardType.MAGIC);

  if (game.phase === 'magic') {
    document.getElementById('btn-roll').disabled = true;
    document.getElementById('btn-roll2').disabled = true;
    document.getElementById('btn-roll3').disabled = true;
    document.getElementById('btn-use-magic').disabled = !hasMagic;
    document.getElementById('btn-end-turn').disabled = false;
    document.getElementById('btn-end-turn').textContent = 'Passer la magie';
  } else if (game.phase === 'roll') {
    document.getElementById('btn-roll').disabled = false;
    document.getElementById('btn-roll2').disabled = true;
    document.getElementById('btn-roll3').disabled = true;
    document.getElementById('btn-use-magic').disabled = true;
    document.getElementById('btn-end-turn').disabled = true;
    document.getElementById('btn-end-turn').textContent = 'Fin de tour';
  } else {
    disableActions();
  }
}

// === HUD Update ===

function updateHUD(gm) {
  const player = gm.currentPlayer;

  // Turn info
  document.getElementById('turn-number').textContent = gm.turnNumber;
  document.getElementById('current-player-name').textContent = player.name;
  document.getElementById('current-player-gp').textContent = player.gp.toLocaleString();
  document.getElementById('current-player-net').textContent =
    calculateNetWorth(player, gm.board).toLocaleString();

  // Player hand
  if (player.isHuman) {
    renderHand(player);
  } else {
    document.getElementById('hand-cards').innerHTML =
      '<span style="color:#8890a8;font-size:0.8rem">Tour de l\'IA...</span>';
  }

  // Players panel
  const listEl = document.getElementById('players-list');
  listEl.innerHTML = '';
  for (const p of gm.players) {
    const net = calculateNetWorth(p, gm.board);
    const div = document.createElement('div');
    div.className = `player-info-card${p.id === player.id ? ' active' : ''}`;
    div.innerHTML = `
      <div class="p-name" style="color:${p.color}">${p.name}${p.isHuman ? '' : ' (IA)'}</div>
      <div class="p-gp">${p.gp.toLocaleString()} GP</div>
      <div class="p-net">Net: ${net.toLocaleString()}</div>
    `;
    listEl.appendChild(div);
  }

  // Checkpoints (joueur humain)
  const human = gm.players.find(p => p.isHuman);
  if (human) {
    for (const color of ['red', 'blue', 'yellow', 'green']) {
      const el = document.getElementById(`cp-${color}`);
      el.classList.toggle('active', human.checkpoints[color]);
    }
  }

  enableActions();
}

// === Log ===

function addLogEntry(message, type) {
  const container = document.getElementById('log-entries');
  const entry = document.createElement('div');
  entry.className = `log-entry${type ? ' ' + type : ''}`;
  entry.textContent = message;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  // Limiter a 50 entrees
  while (container.children.length > 50) {
    container.removeChild(container.firstChild);
  }
}

// === Overlays ===

function showOverlay(type, tile, player, board, callback) {
  const overlay = document.getElementById('tile-action-overlay');
  const content = document.getElementById('tile-action-content');

  if (type === 'buy') {
    const nonMagicCards = player.hand.filter(c => c.type !== CardType.MAGIC);
    content.innerHTML = `
      <h3>Acheter cette case ?</h3>
      <p>Cout : <span class="gp-amount">${tile.baseValue} GP</span></p>
      <p>Choisissez une carte a placer :</p>
      <div id="buy-cards" style="display:flex;gap:8px;justify-content:center;margin:10px 0;flex-wrap:wrap"></div>
      <div>
        <button class="overlay-btn confirm" id="btn-confirm-buy" disabled>Acheter</button>
        <button class="overlay-btn" id="btn-skip-buy">Passer</button>
      </div>
    `;
    overlay.classList.remove('hidden');

    let selectedBuyCard = null;
    const cardsContainer = content.querySelector('#buy-cards');

    for (const card of nonMagicCards) {
      const el = document.createElement('div');
      el.className = `card type-${card.type}`;
      el.style.width = '60px';
      el.style.height = '80px';
      el.innerHTML = `<div class="card-name">${card.name}</div><div class="card-value">${card.value}</div>`;
      el.addEventListener('click', () => {
        cardsContainer.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
        selectedBuyCard = card;
        content.querySelector('#btn-confirm-buy').disabled = false;
      });
      cardsContainer.appendChild(el);
    }

    content.querySelector('#btn-confirm-buy').addEventListener('click', () => {
      if (selectedBuyCard) {
        overlay.classList.add('hidden');
        game.buyTile(player, tile, selectedBuyCard);
        game.endTurn();
      }
    });
    content.querySelector('#btn-skip-buy').addEventListener('click', () => {
      overlay.classList.add('hidden');
      game.endTurn();
    });

  } else if (type === 'upgrade') {
    const cost = getUpgradeCost(tile);
    content.innerHTML = `
      <h3>Ameliorer cette case ?</h3>
      <p>Niveau actuel : ${tile.level} -> ${tile.level + 1}</p>
      <p>Cout : <span class="gp-amount">${cost} GP</span></p>
      <div>
        <button class="overlay-btn confirm" id="btn-confirm-upgrade">Ameliorer</button>
        <button class="overlay-btn" id="btn-skip-upgrade">Passer</button>
      </div>
    `;
    overlay.classList.remove('hidden');

    content.querySelector('#btn-confirm-upgrade').addEventListener('click', () => {
      overlay.classList.add('hidden');
      game.upgradeTile(player, tile);
      game.endTurn();
    });
    content.querySelector('#btn-skip-upgrade').addEventListener('click', () => {
      overlay.classList.add('hidden');
      game.endTurn();
    });

  } else if (type === 'toll') {
    const owner = game.players.find(p => p.id === tile.owner);
    const tollAmount = tile.tollValue;
    const buyoutCost = getBuyoutCost(tile);
    const canBuyout = player.gp >= buyoutCost;

    content.innerHTML = `
      <h3>Peage !</h3>
      <p>Case de <strong style="color:${owner.color}">${owner.name}</strong> (Nv.${tile.level})</p>
      <p>Peage : <span class="gp-amount">${tollAmount} GP</span></p>
      <div>
        <button class="overlay-btn danger" id="btn-pay-toll">Payer le peage</button>
        ${canBuyout ? `<button class="overlay-btn confirm" id="btn-buyout">Racheter (${buyoutCost} GP)</button>` : ''}
      </div>
    `;
    overlay.classList.remove('hidden');

    content.querySelector('#btn-pay-toll').addEventListener('click', () => {
      overlay.classList.add('hidden');
      const actual = transferGP(player, owner, tollAmount);
      game.log(`${player.name} paye ${actual} GP de peage a ${owner.name}.`, 'negative');
      game.endTurn();
    });

    if (canBuyout) {
      content.querySelector('#btn-buyout').addEventListener('click', () => {
        overlay.classList.add('hidden');
        game.buyoutTile(player, tile, owner);
        game.endTurn();
      });
    }

  } else if (type === 'event') {
    content.innerHTML = `
      <h3>${tile.message}</h3>
      <button class="overlay-btn" id="btn-event-ok">OK</button>
    `;
    overlay.classList.remove('hidden');

    content.querySelector('#btn-event-ok').addEventListener('click', () => {
      overlay.classList.add('hidden');
      if (callback) callback();
    });
  }
}

// === Choix de direction ===

function showDirectionChoice(moves, callback) {
  const overlay = document.getElementById('direction-overlay');
  const buttons = document.getElementById('direction-buttons');
  buttons.innerHTML = '';

  const dirNames = { north: 'Nord', south: 'Sud', east: 'Est', west: 'Ouest' };
  const typeNames = {
    start: 'Depart', bonus: 'Bonus', damage: 'Danger',
    joker: 'Joker', event: 'Event', normal: '', booster: 'Booster',
    checkpoint_red: 'CP Rouge', checkpoint_blue: 'CP Bleu',
    checkpoint_yellow: 'CP Jaune', checkpoint_green: 'CP Vert',
  };

  for (const move of moves) {
    const tile = game.board[move.tileId];
    const btn = document.createElement('button');
    btn.className = 'overlay-btn';

    let label = dirNames[move.direction] || move.direction;
    if (move.isLink) label += ' [Lien]';

    const typeName = typeNames[tile.type];
    if (typeName) label += ` - ${typeName}`;

    if (tile.owner !== null) {
      const owner = game.players.find(p => p.id === tile.owner);
      label += ` (${owner.name})`;
    }

    btn.textContent = label;
    btn.addEventListener('click', () => {
      overlay.classList.add('hidden');
      callback(move);
    });
    buttons.appendChild(btn);
  }

  overlay.classList.remove('hidden');
}

// === Selection de magie ===

function showMagicSelection() {
  const overlay = document.getElementById('magic-overlay');
  const content = document.getElementById('magic-content');
  const player = game.currentPlayer;
  const magicCards = player.hand.filter(c => c.type === CardType.MAGIC);

  content.innerHTML = `<h3>Choisir une carte Magie</h3>`;

  const cardsDiv = document.createElement('div');
  cardsDiv.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:10px 0;flex-wrap:wrap';

  for (const card of magicCards) {
    const el = document.createElement('div');
    el.className = 'card type-magic';
    el.style.width = '70px';
    el.style.height = '90px';
    el.innerHTML = `
      <div class="card-name">${card.name}</div>
      <div class="card-value">${card.value}</div>
      <div class="card-type">${card.description}</div>
    `;
    el.addEventListener('click', () => {
      // Si besoin de cible
      if (['stun', 'magnet', 'damage', 'freeze', 'confuse'].includes(card.magicEffect)) {
        showTargetSelection(card);
      } else {
        overlay.classList.add('hidden');
        game.playMagic(card.instanceId, null);
      }
    });
    cardsDiv.appendChild(el);
  }
  content.appendChild(cardsDiv);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'overlay-btn';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => overlay.classList.add('hidden'));
  content.appendChild(cancelBtn);

  overlay.classList.remove('hidden');
}

function showTargetSelection(card) {
  const overlay = document.getElementById('magic-overlay');
  const content = document.getElementById('magic-content');
  const player = game.currentPlayer;

  content.innerHTML = `<h3>Cible pour ${card.name}</h3>`;

  for (const target of game.players) {
    if (target.id === player.id) continue;
    const btn = document.createElement('button');
    btn.className = 'overlay-btn';
    btn.style.borderColor = target.color;
    btn.style.color = target.color;
    btn.textContent = target.name;
    btn.addEventListener('click', () => {
      overlay.classList.add('hidden');
      game.playMagic(card.instanceId, target.id);
    });
    content.appendChild(btn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'overlay-btn';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => overlay.classList.add('hidden'));
  content.appendChild(cancelBtn);
}

// === Victoire ===

function showVictory(winner, scores) {
  document.getElementById('winner-name').textContent = winner.name;

  const scoresEl = document.getElementById('final-scores');
  scoresEl.innerHTML = '';
  scores.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'final-score-row';
    row.innerHTML = `
      <span class="rank">#${i + 1}</span>
      <span class="name">${s.name}</span>
      <span class="score">${s.netWorth.toLocaleString()} GP</span>
    `;
    scoresEl.appendChild(row);
  });

  showScreen('victory-screen');
}

// Import necessaire pour le transfert de GP dans l'overlay
import { transferGP } from './player.js';
