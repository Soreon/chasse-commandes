// Gestionnaire principal du jeu - orchestre la boucle de jeu

import { TileType, createKeybladeBoard, updateTileValue, updateAllTolls, getBuyoutCost, getUpgradeCost, isCheckpoint, getCheckpointColor, CHECKPOINT_BONUS_GP, LAP_BONUS_GP, START_PASS_BONUS, START_STOP_BONUS, BASE_TILE_COST } from './board.js';
import { rollDie, CardType, createCard, drawRandomCards } from './cards.js';
import { createPlayer, calculateNetWorth, addGP, transferGP, refillHand, removeCardFromHand, allCheckpointsVisited, resetCheckpoints, PLAYER_COLORS, AI_NAMES } from './player.js';
import { Renderer } from './renderer.js';
import { AI } from './ai.js';

export class GameManager {
  constructor() {
    this.board = [];
    this.players = [];
    this.currentPlayerIndex = 0;
    this.turnNumber = 1;
    this.gpGoal = 7500;
    this.phase = 'idle'; // idle | magic | roll | moving | tileAction | gameOver
    this.renderer = null;
    this.animState = null;

    // Callbacks UI
    this.onUpdate = null;
    this.onLog = null;
    this.onShowOverlay = null;
    this.onHideOverlay = null;
    this.onDirectionChoice = null;
    this.onVictory = null;

    // Captain Justice/Dark
    this.captainJusticeActive = false;
    this.captainDarkActive = false;
  }

