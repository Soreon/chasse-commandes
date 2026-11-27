// Moteur de jeu : règles et déroulé d'une partie, sans DOM ni minuterie.
//
// Le moteur avance jusqu'à avoir besoin de l'extérieur, puis s'arrête sur `game.pending` :
//   - { kind: 'decision', type, playerId, ... } : un joueur doit choisir (humain ou IA) ;
//     on reprend avec `game.resume(choix)`.
//   - { kind: 'effect', type, ... } : quelque chose est à montrer (dé, déplacement, message) ;
//     on reprend avec `game.resume()` une fois l'animation jouée (ou tout de suite en simulation).
// Les journaux et notifications s'accumulent dans `game.events` (à vider avec `takeEvents()`).
//
// Une partie est entièrement déterminée par sa graine et la suite des choix.

import { RULES } from './config.js';
import { createRng } from './rng.js';
import { Journal } from './journal.js';
import {
  TileType, parseBoardJSON, getAvailableMoves, updateAllTolls,
  getBuyCost, getBuyoutCost, getUpgradeCost, isCheckpoint, getCheckpointColor,
} from './board.js';
import {
  CARD_DEFINITIONS, HandType, getHandDef, getAvailableHands, canFormHand, selectCardsForHand, canPlaceOnTile,
  createStartingHand, drawRandomCards, rollDie,
} from './cards.js';
import {
  createPlayer, calculateNetWorth, removeCardFromHand, allCheckpointsVisited, resetCheckpoints,
} from './player.js';

export const SAVE_VERSION = 1;

// Plateaux dont la case Événement est le Keyblade Glider (téléportation au choix)
export const GLIDER_BOARDS = ['Keyblade', 'Secret'];

const CHECKPOINT_LABELS = { red: 'rouge', blue: 'bleu', yellow: 'jaune', green: 'vert' };

export class Game {
  // players : [{ name, isHuman, color }]
  constructor({ boardEntry, boardName = '', players, gpGoal = 7500, seed = 1 }) {
    this.boardEntry = boardEntry;
    this.boardName = boardName;
    this.gpGoal = gpGoal;
    this.seed = seed >>> 0;
    this.rng = createRng(this.seed);
    this.nextCardId = 1;

    // Journal détaillé de la partie (voir journal.js) ; `meta` permet de la recréer à l'identique
    this.journal = new Journal();
    this.journal.turnOf = () => this.turnNumber;
    this.journal.meta = {
      setup: {
        boardEntry, boardName, gpGoal, seed: this.seed,
        players: players.map(p => ({ name: p.name, isHuman: !!p.isHuman, color: p.color })),
      },
      rules: { ...RULES },
    };
    this._nextId = () => `c${this.nextCardId++}`;

    this.boardData = parseBoardJSON(boardEntry);
    this.tiles = this.boardData.tiles;
    this.startTileId = this.boardData.startTileId;

    // Cases Bonus : une carte y est déjà posée. On achète la case sans rien dépenser de sa main.
    const presets = CARD_DEFINITIONS.filter(c => canPlaceOnTile(c) && c.value >= RULES.bonusMinCardValue);
    for (const tile of this.tiles) {
      if (tile.type === TileType.BONUS) {
        tile.presetCard = { ...this.rng.pick(presets), instanceId: `bonus${tile.id}` };
      }
    }

    this.players = players.map((p, i) => {
      const player = createPlayer(i, p.name, !!p.isHuman, p.color, createStartingHand(this._nextId));
      player.position = this.startTileId;
      return player;
    });

    this.currentPlayerIndex = 0;
    this.turnNumber = 1;
    this.activeHandEffect = null; // main en cours d'effet pour ce tour (dés, Navigateur)

    // Prize Cubes : un par case de dégâts marquée `hasDice`
    this.prizeCubes = this.tiles
      .filter(t => t.type === TileType.DAMAGE && t.hasDice)
      .map((t, i) => ({
        id: i,
        sourceTileId: t.id,
        tileId: t.id,
        counter: RULES.cubeCounter,
        accumulatedGP: RULES.cubeBaseGP,
        riderId: null,
      }));

    this.honeyPots = [];      // { tileId, isGood }
    this.sparkyEffect = null; // { playerId, turnsLeft }

    this.over = false;
    this.winnerId = null;
    this.winReason = null;    // 'goal' | 'lastStanding'

    this.pending = null;
    this.events = [];
    // Mouvements de GP par origine et compteurs d'actions (pour la simulation et l'équilibrage)
    this.stats = { flow: {}, count: {} };

    this._gen = null;
    this._restored = false;
  }

  // === Pilotage ===

  start() {
    this._gen = this._run();
    return this._advance();
  }

  resume(choice) {
    if (!this._gen) throw new Error('Game.start() doit être appelé avant resume()');
    return this._advance(choice);
  }

  _advance(value) {
    const answered = this.pending;
    if (answered && answered.kind === 'decision') {
      // L'état du hasard est noté avec le choix : c'est ce qui permet de rejouer la partie
      this.journal.add('choice', {
        request: answered.type,
        playerId: answered.playerId,
        human: this.players[answered.playerId].isHuman,
        value: value === undefined ? null : value,
        rng: this.rng.getState(),
      });
    }

    const result = this._gen.next(value);
    this.pending = result.done ? null : result.value;
    if (this.pending) this.journal.add('request', { request: this.pending });
    return this.pending;
  }

  takeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  // === Accès à l'état ===

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  get captainJusticeActive() {
    return this.players.some(p => p.justiceTurns > 0);
  }

  get captainDarkActive() {
    return this.players.some(p => p.darkTurns > 0);
  }

  netWorth(player) {
    return calculateNetWorth(player, this.tiles);
  }

  opponentsOf(player) {
    return this.players.filter(p => p.id !== player.id && !p.eliminated);
  }

  cubeOf(playerId) {
    return this.prizeCubes.find(c => c.riderId === playerId) || null;
  }

  freeCubeAt(tileId) {
    return this.prizeCubes.find(c => c.tileId === tileId && c.riderId === null) || null;
  }

  diceCount() {
    if (this.activeHandEffect === HandType.THREE_DICE) return 3;
    if (this.activeHandEffect === HandType.TWO_DICE) return 2;
    return 1;
  }

