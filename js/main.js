// Point d'entree principal - connecte le GameManager a l'UI

import { GameManager } from './gameManager.js';
import { CardType, getAvailableHands, canPlaceOnTile } from './cards.js';
import { getBuyoutCost, getUpgradeCost, parseBoardJSON } from './board.js';
import { calculateNetWorth, transferGP, addGP } from './player.js';

const game = new GameManager();

// === Chargement des plateaux depuis boards.json ===
let boardsData = {};

async function loadBoards() {
  try {
    const resp = await fetch('boards.json');
    boardsData = await resp.json();
    const select = document.getElementById('board-select');
    select.innerHTML = '';
    for (const name of Object.keys(boardsData).reverse()) {
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

  const boardEntry = boardsData[boardName];
  if (!boardEntry) {
    alert('Plateau introuvable !');
    return;
  }

  const boardData = parseBoardJSON(boardEntry);
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

  game.init(playerName, opponentCount, gpGoal, boardData, spectator, boardName);
});

// === Noms des types de cartes ===
const CARD_TYPE_LABELS = {
  [CardType.ATTACK]: 'Attaque',
  [CardType.MAGIC]: 'Magie',
  [CardType.MISC]: 'Divers',
  [CardType.JOKER]: 'Joker',
};

// === Affichage de la main ===

function renderHand(player) {
  const container = document.getElementById('hand-cards');
  container.innerHTML = '';

  for (const card of player.hand) {
    const el = document.createElement('div');
    el.className = `card type-${card.type}`;
    el.dataset.instanceId = card.instanceId;
    el.innerHTML = `
      <div class="card-name">${card.name}</div>
      <div class="card-value">${card.value}</div>
      <div class="card-type">${CARD_TYPE_LABELS[card.type] || card.type}</div>
    `;
    el.title = card.description;
    container.appendChild(el);
  }
}

// === Boutons d'action ===

document.getElementById('btn-roll').addEventListener('click', () => {
  if (game.phase !== 'roll') return;
  disableActions();
  game.roll();
});

document.getElementById('btn-use-magic').addEventListener('click', () => {
  if (game.phase !== 'hand') return;
  showHandSelection();
});

document.getElementById('btn-end-turn').addEventListener('click', () => {
  if (game.phase === 'hand') {
    game.skipHand();
  }
});

function disableActions() {
  document.getElementById('btn-roll').disabled = true;
  document.getElementById('btn-use-magic').disabled = true;
  document.getElementById('btn-end-turn').disabled = true;
}

function enableActions() {
  const player = game.currentPlayer;
  if (!player.isHuman) {
    disableActions();
    return;
  }

  if (game.phase === 'hand') {
    const hasHands = getAvailableHands(player.hand).length > 0;
    document.getElementById('btn-roll').disabled = true;
    document.getElementById('btn-use-magic').disabled = !hasHands;
    document.getElementById('btn-use-magic').textContent = 'Jouer une Main';
    document.getElementById('btn-end-turn').disabled = false;
    document.getElementById('btn-end-turn').textContent = 'Passer';
  } else if (game.phase === 'roll') {
    document.getElementById('btn-roll').disabled = false;
    document.getElementById('btn-roll').textContent = game.activeHandEffect === 'two_dice' ? 'Lancer (2 des)' :
      game.activeHandEffect === 'three_dice' ? 'Lancer (3 des)' : 'Lancer (1 de)';
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
      if (el) el.classList.toggle('active', human.checkpoints[color]);
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
  const log = document.getElementById('message-log');
  log.scrollTop = log.scrollHeight;

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
    const placeableCards = player.hand.filter(c => canPlaceOnTile(c));
    content.innerHTML = `
      <h3>Acheter cette case ?</h3>
      <p>Cout : <span class="gp-amount">${tile.baseValue} GP</span></p>
      ${tile.zone ? `<p>Zone : ${tile.zone}</p>` : ''}
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

    for (const card of placeableCards) {
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
    let tollAmount = tile.tollValue;
    if (owner.doubleTollTurns > 0) tollAmount *= 2;
    const buyoutCost = getBuyoutCost(tile);
    const canBuyout = player.gp >= buyoutCost;

    content.innerHTML = `
      <h3>Peage !</h3>
      <p>Case de <strong style="color:${owner.color}">${owner.name}</strong> (Nv.${tile.level})</p>
      <p>Peage : <span class="gp-amount">${tollAmount} GP</span></p>
      ${player.gpProtector > 0 ? '<p style="color:#50e890">Protecteur GP actif !</p>' : ''}
      <div>
        <button class="overlay-btn danger" id="btn-pay-toll">Payer le peage</button>
        ${canBuyout ? `<button class="overlay-btn confirm" id="btn-buyout">Racheter (${buyoutCost} GP)</button>` : ''}
      </div>
    `;
    overlay.classList.remove('hidden');

    content.querySelector('#btn-pay-toll').addEventListener('click', () => {
      overlay.classList.add('hidden');
      if (player.gpProtector > 0) {
        player.gpProtector--;
        game.log(`Protecteur GP actif ! Peage bloque.`, 'important');
      } else {
        const actual = transferGP(player, owner, tollAmount);
        game.log(`${player.name} paye ${actual} GP de peage a ${owner.name}.`, 'negative');
      }
      game.endTurn();
    });

    if (canBuyout) {
      content.querySelector('#btn-buyout').addEventListener('click', () => {
        overlay.classList.add('hidden');
        game.buyoutTile(player, tile, owner);
        game.endTurn();
      });
    }

  } else if (type === 'bonus') {
    // Nouveau comportement : acheter une commande predeterminee
    content.innerHTML = `
      <h3>Case Bonus !</h3>
      <p>Commande disponible : <strong>${tile.bonusCard.name}</strong> (${CARD_TYPE_LABELS[tile.bonusCard.type]})</p>
      <p>Cout : <span class="gp-amount">${tile.bonusCost} GP</span></p>
      <div>
        <button class="overlay-btn confirm" id="btn-buy-bonus">Acheter</button>
        <button class="overlay-btn" id="btn-skip-bonus">Passer</button>
      </div>
    `;
    overlay.classList.remove('hidden');

    content.querySelector('#btn-buy-bonus').addEventListener('click', () => {
      overlay.classList.add('hidden');
      addGP(player, -tile.bonusCost);
      player.hand.push(tile.bonusCard);
      if (player.hand.length > 5) player.hand.pop();
      game.log(`${player.name} achete ${tile.bonusCard.name} pour ${tile.bonusCost} GP !`, 'important');
      game.endTurn();
    });
    content.querySelector('#btn-skip-bonus').addEventListener('click', () => {
      overlay.classList.add('hidden');
      game.endTurn();
    });

  } else if (type === 'forcedSale') {
    // tile contient { player, board } ici
    const salePlayer = tile.player;
    const ownedTiles = board.filter(t => t.owner === salePlayer.id && t.level > 0);

    content.innerHTML = `
      <h3>Vente forcee !</h3>
      <p>Vos GP sont negatifs : <span class="gp-amount" style="color:var(--accent-red)">${salePlayer.gp} GP</span></p>
      <p>Choisissez une case a vendre :</p>
      <div id="forced-sale-tiles" style="display:flex;gap:8px;justify-content:center;margin:10px 0;flex-wrap:wrap"></div>
    `;
    overlay.classList.remove('hidden');

    const tilesContainer = content.querySelector('#forced-sale-tiles');
    for (const t of ownedTiles) {
      const el = document.createElement('button');
      el.className = 'overlay-btn danger';
      el.style.cssText = 'padding:8px 12px;text-align:center';
      el.innerHTML = `Case ${t.id}<br><small>Nv.${t.level} - ${t.currentValue} GP</small>`;
      el.addEventListener('click', () => {
        overlay.classList.add('hidden');
        game.sellTile(salePlayer, t);
        if (callback) callback();
      });
      tilesContainer.appendChild(el);
    }

  } else if (type === 'teleportChoice') {
    // Keyblade Glider : choisir une case de destination
    const tiles = tile.tiles;
    const typeNames = {
      start: 'Depart', bonus: 'Bonus', damage: 'Danger', event: 'Special',
      normal: 'Commande', booster: 'Booster',
      checkpoint_red: 'CP Rouge', checkpoint_blue: 'CP Bleu',
      checkpoint_yellow: 'CP Jaune', checkpoint_green: 'CP Vert',
    };

    content.innerHTML = `
      <h3>Keyblade Glider !</h3>
      <p>Choisissez une case de destination :</p>
      <div id="teleport-tiles" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin:10px 0;max-height:300px;overflow-y:auto"></div>
    `;
    overlay.classList.remove('hidden');

    const container = content.querySelector('#teleport-tiles');
    // Filtrer les cases interessantes (pas vides)
    const interestingTiles = tiles.filter(t => t.type !== 'normal' || t.owner !== null);
    const displayTiles = interestingTiles.length > 0 ? interestingTiles : tiles;

    for (const t of displayTiles) {
      const el = document.createElement('button');
      el.className = 'overlay-btn';
      el.style.cssText = 'padding:6px 10px;font-size:0.8rem';
      const typeName = typeNames[t.type] || t.type;
      let label = `${typeName} #${t.id}`;
      if (t.owner !== null) {
        const ownerP = game.players.find(p => p.id === t.owner);
        label += ` (${ownerP?.name})`;
      }
      el.textContent = label;
      el.addEventListener('click', () => {
        overlay.classList.add('hidden');
        if (callback) callback(t.id);
      });
      container.appendChild(el);
    }

  } else if (type === 'pixieDust') {
    // Pixie Dust : choisir un adversaire puis une case
    const opponents = tile.players.filter(p => p.id !== player.id);

    content.innerHTML = `
      <h3>Pixie Dust !</h3>
      <p>Choisissez un adversaire a deplacer :</p>
      <div id="pixie-targets" style="display:flex;gap:8px;justify-content:center;margin:10px 0"></div>
    `;
    overlay.classList.remove('hidden');

    const targetsContainer = content.querySelector('#pixie-targets');
    for (const opp of opponents) {
      const btn = document.createElement('button');
      btn.className = 'overlay-btn';
      btn.style.borderColor = opp.color;
      btn.style.color = opp.color;
      btn.textContent = opp.name;
      btn.addEventListener('click', () => {
        // Phase 2 : choisir la destination
        showPixieDustDestination(overlay, content, opp, tile.tiles, callback);
      });
      targetsContainer.appendChild(btn);
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

function showPixieDustDestination(overlay, content, target, tiles, callback) {
  const typeNames = {
    start: 'Depart', bonus: 'Bonus', damage: 'Danger', event: 'Special',
    normal: 'Commande', booster: 'Booster',
    checkpoint_red: 'CP Rouge', checkpoint_blue: 'CP Bleu',
    checkpoint_yellow: 'CP Jaune', checkpoint_green: 'CP Vert',
  };

  content.innerHTML = `
    <h3>Envoyer ${target.name} ou ?</h3>
    <div id="pixie-dest" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin:10px 0;max-height:300px;overflow-y:auto"></div>
  `;

  const container = content.querySelector('#pixie-dest');
  // Montrer d'abord les cases de degats et les cases avec peage
  const sorted = [...tiles].sort((a, b) => {
    const scoreA = a.type === 'damage' ? 100 : (a.tollValue || 0);
    const scoreB = b.type === 'damage' ? 100 : (b.tollValue || 0);
    return scoreB - scoreA;
  });

  for (const t of sorted.slice(0, 30)) {
    const el = document.createElement('button');
    el.className = 'overlay-btn';
    if (t.type === 'damage') el.classList.add('danger');
    el.style.cssText = 'padding:6px 10px;font-size:0.8rem';
    const typeName = typeNames[t.type] || t.type;
    let label = `${typeName} #${t.id}`;
    if (t.tollValue > 0) {
      const ownerP = game.players.find(p => p.id === t.owner);
      label += ` (${t.tollValue}G - ${ownerP?.name})`;
    }
    el.textContent = label;
    el.addEventListener('click', () => {
      overlay.classList.add('hidden');
      if (callback) callback(target.id, t.id);
    });
    container.appendChild(el);
  }
}

// === Selection de main de cartes ===

function showHandSelection() {
  const overlay = document.getElementById('magic-overlay');
  const content = document.getElementById('magic-content');
  const player = game.currentPlayer;
  const availableHands = getAvailableHands(player.hand);

  content.innerHTML = `<h3>Choisir une Main</h3>`;

  const handsDiv = document.createElement('div');
  handsDiv.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin:10px 0;max-height:300px;overflow-y:auto';

  for (const handDef of availableHands) {
    const el = document.createElement('button');
    el.className = 'overlay-btn';
    el.style.cssText = 'text-align:left;padding:8px 12px';

    const reqText = handDef.requiredCards
      .map(r => `${r.count}x ${CARD_TYPE_LABELS[r.type]}`)
      .join(' + ');

    el.innerHTML = `<strong>${handDef.name}</strong> <small>(${reqText})</small><br><small>${handDef.description}</small>`;

    el.addEventListener('click', () => {
      if (handDef.needsTarget) {
        showHandTargetSelection(handDef);
      } else {
        overlay.classList.add('hidden');
        game.playHand(handDef.type, undefined);
      }
    });
    handsDiv.appendChild(el);
  }
  content.appendChild(handsDiv);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'overlay-btn';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => overlay.classList.add('hidden'));
  content.appendChild(cancelBtn);

  overlay.classList.remove('hidden');
}

function showHandTargetSelection(handDef) {
  const overlay = document.getElementById('magic-overlay');
  const content = document.getElementById('magic-content');
  const player = game.currentPlayer;

  content.innerHTML = `<h3>Cible pour ${handDef.name}</h3>`;

  for (const target of game.players) {
    if (target.id === player.id) continue;
    const btn = document.createElement('button');
    btn.className = 'overlay-btn';
    btn.style.borderColor = target.color;
    btn.style.color = target.color;
    btn.textContent = target.name;
    btn.addEventListener('click', () => {
      overlay.classList.add('hidden');
      game.playHand(handDef.type, target.id);
    });
    content.appendChild(btn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'overlay-btn';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => overlay.classList.add('hidden'));
  content.appendChild(cancelBtn);
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