  // Initialise une nouvelle partie
  init(playerName, opponentCount, gpGoal, boardId) {
    this.gpGoal = gpGoal;
    this.board = createKeybladeBoard();

    // Creer les joueurs
    this.players = [];
    this.players.push(createPlayer(0, playerName, true, PLAYER_COLORS[0]));
    for (let i = 0; i < opponentCount; i++) {
      this.players.push(createPlayer(i + 1, AI_NAMES[i] || `IA ${i + 1}`, false, PLAYER_COLORS[i + 1]));
    }

    this.currentPlayerIndex = 0;
    this.turnNumber = 1;
    this.phase = 'magic';

    // Renderer
    const canvas = document.getElementById('board-canvas');
    this.renderer = new Renderer(canvas);

    this.render();
    this.log(`Partie lancee ! Objectif : ${this.gpGoal} GP de valeur nette.`);
    this.log(`C'est au tour de ${this.currentPlayer.name}.`);

    this.updateUI();

    // Si le premier joueur est une IA, jouer automatiquement
    if (!this.currentPlayer.isHuman) {
      this.playAITurn();
    }
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  // === PHASE 1 : MAGIE ===

  // Le joueur humain joue une carte magie
  playMagic(cardInstanceId, targetPlayerId) {
    const player = this.currentPlayer;
    const card = player.hand.find(c => c.instanceId === cardInstanceId);
    if (!card || card.type !== CardType.MAGIC) return;

    this.resolveMagicEffect(player, card, targetPlayerId);
    removeCardFromHand(player, cardInstanceId);
    this.phase = 'roll';
    this.updateUI();
  }

  // Passe la phase magie
  skipMagic() {
    this.phase = 'roll';
    this.updateUI();
  }

  resolveMagicEffect(caster, card, targetId) {
    const target = this.players.find(p => p.id === targetId);

    switch (card.magicEffect) {
      case 'stun':
        if (target) {
          target.stunned = true;
          this.log(`${caster.name} lance ${card.name} sur ${target.name} ! Tour passe.`, 'important');
        }
        break;
      case 'magnet':
        if (target) {
          target.position = caster.position;
          this.log(`${caster.name} utilise Aimant ! ${target.name} est attire.`, 'important');
        }
        break;
      case 'heal':
        addGP(caster, card.gpEffect);
        this.log(`${caster.name} utilise Soin ! +${card.gpEffect} GP.`);
        break;
      case 'damage':
        if (target) {
          addGP(target, card.gpEffect); // negatif
          this.log(`${caster.name} lance ${card.name} sur ${target.name} ! ${card.gpEffect} GP.`, 'negative');
        }
        break;
      case 'freeze':
        if (target) {
          target.frozen = true;
          this.log(`${caster.name} gele ${target.name} ! De limite a 1-3.`, 'important');
        }
        break;
      case 'confuse':
        if (target) {
          target.confused = true;
          this.log(`${caster.name} confond ${target.name} !`, 'important');
        }
        break;
      case 'scramble':
        this.scramblePositions();
        this.log(`${caster.name} utilise Zero Gravite ! Positions melangees !`, 'important');
        break;
    }
    this.render();
  }

  scramblePositions() {
    const positions = this.players.map(p => p.position);
    // Shuffle
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    this.players.forEach((p, i) => { p.position = positions[i]; });
  }

  // === PHASE 2 : LANCER DE DES ===

  // Le joueur choisit combien de des lancer (et sacrifie des cartes)
  async roll(sacrificedCardIds = []) {
    const player = this.currentPlayer;

    // Retirer les cartes sacrifiees
    for (const id of sacrificedCardIds) {
      removeCardFromHand(player, id);
    }

    const diceCount = 1 + sacrificedCardIds.length;
    let total = 0;
    const rolls = [];

    for (let i = 0; i < diceCount; i++) {
      let val = rollDie();
      if (player.frozen) {
        val = Math.min(val, 3); // Gele : max 3
      }
      rolls.push(val);
      total += val;
    }

    // Reset etats temporaires apres utilisation
    player.frozen = false;

    this.log(`${player.name} lance ${diceCount} de(s) : [${rolls.join(', ')}] = ${total}`);

    // Afficher les des puis commencer le deplacement
    this.phase = 'moving';
    this.showDice(rolls);
    await this.delay(1300);
    this.startMovement(total);
  }

  showDice(rolls) {
    const display = document.getElementById('dice-display');
    display.innerHTML = rolls.map(r => `<div class="dice">${r}</div>`).join('');
    document.getElementById('dice-overlay').classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('dice-overlay').classList.add('hidden');
    }, 1200);
  }

  // === PHASE 3 : DEPLACEMENT ===

  async startMovement(stepsRemaining) {
    const player = this.currentPlayer;

    if (stepsRemaining <= 0) {
      this.onLand();
      return;
    }

    const currentTile = this.board[player.position];
    // Obtenir les cases accessibles (pas de demi-tour)
    let possibleNext = currentTile.connections.filter(id => id !== player.previousPosition);

    // Si une seule option ou si bloque (fallback), avancer
    if (possibleNext.length === 0) {
      possibleNext = currentTile.connections;
    }

    if (possibleNext.length === 1) {
      await this.moveToTile(possibleNext[0], stepsRemaining);
    } else {
      // Intersection : demander la direction
      if (player.isHuman) {
        this.askDirection(possibleNext, stepsRemaining);
      } else {
        // IA choisit
        const choice = AI.chooseDirection(player, possibleNext, this.board, this.players);
        await this.moveToTile(choice, stepsRemaining);
      }
    }
  }

  askDirection(possibleNext, stepsRemaining) {
    if (this.onDirectionChoice) {
      this.onDirectionChoice(possibleNext, (chosenTileId) => {
        this.moveToTile(chosenTileId, stepsRemaining);
      });
    }
  }

  async moveToTile(nextTileId, stepsRemaining) {
    const player = this.currentPlayer;
    const fromTile = player.position;

    // Animation
    await this.animateMovement(fromTile, nextTileId, player);

    player.previousPosition = fromTile;
    player.position = nextTileId;

    // Effets de passage seulement si on ne s'arrete PAS ici (pas la derniere case)
    if (stepsRemaining > 1) {
      this.onPass(nextTileId);
    }

    // Verifier Captain Dark/Justice transmission
    this.checkCaptainTransfer(player);

    this.render();

    // Continuer le deplacement
    await this.startMovement(stepsRemaining - 1);
  }

  animateMovement(fromTile, toTile, player) {
    return new Promise(resolve => {
      const duration = 200; // ms
      const start = performance.now();

      const animate = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);

        this.animState = {
          active: true,
          fromTile,
          toTile,
          progress,
          color: player.color,
          name: player.name,
        };
        this.render();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          this.animState = null;
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  // Effets en passant par une case (sans s'arreter)
  onPass(tileId) {
    const tile = this.board[tileId];
    const player = this.currentPlayer;

    // Checkpoint
    if (isCheckpoint(tile.type)) {
      const color = getCheckpointColor(tile.type);
      if (color && !player.checkpoints[color]) {
        player.checkpoints[color] = true;
        addGP(player, CHECKPOINT_BONUS_GP);
        this.log(`${player.name} active le checkpoint ${color} ! +${CHECKPOINT_BONUS_GP} GP`);
      }
    }

    // Case depart (en passant)
    if (tile.type === TileType.START && tile.id !== this.board[player.previousPosition]?.id) {
      this.onPassStart(player);
    }
  }

  onPassStart(player) {
    addGP(player, START_PASS_BONUS);
    refillHand(player);
    this.log(`${player.name} passe par le Depart ! +${START_PASS_BONUS} GP, main restauree.`);

    // Lap bonus si tous les checkpoints sont actives
    if (allCheckpointsVisited(player)) {
      addGP(player, LAP_BONUS_GP);
      resetCheckpoints(player);
      this.log(`BONUS DE TOUR ! ${player.name} gagne ${LAP_BONUS_GP} GP !`, 'important');
    }
  }

  // === PHASE 4 : ACTION DE CASE (atterrissage) ===

  onLand() {
    const player = this.currentPlayer;
    const tile = this.board[player.position];

    this.phase = 'tileAction';

    // Checkpoint (si on s'arrete dessus aussi)
    if (isCheckpoint(tile.type)) {
      const color = getCheckpointColor(tile.type);
      if (color && !player.checkpoints[color]) {
        player.checkpoints[color] = true;
        addGP(player, CHECKPOINT_BONUS_GP);
        this.log(`${player.name} active le checkpoint ${color} ! +${CHECKPOINT_BONUS_GP} GP`);
      }
    }

    // Case depart - arret
    if (tile.type === TileType.START) {
      this.handleStartTile(player);
      return;
    }

    // Case normale
    if (tile.type === TileType.NORMAL) {
      if (tile.owner === null) {
        this.handleEmptyTile(player, tile);
        return;
      } else if (tile.owner === player.id) {
        this.handleOwnTile(player, tile);
        return;
      } else {
        this.handleEnemyTile(player, tile);
        return;
      }
    }

    // Cases speciales
    if (tile.type === TileType.BONUS) {
      this.handleBonusTile(player);
      return;
    }
    if (tile.type === TileType.DAMAGE) {
      this.handleDamageTile(player);
      return;
    }
    if (tile.type === TileType.JOKER) {
      this.handleJokerTile(player);
      return;
    }
    if (tile.type === TileType.EVENT) {
      this.handleEventTile(player);
      return;
    }

    // Checkpoints et autres - fin de tour directe
    this.endTurn();
  }

  handleStartTile(player) {
    addGP(player, START_STOP_BONUS);
    refillHand(player);
    this.log(`${player.name} s'arrete sur le Depart ! +${START_STOP_BONUS} GP, main restauree.`, 'important');

    if (allCheckpointsVisited(player)) {
      addGP(player, LAP_BONUS_GP);
      resetCheckpoints(player);
      this.log(`BONUS DE TOUR ! +${LAP_BONUS_GP} GP !`, 'important');
    }

    // Verifier victoire
    const netWorth = calculateNetWorth(player, this.board);
    if (netWorth >= this.gpGoal) {
      this.victory(player);
      return;
    }

    this.endTurn();
  }

  handleEmptyTile(player, tile) {
    const cost = tile.baseValue;

    if (player.isHuman) {
      const nonMagicCards = player.hand.filter(c => c.type !== CardType.MAGIC);
      if (player.gp >= cost && nonMagicCards.length > 0) {
        this.showTileAction('buy', tile, player);
      } else {
        if (player.gp < cost) this.log(`Pas assez de GP pour acheter cette case (${cost} GP).`);
        if (nonMagicCards.length === 0) this.log(`Pas de carte a placer sur cette case.`);
        this.endTurn();
      }
    } else {
      // IA decide
      if (AI.shouldBuyTile(player, tile, this.board)) {
        const card = AI.chooseCardToPlace(player);
        this.buyTile(player, tile, card);
      }
      this.endTurn();
    }
  }

  handleOwnTile(player, tile) {
    const cost = getUpgradeCost(tile);

    if (player.isHuman) {
      if (player.gp >= cost && tile.level < 5) {
        this.showTileAction('upgrade', tile, player);
      } else {
        this.endTurn();
      }
    } else {
      if (AI.shouldUpgradeTile(player, tile)) {
        this.upgradeTile(player, tile);
      }
      this.endTurn();
    }
  }

  handleEnemyTile(player, tile) {
    const owner = this.players.find(p => p.id === tile.owner);
    let tollAmount = tile.tollValue;

    // Bouclier de peage
    if (player.tollShield) {
      tollAmount = Math.floor(tollAmount / 2);
      player.tollShield = false;
      this.log(`Bouclier actif ! Peage reduit de 50%.`);
    }

    // Reflet de peage
    if (player.tollReflect) {
      player.tollReflect = false;
      addGP(owner, -tollAmount);
      this.log(`Reflet actif ! ${owner.name} paye ${tollAmount} GP au lieu de ${player.name} !`, 'important');
      this.endTurn();
      return;
    }

    if (player.isHuman) {
      this.showTileAction('toll', tile, player);
    } else {
      // IA paye le peage ou rachete
      if (AI.shouldBuyout(player, tile)) {
        this.buyoutTile(player, tile, owner);
      } else {
        const actual = transferGP(player, owner, tollAmount);
        this.log(`${player.name} paye ${actual} GP de peage a ${owner.name}.`, 'negative');
      }
      this.endTurn();
    }
  }

  // Acheter une case
  buyTile(player, tile, card) {
    addGP(player, -tile.baseValue);
    removeCardFromHand(player, card.instanceId);
    tile.owner = player.id;
    tile.cardPlaced = card;
    tile.level = 1;
    updateTileValue(this.board, tile.id);
    updateAllTolls(this.board);
    this.log(`${player.name} achete la case ${tile.id} pour ${tile.baseValue} GP ! (${card.name} placee)`, 'important');
    this.render();
  }

  // Ameliorer une case
  upgradeTile(player, tile) {
    const cost = getUpgradeCost(tile);
    addGP(player, -cost);
    tile.level++;
    updateTileValue(this.board, tile.id);
    updateAllTolls(this.board);
    this.log(`${player.name} ameliore la case ${tile.id} au niveau ${tile.level} pour ${cost} GP !`);
    this.render();
  }

  // Rachat force
  buyoutTile(player, tile, previousOwner) {
    const cost = getBuyoutCost(tile);
    transferGP(player, previousOwner, cost);
    tile.owner = player.id;
    tile.level = 1;
    updateTileValue(this.board, tile.id);
    updateAllTolls(this.board);
    this.log(`${player.name} rachete de force la case ${tile.id} pour ${cost} GP !`, 'important');
    this.render();
  }

  // === CASES SPECIALES ===

  handleBonusTile(player) {
    const bonusType = Math.random();
    if (bonusType < 0.5) {
      const amount = 100 + Math.floor(Math.random() * 300);
      addGP(player, amount);
      this.log(`Case Bonus ! ${player.name} gagne ${amount} GP !`, 'important');
    } else {
      const cards = drawRandomCards(1);
      if (player.hand.length < 5) {
        player.hand.push(cards[0]);
        this.log(`Case Bonus ! ${player.name} recoit la carte ${cards[0].name} !`, 'important');
      } else {
        const amount = 150;
        addGP(player, amount);
        this.log(`Case Bonus ! Main pleine, ${player.name} gagne ${amount} GP a la place.`);
      }
    }

    if (player.isHuman) {
      this.showEventResult(`Case Bonus !`, () => this.endTurn());
    } else {
      this.endTurn();
    }
  }

  handleDamageTile(player) {
    const damage = 100 + Math.floor(Math.random() * 200);
    addGP(player, -damage);
    this.log(`Case Degats ! ${player.name} perd ${damage} GP !`, 'negative');

    if (player.isHuman) {
      this.showEventResult(`Degats ! -${damage} GP`, () => this.endTurn());
    } else {
      this.endTurn();
    }
  }

  handleJokerTile(player) {
    const events = [
      () => {
        addGP(player, 500);
        this.log(`Joker ! Tresor trouve ! +500 GP !`, 'important');
        return 'Tresor ! +500 GP';
      },
      () => {
        addGP(player, -300);
        this.log(`Joker ! Piege ! -300 GP !`, 'negative');
        return 'Piege ! -300 GP';
      },
      () => {
        // Teleporter au depart
        player.position = 0;
        this.log(`Joker ! Teleportation au depart !`, 'important');
        return 'Teleportation au depart !';
      },
      () => {
        // Voler GP a un adversaire
        const target = this.players.find(p => p.id !== player.id && p.gp > 0);
        if (target) {
          const stolen = Math.min(200, target.gp);
          transferGP(target, player, stolen);
          this.log(`Joker ! ${player.name} vole ${stolen} GP a ${target.name} !`, 'important');
          return `Vol ! +${stolen} GP de ${target.name}`;
        }
        return 'Rien ne se passe...';
      },
      () => {
        // Captain Justice apparait
        if (!this.captainJusticeActive) {
          player.hasJustice = true;
          this.captainJusticeActive = true;
          this.log(`Captain Justice rejoint ${player.name} !`, 'important');
          return 'Captain Justice vous rejoint !';
        }
        addGP(player, 200);
        return 'Bonus ! +200 GP';
      },
      () => {
        // Captain Dark apparait
        if (!this.captainDarkActive) {
          player.hasDark = true;
          this.captainDarkActive = true;
          this.log(`Captain Dark s'attache a ${player.name} !`, 'negative');
          return 'Captain Dark vous hante !';
        }
        addGP(player, -150);
        return 'Malchance ! -150 GP';
      },
    ];

    const event = events[Math.floor(Math.random() * events.length)];
    const message = event();

    if (player.isHuman) {
      this.showEventResult(message, () => this.endTurn());
    } else {
      this.endTurn();
    }
  }

  handleEventTile(player) {
    // Evenement specifique au plateau
    const events = [
      () => {
        // Tous les joueurs gagnent 100 GP
        this.players.forEach(p => addGP(p, 100));
        this.log(`Evenement ! Tous les joueurs gagnent 100 GP !`, 'important');
        return 'Tous les joueurs gagnent 100 GP !';
      },
      () => {
        // Peages doubles pour 3 tours (simplifie : peages x2 maintenant)
        this.players.forEach(p => {
          // Doubler temporairement les valeurs des cases possedees
        });
        addGP(player, 200);
        this.log(`Evenement ! Bonus de 200 GP !`);
        return 'Bonus evenement : +200 GP';
      },
      () => {
        // Echange de position avec un adversaire aleatoire
        const target = this.players.find(p => p.id !== player.id);
        if (target) {
          const temp = player.position;
          player.position = target.position;
          target.position = temp;
          this.log(`Evenement ! ${player.name} et ${target.name} echangent leurs positions !`, 'important');
          return `Echange de position avec ${target.name} !`;
        }
        return 'Rien ne se passe.';
      },
    ];

    const event = events[Math.floor(Math.random() * events.length)];
    const message = event();

    if (player.isHuman) {
      this.showEventResult(message, () => this.endTurn());
    } else {
      this.endTurn();
    }
  }

  // === CAPTAIN JUSTICE / DARK ===

  checkCaptainTransfer(player) {
    // Transfert de Captain Dark en croisant un autre joueur
    if (player.hasDark) {
      for (const other of this.players) {
        if (other.id !== player.id && other.position === player.position) {
          player.hasDark = false;
          other.hasDark = true;
          this.log(`Captain Dark passe de ${player.name} a ${other.name} !`, 'important');
          break;
        }
      }
    }
  }

  applyCaptainEffects(player) {
    if (player.hasJustice) {
      addGP(player, 50);
      this.log(`Captain Justice donne 50 GP a ${player.name}.`);
    }
    if (player.hasDark) {
      addGP(player, -75);
      this.log(`Captain Dark vole 75 GP a ${player.name} !`, 'negative');
    }
  }

  // === FIN DE TOUR ===

  endTurn() {
    // Appliquer les effets Captain
    this.applyCaptainEffects(this.currentPlayer);

    // Verifier victoire (le joueur doit etre sur le depart)
    const player = this.currentPlayer;
    const netWorth = calculateNetWorth(player, this.board);
    if (netWorth >= this.gpGoal && player.position === 0) {
      this.victory(player);
      return;
    }

    // Joueur suivant
    this.nextPlayer();
  }

  nextPlayer() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;

    // Nouveau tour si on revient au premier joueur
    if (this.currentPlayerIndex === 0) {
      this.turnNumber++;
    }

    const player = this.currentPlayer;

    // Verifier si le joueur est etourdi
    if (player.stunned) {
      player.stunned = false;
      this.log(`${player.name} est etourdi et passe son tour.`);
      this.nextPlayer();
      return;
    }

    this.phase = 'magic';
    this.log(`--- Tour de ${player.name} ---`);
    this.render();
    this.updateUI();

    // IA joue automatiquement
    if (!player.isHuman) {
      setTimeout(() => this.playAITurn(), 800);
    }
  }

  // === TOUR IA ===

  async playAITurn() {
    const player = this.currentPlayer;

    // Phase magie
    const magicChoice = AI.chooseMagicCard(player, this.players);
    if (magicChoice) {
      const card = magicChoice.card || magicChoice;
      const targetId = magicChoice.targetId ?? AI.chooseTarget(player, this.players)?.id;
      if (targetId !== undefined) {
        this.resolveMagicEffect(player, card, targetId);
        removeCardFromHand(player, card.instanceId);
      }
    }

    await this.delay(500);

    // Phase lancer
    const sacrificed = AI.chooseDiceCards(player);
    this.phase = 'roll';
    this.roll(sacrificed);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // === VICTOIRE ===

  victory(player) {
    this.phase = 'gameOver';
    this.log(`${player.name} a gagne la partie !`, 'important');

    if (this.onVictory) {
      const scores = this.players
        .map(p => ({ name: p.name, netWorth: calculateNetWorth(p, this.board), gp: p.gp }))
        .sort((a, b) => b.netWorth - a.netWorth);
      this.onVictory(player, scores);
    }
  }

  // === UI HELPERS ===

  showTileAction(actionType, tile, player) {
    if (this.onShowOverlay) {
      this.onShowOverlay(actionType, tile, player, this.board);
    }
  }

  showEventResult(message, callback) {
    if (this.onShowOverlay) {
      this.onShowOverlay('event', { message }, this.currentPlayer, this.board, callback);
    }
  }

  render() {
    if (this.renderer) {
      this.renderer.render(this.board, this.players, this.currentPlayer?.id, this.animState);
    }
  }

  updateUI() {
    if (this.onUpdate) {
      this.onUpdate(this);
    }
  }

  log(message, type = '') {
    if (this.onLog) {
      this.onLog(message, type);
    }
  }
}