  // Instantané complet de l'état, noté au journal à chaque début de tour
  snapshot() {
    return {
      turn: this.turnNumber,
      current: this.currentPlayerIndex,
      rng: this.rng.getState(),
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        gp: p.gp,
        net: this.netWorth(p),
        position: p.position,
        lastDirection: p.lastDirection,
        hand: p.hand.map(c => `${c.id}:${c.value}`),
        checkpoints: Object.keys(p.checkpoints).filter(color => p.checkpoints[color]),
        stunned: p.stunned,
        confusedTurns: p.confusedTurns,
        gpProtector: p.gpProtector,
        doubleTollTurns: p.doubleTollTurns,
        justiceTurns: p.justiceTurns,
        darkTurns: p.darkTurns,
        boosterPercent: p.boosterPercent,
        eliminated: p.eliminated,
      })),
      tiles: this.tiles.filter(t => t.owner !== null).map(t => ({
        id: t.id, owner: t.owner, level: t.level, card: t.cardPlaced ? t.cardPlaced.id : null, value: t.currentValue, toll: t.tollValue,
      })),
      cubes: this.prizeCubes.map(c => ({ id: c.id, tile: c.tileId, counter: c.counter, gp: c.accumulatedGP, rider: c.riderId })),
      honeyPots: this.honeyPots.map(p => `${p.tileId}:${p.isGood ? 'bon' : 'piège'}`),
      sparky: this.sparkyEffect,
    };
  }

  getScores() {
    return this.players
      .map(p => ({ id: p.id, name: p.name, color: p.color, gp: p.gp, netWorth: this.netWorth(p), eliminated: p.eliminated }))
      .sort((a, b) => (a.eliminated - b.eliminated) || (b.netWorth - a.netWorth));
  }

  // === Sauvegarde ===
  // À n'appeler que lorsque `pending` est l'effet 'turnStart' : c'est le seul moment où
  // tout l'état de la partie tient dans les données (rien en cours dans le déroulé du tour).

  serialize() {
    return JSON.parse(JSON.stringify({
      version: SAVE_VERSION,
      boardEntry: this.boardEntry,
      boardName: this.boardName,
      gpGoal: this.gpGoal,
      seed: this.seed,
      rngState: this.rng.getState(),
      nextCardId: this.nextCardId,
      currentPlayerIndex: this.currentPlayerIndex,
      turnNumber: this.turnNumber,
      players: this.players,
      tiles: this.tiles.map(t => ({ owner: t.owner, level: t.level, cardPlaced: t.cardPlaced, presetCard: t.presetCard })),
      prizeCubes: this.prizeCubes,
      honeyPots: this.honeyPots,
      sparkyEffect: this.sparkyEffect,
      stats: this.stats,
    }));
  }

  static restore(data) {
    if (!data || data.version !== SAVE_VERSION) throw new Error('Sauvegarde illisible');
    const game = new Game({
      boardEntry: data.boardEntry,
      boardName: data.boardName,
      gpGoal: data.gpGoal,
      seed: data.seed,
      players: data.players.map(p => ({ name: p.name, isHuman: p.isHuman, color: p.color })),
    });
    if (data.tiles.length !== game.tiles.length) throw new Error('Sauvegarde incompatible avec le plateau');

    game.rng.setState(data.rngState);
    game.nextCardId = data.nextCardId;
    game.currentPlayerIndex = data.currentPlayerIndex;
    game.turnNumber = data.turnNumber;
    game.players = data.players;
    data.tiles.forEach((saved, i) => Object.assign(game.tiles[i], saved));
    updateAllTolls(game.tiles);
    game.prizeCubes = data.prizeCubes;
    game.honeyPots = data.honeyPots;
    game.sparkyEffect = data.sparkyEffect;
    game.stats = data.stats || { flow: {}, count: {} };
    game._restored = true;
    // Le journal d'une partie reprise repart de la sauvegarde, pas du début de la partie
    game.journal.meta.restore = JSON.parse(JSON.stringify(data));
    return game;
  }

  // === Petits outils internes ===

  log(message, style = '') {
    this.events.push({ type: 'log', message, style });
    this.journal.add('log', { message, style });
  }

  notif(icon, text, style = 'info') {
    this.events.push({ type: 'notif', icon, text, style });
    this.journal.add('notif', { icon, text, style });
  }

  // Annonce à montrer à l'écran : qui fait quoi, et avec quel effet.
  // `tileIds` : cases qui changent de mains à distance (l'interface s'y rend et montre l'arrivée
  // du nouveau propriétaire). `random` : effet tiré au hasard, que même son auteur découvre.
  // `fx` : effet visuel à jouer pendant l'annonce ({ type, ... }, voir la vue 3D).
  _announce(player, icon, title, text, { tileIds = null, random = false, fx = null } = {}) {
    this.events.push({ type: 'announce', playerId: player.id, icon, title, text, tileIds, random, fx });
    this.journal.add('announce', { playerId: player.id, title, text, tileIds, random, fx });
  }

  _decision(type, player, data = {}) {
    return { kind: 'decision', type, playerId: player.id, ...data };
  }

  _effect(type, data = {}) {
    return { kind: 'effect', type, ...data };
  }

  // Message à faire lire au joueur concerné (l'interface n'attend un clic que s'il est humain)
  _message(player, text) {
    return this._effect('message', { playerId: player.id, text });
  }

  _count(key) {
    this.stats.count[key] = (this.stats.count[key] || 0) + 1;
  }

  _gain(player, amount, source) {
    player.gp += amount;
    this.stats.flow[source] = (this.stats.flow[source] || 0) + amount;
    this.journal.add('gp', { playerId: player.id, amount, source, gp: player.gp });
  }

  _transfer(from, to, amount, source) {
    const actual = Math.max(0, amount);
    from.gp -= actual;
    to.gp += actual;
    this.stats.flow[source] = (this.stats.flow[source] || 0) + actual;
    this.journal.add('gp', { playerId: from.id, amount: -actual, source, gp: from.gp, to: to.id });
    this.journal.add('gp', { playerId: to.id, amount: actual, source, gp: to.gp, from: from.id });
    return actual;
  }

  _drawCards(count) {
    return drawRandomCards(count, this.rng, this._nextId);
  }

  _advancePlayer() {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % n;
      if (this.currentPlayerIndex === 0) this.turnNumber++;
      if (!this.players[this.currentPlayerIndex].eliminated) return;
    }
  }

  _win(player, reason) {
    if (this.over) return;
    this.over = true;
    this.winnerId = player.id;
    this.winReason = reason;
    this.log(`${player.name} a gagné la partie !`, 'important');
  }

  // === Boucle principale ===

  *_run() {
    if (this._restored) {
      this.log('Partie reprise.');
    } else {
      this.log(`Partie lancée ! Objectif : ${this.gpGoal} GP de fortune.`);
    }

    while (!this.over) {
      const player = this.currentPlayer;

      if (player.eliminated) {
        this._advancePlayer();
        continue;
      }
      if (player.stunned) {
        player.stunned = false;
        this.log(`${player.name} est étourdi et passe son tour.`);
        this._advancePlayer();
        continue;
      }

      this.journal.add('turn', this.snapshot());
      yield this._effect('turnStart', { playerId: player.id });
      this.log(`— Tour de ${player.name} —`);

      yield* this._playTurn(player);
      if (this.over) break;
      this._advancePlayer();
    }

    this.journal.add('end', {
      winnerId: this.winnerId, reason: this.winReason, scores: this.getScores(), stats: this.stats, final: this.snapshot(),
    });
    yield this._effect('gameOver', { winnerId: this.winnerId, reason: this.winReason });
  }

  *_playTurn(player) {
    this.activeHandEffect = null;

    // 1. Main de cartes (facultative, une seule par tour), puis lancer
    let handPlayed = false;
    for (;;) {
      const hands = handPlayed ? [] : getAvailableHands(player.hand).map(h => h.type);
      const choice = yield this._decision('turn', player, { hands, diceCount: this.diceCount() });
      if (choice && choice.action === 'hand' && !handPlayed && this._playHand(player, choice)) {
        handPlayed = true;
        continue;
      }
      break;
    }

    // 2. Dés
    const rolls = [];
    for (let i = 0; i < this.diceCount(); i++) rolls.push(rollDie(this.rng));
    const total = rolls.reduce((a, b) => a + b, 0);
    this.log(`${player.name} lance ${rolls.length > 1 ? `${rolls.length} dés` : 'le dé'} : ${rolls.join(' + ')}${rolls.length > 1 ? ` = ${total}` : ''}`);
    yield this._effect('dice', { playerId: player.id, rolls, total });

    // 3. Déplacement
    const { cubeBrokeOnArrival } = yield* this._move(player, total);
    if (this.over) return;

    // 4. Case d'arrivée
    yield* this._land(player, { safeFromDamage: cubeBrokeOnArrival });
    if (this.over) return;

    // 5. Fin de tour
    yield* this._endTurn(player);
  }

  // === Mains de cartes ===

  _playHand(player, choice) {
    const handDef = getHandDef(choice.handType);
    if (!handDef || !canFormHand(player.hand, handDef)) return false;

    const cards = selectCardsForHand(player.hand, handDef, choice.cardIds);
    if (!cards) return false;
    for (const card of cards) removeCardFromHand(player, card.instanceId);

    this._count(`hand:${handDef.type}`);
    this._resolveHandEffect(player, handDef, choice.targetId);
    return true;
  }

  // Chaque effet retourne la phrase qui le décrit, reprise dans le journal et l'annonce à l'écran.

  _stun(target) {
    target.stunned = true;
    return `${target.name} passera son prochain tour.`;
  }

  _confuseOpponents(player) {
    for (const p of this.opponentsOf(player)) p.confusedTurns = RULES.confuseTurns;
    return `Ses adversaires partiront au hasard aux intersections pendant ${RULES.confuseTurns} tours.`;
  }

  _gpMagnet(player) {
    const enemyTiles = this.tiles.filter(t => t.owner !== null && t.owner !== player.id).length;
    const gain = enemyTiles * RULES.gpMagnetPerTile;
    this._gain(player, gain, 'magnet');
    return `+${gain} GP (${enemyTiles} case${enemyTiles > 1 ? 's' : ''} adverse${enemyTiles > 1 ? 's' : ''}).`;
  }

  _doubleToll(player) {
    player.doubleTollTurns = RULES.doubleTollTurns;
    return `Ses péages sont doublés pendant ${RULES.doubleTollTurns} tours.`;
  }

  _protect(player) {
    player.gpProtector++;
    return 'Sa prochaine perte de GP sera bloquée.';
  }

  _extraDice(count) {
    this.activeHandEffect = count === 3 ? HandType.THREE_DICE : HandType.TWO_DICE;
    return `${count} dés ce tour.`;
  }

  // Effets visuels des mains (joués par l'interface pendant l'annonce)
  _fxStun(target) {
    return { type: 'stun', targetId: target.id };
  }

  _fxConfuse(player) {
    return { type: 'confuse', targetIds: this.opponentsOf(player).map(p => p.id) };
  }

  _fxMagnet(player) {
    return { type: 'magnet', tileIds: this.tiles.filter(t => t.owner !== null && t.owner !== player.id).map(t => t.id) };
  }

  _fxDoubleToll(player) {
    return { type: 'doubleToll', tileIds: this.tiles.filter(t => t.owner === player.id).map(t => t.id) };
  }

  _resolveHandEffect(player, handDef, targetId) {
    const opponents = this.opponentsOf(player);
    let icon = '🃏';
    let text = '';
    let options = {};

    switch (handDef.type) {
      case HandType.STUN: {
        const target = opponents.find(p => p.id === targetId) || opponents[0];
        icon = '⚡';
        text = target ? this._stun(target) : 'Aucun adversaire à étourdir.';
        if (target) options = { fx: this._fxStun(target) };
        break;
      }
      case HandType.TWO_DICE:
        icon = '🎲';
        text = this._extraDice(2);
        options = { fx: { type: 'dice', count: 2 } };
        break;
      case HandType.THREE_DICE:
        icon = '🎲';
        text = this._extraDice(3);
        options = { fx: { type: 'dice', count: 3 } };
        break;
      case HandType.GP_PROTECTOR:
        icon = '🛡️';
        text = this._protect(player);
        options = { fx: { type: 'shield' } };
        break;
      case HandType.NAVIGATOR:
        icon = '🧭';
        this.activeHandEffect = HandType.NAVIGATOR;
        text = 'Toutes les directions lui sont permises ce tour.';
        options = { fx: { type: 'navigator' } };
        break;
      case HandType.CONFUSE:
        icon = '❓';
        options = { fx: this._fxConfuse(player) };
        text = this._confuseOpponents(player);
        break;
      case HandType.DOUBLE_TOLL:
        icon = '💰';
        text = this._doubleToll(player);
        options = { fx: this._fxDoubleToll(player) };
        break;
      case HandType.GP_MAGNET:
        icon = '🧲';
        options = { fx: this._fxMagnet(player) };
        text = this._gpMagnet(player);
        break;
      case HandType.JOKERS_FORTUNE: {
        icon = '🃏';
        const result = this._resolveJokersFortune(player);
        text = result.text;
        options = { ...result.options, fx: { type: 'roulette', symbol: 'joker', then: result.fx } };
        break;
      }
      case HandType.GOLDEN_CHANCE: {
        icon = '🎰';
        const result = this._resolveGoldenChance(player);
        text = result.text;
        options = { ...result.options, fx: { type: 'roulette', symbol: 'golden', then: result.fx } };
        break;
      }
    }

    this.log(`${player.name} joue ${handDef.name} ! ${text}`, 'important');
    this._announce(player, icon, handDef.name, text, options);
  }

  // Roulette du Joker : un effet au hasard.
  // Retourne { text, options, fx } : la phrase, les options d'annonce et l'effet visuel du résultat.
  _resolveJokersFortune(player) {
    const random = { random: true };
    switch (this.rng.int(5)) {
      case 0: {
        const targets = this.opponentsOf(player);
        if (targets.length === 0) return { text: 'Rien ne se passe.', options: random, fx: null };
        const target = this.rng.pick(targets);
        return { text: `Stun ! ${this._stun(target)}`, options: random, fx: this._fxStun(target) };
      }
      case 1:
        return { text: `Double Dé ! ${this._extraDice(2)}`, options: random, fx: { type: 'dice', count: 2 } };
      case 2:
        return { text: `Protecteur GP ! ${this._protect(player)}`, options: random, fx: { type: 'shield' } };
      case 3: {
        const fx = this._fxMagnet(player);
        return { text: `Aimant GP ! ${this._gpMagnet(player)}`, options: random, fx };
      }
      default: {
        const free = this.tiles.filter(t => t.type === TileType.NORMAL && t.owner === null);
        if (free.length === 0) {
          this._gain(player, RULES.jokerNoTileGP, 'event');
          return { text: `+${RULES.jokerNoTileGP} GP.`, options: random, fx: { type: 'magnet', tileIds: [] } };
        }
        const target = this.rng.pick(free);
        target.owner = player.id;
        target.level = 1;
        target.cardPlaced = null;
        updateAllTolls(this.tiles);
        // La capture elle-même est montrée ensuite, sur la case
        return { text: `Capture de la case libre n° ${target.id} !`, options: { random: true, tileIds: [target.id] }, fx: null };
      }
    }
  }

  // Machine à sous : un effet puissant au hasard. Même retour que la roulette du Joker.
  _resolveGoldenChance(player) {
    const random = { random: true };
    switch (this.rng.int(4)) {
      case 0: {
        const zoneTilesOf = z => this.tiles.filter(t => t.zone === z.id && t.type === TileType.NORMAL);
        const capturable = (this.boardData.zones || []).filter(z => zoneTilesOf(z).some(t => t.owner !== player.id));
        if (capturable.length === 0) {
          this._gain(player, RULES.goldenNoZoneGP, 'event');
          return { text: `Jackpot ! +${RULES.goldenNoZoneGP} GP.`, options: random, fx: { type: 'magnet', tileIds: [] } };
        }
        const zone = this.rng.pick(capturable);
        for (const t of zoneTilesOf(zone)) {
          t.owner = player.id;
          if (t.level === 0) t.level = 1;
        }
        updateAllTolls(this.tiles);
        return {
          text: `Capture de toute la zone ${zone.name || zone.id} !`,
          options: { random: true, tileIds: zoneTilesOf(zone).map(t => t.id) },
          fx: null,
        };
      }
      case 1:
        return { text: `Triple Dé ! ${this._extraDice(3)}`, options: random, fx: { type: 'dice', count: 3 } };
      case 2:
        return { text: `Double Péage ! ${this._doubleToll(player)}`, options: random, fx: this._fxDoubleToll(player) };
      default: {
        const fx = this._fxConfuse(player);
        return { text: `Confusion générale ! ${this._confuseOpponents(player)}`, options: random, fx };
      }
    }
  }

  // === Déplacement ===

  *_move(player, steps) {
    let cubeBrokeOnArrival = false;

    for (let remaining = steps; remaining > 0; remaining--) {
      // Le Navigateur lève l'interdiction de demi-tour
      const lastDir = this.activeHandEffect === HandType.NAVIGATOR ? null : player.lastDirection;
      const moves = getAvailableMoves(this.tiles, player.position, lastDir);
      if (moves.length === 0) break;

      let move = moves[0];
      if (moves.length > 1) {
        if (player.confusedTurns > 0) {
          move = this.rng.pick(moves);
          this.log(`${player.name} est confus et part au hasard !`);
        } else {
          const choice = yield this._decision('direction', player, { moves, stepsRemaining: remaining });
          move = moves.find(m => m.tileId === choice?.tileId) || moves[0];
        }
      }

      const from = player.position;
      const toTile = this.tiles[move.tileId];
      const ridden = this.cubeOf(player.id);
      const carriesCube = !!ridden && toTile.type === TileType.DAMAGE;

      // Quitter la piste de dégâts fait descendre du cube (il reste sur place)
      if (ridden && !carriesCube) {
        ridden.riderId = null;
        this.log(`${player.name} quitte la piste de dégâts et descend du Prize Cube.`);
      }

      yield this._effect('move', { playerId: player.id, from, to: move.tileId, cubeId: carriesCube ? ridden.id : null });

      player.lastDirection = move.direction;
      player.position = move.tileId;
      cubeBrokeOnArrival = false;

      if (carriesCube) {
        // Le cube suit le joueur et encaisse les dégâts à sa place
        ridden.tileId = move.tileId;
        ridden.accumulatedGP += RULES.cubeGainMin + this.rng.int(RULES.cubeGainSpread);
        ridden.counter--;
        if (ridden.counter <= 0) {
          // Le cube se brise sous le joueur : à montrer avant qu'il ne réapparaisse à son origine
          yield this._effect('cubeBreak', {
            cubeId: ridden.id, playerId: player.id, tileId: move.tileId,
            sourceTileId: ridden.sourceTileId, gp: ridden.accumulatedGP,
          });
          this._breakCube(player, ridden);
          cubeBrokeOnArrival = remaining === 1;
        }
      } else if (toTile.type === TileType.DAMAGE) {
        this._boardCubeAt(player, move.tileId);
      }

      // Effets de passage (la case d'arrivée est traitée par _land)
      if (remaining > 1) {
        this._onPass(player, toTile);
        if (this.over) break;
      }

      this._checkCaptainTransfer(player);
    }

    return { cubeBrokeOnArrival };
  }

  // Monte sur un cube libre de la case, ou le vole à celui qui le chevauche
  _boardCubeAt(player, tileId) {
    const free = this.freeCubeAt(tileId);
    if (free) {
      free.riderId = player.id;
      this.log(`${player.name} monte sur le Prize Cube ! (${free.counter} pas restant${free.counter > 1 ? 's' : ''})`, 'important');
      return true;
    }
    const taken = this.prizeCubes.find(c => c.tileId === tileId && c.riderId !== null && c.riderId !== player.id);
    if (taken) {
      const previous = this.players[taken.riderId];
      this.log(`${player.name} vole le Prize Cube à ${previous.name} !`, 'important');
      this._applyDamagePenalty(previous);
      taken.riderId = player.id;
      this.log(`${player.name} chevauche le Prize Cube ! (${taken.accumulatedGP} GP, ${taken.counter} pas restant${taken.counter > 1 ? 's' : ''})`, 'important');
      return true;
    }
    return false;
  }

  _breakCube(player, cube) {
    const gp = cube.accumulatedGP;
    this._gain(player, gp, 'cube');
    this.log(`Le Prize Cube se brise ! ${player.name} reçoit ${gp} GP accumulés !`, 'important');
    this.notif('💎', `Prize Cube ! +${gp} GP`, 'positive');

    cube.riderId = null;
    cube.tileId = cube.sourceTileId;
    cube.counter = RULES.cubeCounter;
    cube.accumulatedGP = RULES.cubeBaseGP;
  }

  _visitCheckpoint(player, tile) {
    const color = getCheckpointColor(tile.type);
    if (!color || player.checkpoints[color]) return;

    player.checkpoints[color] = true;
    this._gain(player, RULES.checkpointBonus, 'checkpoint');
    let extra = '';
    if (player.hand.length < RULES.maxHandSize) {
      player.hand.push(...this._drawCards(1));
      extra = ' +1 carte';
    }
    this.log(`${player.name} active le checkpoint ${CHECKPOINT_LABELS[color]} ! +${RULES.checkpointBonus} GP${extra}`);
    this.notif('🚩', `Checkpoint ${CHECKPOINT_LABELS[color]} ! +${RULES.checkpointBonus} GP`, 'positive');
  }

  // Passage ou arrêt sur la case Départ : bonus, tour complet, puis victoire éventuelle
  _reachStart(player, stopping) {
    const bonus = stopping ? RULES.startStopBonus : RULES.startPassBonus;
    this._gain(player, bonus, 'start');
    this.log(`${player.name} ${stopping ? 's\'arrête sur' : 'passe par'} le Départ ! +${bonus} GP.`, stopping ? 'important' : '');

    if (allCheckpointsVisited(player)) {
      this._gain(player, RULES.lapBonus, 'lap');
      const missing = RULES.maxHandSize - player.hand.length;
      if (missing > 0) player.hand.push(...this._drawCards(missing));
      resetCheckpoints(player);
      this._count('lap');
      this.log(`Bonus de tour ! ${player.name} gagne ${RULES.lapBonus} GP et sa main est complétée.`, 'important');
      this.notif('⭐', `Bonus de tour ! +${RULES.lapBonus} GP`, 'positive');
    }

    if ((stopping || RULES.winOnPass) && this.netWorth(player) >= this.gpGoal) {
      this._win(player, 'goal');
    }
  }

  _collectHoneyAt(player, tileId) {
    const idx = this.honeyPots.findIndex(p => p.tileId === tileId);
    if (idx === -1) return;
    const [pot] = this.honeyPots.splice(idx, 1);
    if (pot.isGood) {
      this._gain(player, RULES.honeyGoodGP, 'honey');
      this.log(`${player.name} trouve du miel ! +${RULES.honeyGoodGP} GP !`, 'important');
      this.notif('🍯', `Miel ! +${RULES.honeyGoodGP} GP`, 'positive');
    } else {
      this._gain(player, RULES.honeyBadGP, 'honey');
      this.log(`${player.name} dérange les abeilles ! ${RULES.honeyBadGP} GP !`, 'negative');
      this.notif('🐝', `Abeilles ! ${RULES.honeyBadGP} GP`, 'negative');
    }
  }

  _onPass(player, tile) {
    if (isCheckpoint(tile.type)) this._visitCheckpoint(player, tile);

    if (tile.type === TileType.START) {
      this._reachStart(player, false);
      if (this.over) return;
    }

    if (tile.type === TileType.BOOSTER) {
      player.boosterPercent = Math.min(player.boosterPercent + RULES.boosterStep, RULES.boosterMax);
      this.log(`${player.name} passe par le Booster ! Multiplicateur : ${player.boosterPercent} %`);
    }

    this._collectHoneyAt(player, tile.id);
  }

  // === Case d'arrivée ===

  *_land(player, { safeFromDamage = false, noEvent = false } = {}) {
    const tile = this.tiles[player.position];

    this._collectHoneyAt(player, tile.id);
    if (isCheckpoint(tile.type)) this._visitCheckpoint(player, tile);

    switch (tile.type) {
      case TileType.START:
        this._reachStart(player, true);
        break;
      case TileType.NORMAL:
        if (tile.owner === null) yield* this._landOnFreeTile(player, tile);
        else if (tile.owner === player.id) yield* this._landOnOwnTile(player, tile);
        else yield* this._landOnEnemyTile(player, tile);
        break;
      case TileType.BONUS:
        if (tile.owner === null) yield* this._landOnFreeBonus(player, tile);
        else if (tile.owner === player.id) yield* this._landOnOwnTile(player, tile);
        else yield* this._landOnEnemyTile(player, tile);
        break;
      case TileType.DAMAGE:
        if (!safeFromDamage) yield* this._landOnDamage(player, tile);
        break;
      case TileType.EVENT:
        if (!noEvent) yield* this._landOnEvent(player);
        break;
      case TileType.BOOSTER:
        yield* this._landOnBooster(player);
        break;
    }
  }

  *_landOnFreeTile(player, tile) {
    const placeable = player.hand.filter(canPlaceOnTile);
    if (placeable.length === 0) {
      this.log(`${player.name} n'a pas de carte à poser sur cette case.`);
      return;
    }
    const options = placeable
      .map(card => ({ cardId: card.instanceId, cost: getBuyCost(tile, card) }))
      .filter(o => o.cost <= player.gp);
    if (options.length === 0) {
      this.log(`${player.name} n'a pas assez de GP pour acheter cette case.`);
      return;
    }

    const choice = yield this._decision('buy', player, { tileId: tile.id, options });
    const option = options.find(o => o.cardId === choice?.cardId);
    if (!option) return;

    const card = removeCardFromHand(player, option.cardId);
    this._buyTile(player, tile, card, option.cost);
  }

  _buyTile(player, tile, card, cost) {
    this._gain(player, -cost, 'purchase');
    tile.owner = player.id;
    tile.cardPlaced = card;
    tile.level = 1;
    updateAllTolls(this.tiles);
    this._count('buy');
    this.log(`${player.name} achète la case ${tile.id} pour ${cost} GP${card ? ` (${card.name} posée)` : ''}.`, 'important');
    this.notif('🏠', `Case achetée ! −${cost} GP`, 'info');
  }

  *_landOnOwnTile(player, tile) {
    const cost = getUpgradeCost(tile);
    if (tile.level >= RULES.maxLevel || player.gp < cost) return;

    const choice = yield this._decision('upgrade', player, { tileId: tile.id, cost, level: tile.level });
    if (!choice?.upgrade) return;

    this._gain(player, -cost, 'upgrade');
    tile.level++;
    updateAllTolls(this.tiles);
    this._count('upgrade');
    this.log(`${player.name} améliore la case ${tile.id} au niveau ${tile.level} pour ${cost} GP.`);
    this.notif('⬆️', `Niveau ${tile.level} ! −${cost} GP`, 'info');
  }

  *_landOnEnemyTile(player, tile) {
    const owner = this.players[tile.owner];
    const toll = this._tollFor(tile);

    if (player.gpProtector > 0) {
      player.gpProtector--;
      this.log(`Protecteur GP : ${player.name} ne paie pas le péage.`, 'important');
      this.notif('🛡️', 'Protecteur GP ! Péage bloqué !', 'positive');
      return;
    }

    const buyoutCost = getBuyoutCost(tile);
    if (buyoutCost > 0 && player.gp >= buyoutCost) {
      const choice = yield this._decision('toll', player, { tileId: tile.id, ownerId: owner.id, toll, buyoutCost });
      if (choice?.action === 'buyout') {
        this._transfer(player, owner, buyoutCost, 'buyout');
        tile.owner = player.id;
        tile.level = 1;
        updateAllTolls(this.tiles);
        this._count('buyout');
        this.log(`${player.name} rachète de force la case ${tile.id} à ${owner.name} pour ${buyoutCost} GP !`, 'important');
        this.notif('⚔️', `Rachat forcé ! −${buyoutCost} GP`, 'negative');
        return;
      }
    }

    this._payToll(player, owner, toll);
  }

  _tollFor(tile) {
    const owner = this.players[tile.owner];
    return tile.tollValue * (owner.doubleTollTurns > 0 ? 2 : 1);
  }

  _payToll(player, owner, toll) {
    this._transfer(player, owner, toll, 'toll');
    this._count('toll');
    this.log(`${player.name} paie ${toll} GP de péage à ${owner.name}.`, 'negative');
    this.notif('💰', `${player.name} paie ${toll} GP à ${owner.name}`, 'negative');
  }

  // Case Bonus libre : elle porte déjà une carte, on achète la case sans rien poser de sa main.
  // Une fois achetée, elle se comporte comme une case commande (péage, amélioration, rachat).
  *_landOnFreeBonus(player, tile) {
    const card = tile.presetCard;
    const cost = getBuyCost(tile, card);
    if (player.gp < cost) {
      this.log(`Case Bonus (${card.name}) à ${cost} GP : ${player.name} n'a pas assez de GP.`);
      return;
    }

    const choice = yield this._decision('bonus', player, { tileId: tile.id, card, cost });
    if (!choice?.buy) return;
    this._buyTile(player, tile, card, cost);
  }

  *_landOnDamage(player, tile) {
    if (this.cubeOf(player.id)) {
      this.log(`${player.name} est en sécurité sur le Prize Cube.`);
      return;
    }
    if (this._boardCubeAt(player, tile.id)) return;

    const blocked = player.gpProtector > 0;
    const damage = this._applyDamagePenalty(player);
    if (blocked) {
      this.notif('🛡️', 'Protecteur GP ! Dégâts bloqués !', 'positive');
      yield this._message(player, 'Protecteur GP ! Dégâts bloqués !');
    } else {
      this.notif('💥', `${player.name} −${damage} GP`, 'negative');
      yield this._message(player, `Dégâts ! −${damage} GP`);
    }
  }

  // Dégâts subis sur la piste (bloqués par un Protecteur GP). Retourne le montant perdu.
  _applyDamagePenalty(player) {
    if (player.gpProtector > 0) {
      player.gpProtector--;
      this.log(`Protecteur GP : ${player.name} ne subit pas de dégâts.`, 'important');
      return 0;
    }
    const damage = RULES.damageMin + this.rng.int(RULES.damageSpread);
    this._gain(player, -damage, 'damage');
    this.log(`${player.name} perd ${damage} GP sur la piste de dégâts !`, 'negative');
    return damage;
  }

  *_landOnBooster(player) {
    const percent = player.boosterPercent;
    const bonus = Math.floor(Math.max(0, player.gp) * percent / 100);
    this._gain(player, bonus, 'booster');
    player.boosterPercent = RULES.boosterStart;
    this.log(`Case Booster ! Multiplicateur de ${percent} % : +${bonus} GP.`, 'important');
    this.notif('🚀', `Booster ${percent} % ! +${bonus} GP`, 'positive');
    yield this._message(player, `Booster ${percent} % : +${bonus} GP`);
  }

  // === Événements de plateau ===

  *_landOnEvent(player) {
    // Captain Justice / Dark (pas sur le plateau Toon)
    if (this.boardName !== 'Toon' && this.rng.chance(RULES.captainChance)) {
      const justice = this.rng.chance(0.5);
      if (justice && !this.captainJusticeActive) {
        player.justiceTurns = RULES.captainTurns;
        this.log(`Captain Justice rejoint ${player.name} pour ${RULES.captainTurns} tours !`, 'important');
        this.notif('🦸', `Captain Justice rejoint ${player.name} !`, 'positive');
        yield this._message(player, 'Captain Justice vous rejoint !');
        return;
      }
      if (!justice && !this.captainDarkActive) {
        player.darkTurns = RULES.captainTurns;
        this.log(`Captain Dark s'attache à ${player.name} pour ${RULES.captainTurns} tours !`, 'negative');
        this.notif('🦹', `Captain Dark s'attache à ${player.name} !`, 'negative');
        yield this._message(player, 'Captain Dark vous hante !');
        return;
      }
    }

    if (GLIDER_BOARDS.includes(this.boardName)) {
      yield* this._eventKeybladeGlider(player);
      return;
    }

    switch (this.boardName) {
      case 'Royal':
        yield* this._eventBibbidiBoo(player);
        break;
      case 'Spaceship':
        yield* this._eventGigawattJolt(player);
        break;
      case 'Toon':
        yield* this._eventFantasia(player);
        break;
      case 'Skull':
        yield* this._eventPixieDust(player);
        break;
      case 'Honeypot':
        yield* this._eventHunnyHunt(player);
        break;
      default:
        this._gain(player, RULES.eventFallbackGP, 'event');
        this.log(`Événement spécial ! +${RULES.eventFallbackGP} GP.`, 'important');
        yield this._message(player, `Événement spécial : +${RULES.eventFallbackGP} GP`);
    }
  }

  // Déplace un joueur d'un coup sur une case (il descend de son cube s'il en chevauchait un)
  *_teleport(target, tileId) {
    const cube = this.cubeOf(target.id);
    if (cube) cube.riderId = null;
    const from = target.position;
    yield this._effect('teleport', { playerId: target.id, from, to: tileId });
    target.position = tileId;
    target.lastDirection = null;
  }

  // Keyblade Glider : se téléporter sur la case de son choix, puis la résoudre
  *_eventKeybladeGlider(player) {
    this.log(`Keyblade Glider ! ${player.name} peut se téléporter !`, 'important');
    const tileIds = this.tiles
      .filter(t => t.type !== TileType.EVENT && t.id !== player.position)
      .map(t => t.id);
    if (tileIds.length === 0) return;

    const choice = yield this._decision('teleport', player, { tileIds });
    const tileId = tileIds.includes(choice?.tileId) ? choice.tileId : this.startTileId;

    yield* this._teleport(player, tileId);
    this.log(`${player.name} se téléporte sur la case ${tileId} !`, 'important');
    yield* this._land(player, { noEvent: true });
  }

  // Bibbidi-Bobbidi-Boo : un dé × 200 GP
  *_eventBibbidiBoo(player) {
    const roll = rollDie(this.rng);
    const gp = roll * RULES.bibbidiPerPip;
    this._gain(player, gp, 'event');
    this.log(`Bibbidi-Bobbidi-Boo ! Dé : ${roll} × ${RULES.bibbidiPerPip} = +${gp} GP !`, 'important');
    yield this._message(player, `Bibbidi-Bobbidi-Boo ! ${roll} × ${RULES.bibbidiPerPip} = +${gp} GP !`);
  }

  // Gigawatt Jolt : Sparky vole des GP aux adversaires pendant quelques tours
  *_eventGigawattJolt(player) {
    this.sparkyEffect = { playerId: player.id, turnsLeft: RULES.sparkyTurns };
    this.log(`Gigawatt Jolt ! Sparky vole des GP aux adversaires pour ${player.name} pendant ${RULES.sparkyTurns} tours !`, 'important');
    yield this._message(player, `Gigawatt Jolt ! Sparky vole des GP aux adversaires pendant ${RULES.sparkyTurns} tours !`);
  }

  // Fantasia : 300 GP + 300 GP par case possédée
  *_eventFantasia(player) {
    const owned = this.tiles.filter(t => t.owner === player.id).length;
    const bonus = RULES.fantasiaBase + owned * RULES.fantasiaPerTile;
    this._gain(player, bonus, 'event');
    this.log(`Fantasia ! ${RULES.fantasiaBase} GP + ${owned} cases × ${RULES.fantasiaPerTile} GP = +${bonus} GP !`, 'important');
    yield this._message(player, `Fantasia ! +${bonus} GP (${RULES.fantasiaBase} + ${owned} × ${RULES.fantasiaPerTile})`);
  }

  // Pixie Dust : envoyer un adversaire sur la case de son choix, qu'il subit en arrivant
  *_eventPixieDust(player) {
    const targets = this.opponentsOf(player);
    if (targets.length === 0) return;
    this.log(`Pixie Dust ! ${player.name} peut déplacer un adversaire !`, 'important');

    const tileIds = this.tiles.map(t => t.id);
    const choice = yield this._decision('pixieDust', player, { targetIds: targets.map(p => p.id), tileIds });
    const target = targets.find(p => p.id === choice?.targetId) || targets[0];
    const tileId = tileIds.includes(choice?.tileId) ? choice.tileId : target.position;
    if (tileId === target.position) return;

    yield* this._teleport(target, tileId);
    this.log(`${player.name} envoie ${target.name} sur la case ${tileId} !`, 'important');
    this._forcedLanding(target);
  }

  // Arrivée subie hors de son tour : dégâts ou péage, sans choix possible
  _forcedLanding(target) {
    const tile = this.tiles[target.position];
    if (tile.type === TileType.DAMAGE) {
      if (!this._boardCubeAt(target, tile.id)) {
        const damage = this._applyDamagePenalty(target);
        if (damage > 0) this.notif('💥', `${target.name} −${damage} GP`, 'negative');
      }
    } else if (tile.owner !== null && tile.owner !== target.id) {
      if (target.gpProtector > 0) {
        target.gpProtector--;
        this.log(`Protecteur GP : ${target.name} ne paie pas le péage.`, 'important');
      } else {
        this._payToll(target, this.players[tile.owner], this._tollFor(tile));
      }
    }
  }

  // Hunny Hunt : des pots de miel apparaissent, la plupart bons, quelques-uns piégés
  *_eventHunnyHunt(player) {
    const here = player.position;
    const candidates = this.rng.shuffle(
      this.tiles.filter(t => t.type !== TileType.START && t.id !== here),
    ).slice(0, RULES.honeyPots - 1);
    const kinds = this.rng.shuffle(
      Array.from({ length: RULES.honeyPots }, (_, i) => i < RULES.honeyGoodPots),
    );

    this.honeyPots = [here, ...candidates.map(t => t.id)].map((tileId, i) => ({ tileId, isGood: kinds[i] }));
    this.log(`Hunny Hunt ! ${this.honeyPots.length} pots de miel sont apparus sur le plateau !`, 'important');
    this._collectHoneyAt(player, here);
    yield this._message(player, `Hunny Hunt ! ${this.honeyPots.length} pots de miel restent à ramasser !`);
  }

  // === Captain Justice / Dark, Sparky ===

  // Les capitaines passent au joueur que l'on croise sur une case
  _checkCaptainTransfer(player) {
    for (const key of ['darkTurns', 'justiceTurns']) {
      if (player[key] <= 0) continue;
      const other = this.opponentsOf(player).find(p => p.position === player.position);
      if (!other) continue;
      other[key] = player[key];
      player[key] = 0;
      const name = key === 'darkTurns' ? 'Captain Dark' : 'Captain Justice';
      this.log(`${name} passe de ${player.name} à ${other.name} !`, 'important');
    }
  }

  // Achat automatique d'une case sans carte (capitaines)
  _autoBuy(player, tile) {
    this._gain(player, -tile.baseValue, 'purchase');
    tile.owner = player.id;
    tile.cardPlaced = null;
    tile.level = 1;
    updateAllTolls(this.tiles);
  }

  _applyCaptainEffects(player) {
    if (player.justiceTurns > 0) {
      this._gain(player, RULES.captainGP, 'justice');
      this.log(`Captain Justice donne ${RULES.captainGP} GP à ${player.name}.`);
      this.notif('🦸', `Captain Justice : +${RULES.captainGP} GP`, 'positive');

      if (this.rng.chance(RULES.justiceBuyChance)) {
        const here = this.tiles[player.position];
        const target = Object.values(here.adjacencies)
          .filter(Boolean)
          .map(adj => this.tiles[adj.tileId])
          .find(t => t.type === TileType.NORMAL && t.owner === null && player.gp >= t.baseValue);
        if (target) {
          this._autoBuy(player, target);
          this.log(`Captain Justice achète la case ${target.id} pour ${player.name} !`, 'important');
          this._announce(player, '🦸', 'Captain Justice', `Il achète la case n° ${target.id} pour ${player.name}.`, { tileIds: [target.id], random: true });
        }
      }

      player.justiceTurns--;
      if (player.justiceTurns === 0) this.log(`Captain Justice quitte ${player.name}.`);
    }

    if (player.darkTurns > 0) {
      this._gain(player, -RULES.captainGP, 'dark');
      this.log(`Captain Dark vole ${RULES.captainGP} GP à ${player.name} !`, 'negative');
      this.notif('🦹', `Captain Dark : −${RULES.captainGP} GP`, 'negative');

      if (this.rng.chance(RULES.darkBuyChance)) {
        const target = this.tiles.find(t => t.type === TileType.NORMAL && t.owner === null && player.gp >= t.baseValue);
        if (target) {
          this._autoBuy(player, target);
          this.log(`Captain Dark force l'achat de la case ${target.id} (${target.baseValue} GP) !`, 'negative');
          this._announce(player, '🦹', 'Captain Dark', `Il force ${player.name} à acheter la case n° ${target.id}.`, { tileIds: [target.id], random: true });
        }
      }

      player.darkTurns--;
      if (player.darkTurns === 0) this.log(`Captain Dark quitte ${player.name}.`);
    }

    if (this.sparkyEffect && this.sparkyEffect.playerId === player.id) {
      let total = 0;
      for (const other of this.opponentsOf(player)) {
        total += this._transfer(other, player, Math.min(Math.max(0, other.gp), RULES.sparkySteal), 'sparky');
      }
      this.log(`Sparky vole ${total} GP aux adversaires pour ${player.name} !`, 'important');
      this.sparkyEffect.turnsLeft--;
      if (this.sparkyEffect.turnsLeft <= 0) {
        this.sparkyEffect = null;
        this.log('L\'effet de Sparky se dissipe.');
      }
    }
  }

  // === Fin de tour, dettes et faillite ===

  *_endTurn(player) {
    this._applyCaptainEffects(player);

    if (player.doubleTollTurns > 0) player.doubleTollTurns--;
    if (player.confusedTurns > 0) player.confusedTurns--;
    this.activeHandEffect = null;

    yield* this._settleDebts();
  }

  // Tout joueur passé sous 0 GP vend des cases jusqu'à revenir à 0, ou fait faillite
  *_settleDebts() {
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const p = this.players[(this.currentPlayerIndex + i) % n];
      if (p.eliminated) continue;

      while (p.gp < 0) {
        const owned = this.tiles.filter(t => t.owner === p.id);
        if (owned.length === 0) {
          this._bankrupt(p);
          break;
        }
        const choice = yield this._decision('forcedSale', p, { tileIds: owned.map(t => t.id), debt: -p.gp });
        const tile = owned.find(t => t.id === choice?.tileId)
          || owned.reduce((a, b) => (a.currentValue <= b.currentValue ? a : b));
        this._sellTile(p, tile);
      }
      if (this.over) return;
    }
  }

  _sellTile(player, tile) {
    const value = tile.currentValue;
    this._gain(player, value, 'sale');
    this.log(`${player.name} vend la case ${tile.id} pour ${value} GP.`, 'negative');
    tile.owner = null;
    tile.cardPlaced = null;
    tile.level = 0;
    updateAllTolls(this.tiles);
    this._count('sale');
  }

  _bankrupt(player) {
    if (!RULES.bankruptcy) {
      player.gp = 0;
      this.log(`${player.name} n'a plus de case à vendre : sa dette est effacée.`);
      return;
    }

    player.eliminated = true;
    player.gp = 0;
    player.hand = [];
    player.justiceTurns = 0;
    player.darkTurns = 0;
    const cube = this.cubeOf(player.id);
    if (cube) cube.riderId = null;
    if (this.sparkyEffect && this.sparkyEffect.playerId === player.id) this.sparkyEffect = null;
    this._count('bankruptcy');
    this.log(`${player.name} est en faillite et quitte la partie !`, 'negative');
    this.notif('💸', `${player.name} est en faillite !`, 'negative');

    const alive = this.players.filter(p => !p.eliminated);
    if (alive.length === 1) this._win(alive[0], 'lastStanding');
  }
}
