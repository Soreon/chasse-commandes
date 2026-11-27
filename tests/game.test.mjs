import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Game } from '../js/engine/game.js';
import { RULES } from '../js/engine/config.js';
import { TileType, updateAllTolls } from '../js/engine/board.js';
import { runHeadless } from '../js/engine/headless.js';
import { decide } from '../js/engine/ai.js';

const boards = JSON.parse(readFileSync(fileURLToPath(new URL('../boards.json', import.meta.url)), 'utf8'));

const threeAIs = () => [{ name: 'A' }, { name: 'B' }, { name: 'C' }];

function newGame(boardName = 'Keyblade', seed = 1, players = threeAIs()) {
  return new Game({ boardEntry: boards[boardName], boardName, players, gpGoal: 7500, seed });
}

function outcome(game) {
  return {
    winner: game.winnerId,
    turns: game.turnNumber,
    gp: game.players.map(p => p.gp),
    owners: game.tiles.map(t => t.owner),
  };
}

// Applique temporairement des règles différentes
function withRules(overrides, fn) {
  const saved = { ...RULES };
  Object.assign(RULES, overrides);
  try {
    return fn();
  } finally {
    Object.assign(RULES, saved);
  }
}

// Fait avancer un morceau du déroulé (générateur) en répondant aux décisions
function drive(gen, answer = () => undefined) {
  const requests = [];
  let step = gen.next();
  while (!step.done) {
    requests.push(step.value);
    step = gen.next(step.value.kind === 'decision' ? answer(step.value) : undefined);
  }
  return { requests, result: step.value };
}

test('même graine, même partie ; autre graine, autre partie', () => {
  const a = newGame('Skull', 42);
  const b = newGame('Skull', 42);
  runHeadless(a);
  runHeadless(b);
  assert.deepEqual(outcome(a), outcome(b));

  const others = [43, 44, 45].map(seed => {
    const g = newGame('Skull', seed);
    runHeadless(g);
    return JSON.stringify(outcome(g));
  });
  assert.ok(others.some(o => o !== JSON.stringify(outcome(a))));
});

for (const name of Object.keys(boards)) {
  test(`plateau ${name} : les parties se terminent`, () => {
    for (let seed = 1; seed <= 15; seed++) {
      const game = newGame(name, seed);
      const finished = runHeadless(game, { maxTurns: 300 });
      assert.ok(finished, `graine ${seed} : pas de vainqueur après ${game.turnNumber} tours`);
      assert.ok(game.winnerId !== null);
      // Personne ne reste endetté, et les valeurs de cases sont cohérentes
      for (const p of game.players) assert.ok(p.gp >= 0, `${p.name} finit à ${p.gp} GP`);
      for (const t of game.tiles) {
        if (t.owner === null) assert.equal(t.currentValue, 0);
        else assert.ok(t.currentValue > 0, `case ${t.id} possédée mais sans valeur`);
      }
    }
  });
}

test('passer par le Départ avec l\'objectif atteint suffit pour gagner', () => {
  const game = newGame();
  const player = game.players[0];
  const start = game.tiles[game.startTileId];
  const neighbor = Object.values(start.adjacencies).find(Boolean).tileId;

  player.gp = game.gpGoal + 500;
  player.position = neighbor;
  player.lastDirection = null;

  drive(game._move(player, 3), req => ({ tileId: req.moves.find(m => m.tileId === start.id)?.tileId }));

  assert.equal(game.over, true);
  assert.equal(game.winnerId, player.id);
  assert.equal(player.position, start.id, 'le déplacement s\'arrête sur le Départ');
});

test('avec la règle « arrêt pile », passer par le Départ ne suffit pas', () => {
  withRules({ winOnPass: false }, () => {
    const game = newGame();
    const player = game.players[0];
    const start = game.tiles[game.startTileId];
    player.gp = game.gpGoal + 500;
    player.position = Object.values(start.adjacencies).find(Boolean).tileId;
    player.lastDirection = null;

    drive(game._move(player, 3), req => ({ tileId: req.moves.find(m => m.tileId === start.id)?.tileId }));
    assert.equal(game.over, false);

    player.position = start.id;
    drive(game._land(player));
    assert.equal(game.over, true);
  });
});

test('sans l\'objectif, passer par le Départ ne fait pas gagner', () => {
  const game = newGame();
  const player = game.players[0];
  const start = game.tiles[game.startTileId];
  player.position = Object.values(start.adjacencies).find(Boolean).tileId;
  player.lastDirection = null;
  const before = player.gp;

  drive(game._move(player, 2), req => ({ tileId: req.moves.find(m => m.tileId === start.id)?.tileId }));
  assert.equal(game.over, false);
  assert.equal(player.gp, before + RULES.startPassBonus);
});

test('case Bonus : on achète la case, avec sa carte déjà posée, sans toucher à sa main', () => {
  const game = newGame('Keyblade', 5);
  const [player, other] = game.players;
  const tile = game.tiles.find(t => t.type === TileType.BONUS);
  assert.ok(tile.presetCard, 'la case Bonus porte une carte dès le début de la partie');
  assert.ok(tile.presetCard.value >= RULES.bonusMinCardValue);
  const cost = RULES.baseTileCost + tile.presetCard.value * RULES.cardValueGP;

  player.position = tile.id;
  const handBefore = player.hand.map(c => c.instanceId);
  const netBefore = game.netWorth(player);

  const { requests } = drive(game._land(player), () => ({ buy: true }));
  assert.equal(requests[0].type, 'bonus');
  assert.equal(requests[0].cost, cost);
  assert.equal(tile.owner, player.id);
  assert.equal(tile.level, 1);
  assert.equal(tile.currentValue, cost);
  assert.ok(tile.tollValue > 0);
  assert.equal(player.gp, RULES.startingGP - cost);
  assert.equal(game.netWorth(player), netBefore);
  assert.deepEqual(player.hand.map(c => c.instanceId), handBefore, 'aucune carte de la main n\'est dépensée');

  // Un autre joueur qui s'y arrête paie le péage
  other.position = tile.id;
  const otherBefore = other.gp;
  drive(game._land(other), () => ({ action: 'pay' }));
  assert.equal(other.gp, otherBefore - tile.tollValue);

  // Le propriétaire qui y revient peut l'améliorer
  const upgrade = drive(game._land(player), () => ({ upgrade: true }));
  assert.equal(upgrade.requests[0].type, 'upgrade');
  assert.equal(tile.level, 2);

  // Revendue, elle redevient libre et garde sa carte pour le prochain acheteur
  const preset = tile.presetCard.name;
  game._sellTile(player, tile);
  assert.equal(tile.owner, null);
  assert.equal(tile.currentValue, 0);
  assert.equal(tile.presetCard.name, preset);
});

test('case Bonus : passer ne coûte rien, et sans assez de GP rien n\'est proposé', () => {
  const game = newGame('Keyblade', 5);
  const player = game.players[0];
  const tile = game.tiles.find(t => t.type === TileType.BONUS);
  player.position = tile.id;

  drive(game._land(player), () => ({ buy: false }));
  assert.equal(tile.owner, null);
  assert.equal(player.gp, RULES.startingGP);

  player.gp = 50;
  const { requests } = drive(game._land(player));
  assert.equal(requests.length, 0);
  assert.equal(tile.owner, null);
});

test('une nouvelle partie ne garde rien de la précédente', () => {
  const first = newGame('Honeypot', 7);
  runHeadless(first);
  first.players[0].justiceTurns = 3;
  first.honeyPots.push({ tileId: 1, isGood: true });

  const second = newGame('Honeypot', 8);
  assert.equal(second.captainJusticeActive, false);
  assert.equal(second.captainDarkActive, false);
  assert.deepEqual(second.honeyPots, []);
  assert.equal(second.sparkyEffect, null);
  assert.equal(second.turnNumber, 1);
  assert.ok(second.tiles.every(t => t.owner === null));
});

test('acheter une case ne change pas la fortune du joueur', () => {
  const game = newGame();
  const player = game.players[0];
  const tile = game.tiles.find(t => t.type === TileType.NORMAL);
  player.position = tile.id;
  const netBefore = game.netWorth(player);

  drive(game._land(player), req => ({ cardId: req.options[0].cardId }));

  assert.equal(tile.owner, player.id);
  assert.equal(game.netWorth(player), netBefore);
  assert.ok(tile.tollValue > 0);
});

test('un joueur endetté vend ses cases, puis fait faillite s\'il n\'en a plus', () => {
  const game = newGame();
  const [debtor, , other] = game.players;
  const tile = game.tiles.find(t => t.type === TileType.NORMAL);
  tile.owner = debtor.id;
  tile.level = 1;
  tile.cardPlaced = { value: 2, name: 'Frappe' };
  updateAllTolls(game.tiles);
  debtor.gp = -50;

  const sale = drive(game._settleDebts(), req => decide(game, req));
  assert.equal(sale.requests[0].type, 'forcedSale');
  assert.equal(tile.owner, null);
  assert.equal(debtor.gp, 150);
  assert.equal(debtor.eliminated, false);

  debtor.gp = -50;
  drive(game._settleDebts());
  assert.equal(debtor.eliminated, true);
  assert.equal(game.over, false, 'il reste deux joueurs');

  other.gp = -10;
  drive(game._settleDebts());
  assert.equal(game.over, true);
  assert.equal(game.winReason, 'lastStanding');
  assert.equal(game.winnerId, game.players[1].id);
});

test('une partie sauvegardée en début de tour reprend à l\'identique', () => {
  const original = newGame('Spaceship', 11);
  original.start();

  // Jouer jusqu'au début du 6e tour, là où l'interface sauvegarde
  let saved = null;
  runHeadless(original, {
    onRequest: (request, game) => {
      if (!saved && request.type === 'turnStart' && game.turnNumber === 6) saved = game.serialize();
    },
  });
  assert.ok(saved, 'la partie a atteint le tour 6');

  const restored = Game.restore(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.turnNumber, 6);
  runHeadless(restored);

  assert.deepEqual(outcome(restored), outcome(original));
});

test('l\'adversaire envoyé sur une case par Pixie Dust en subit le péage', () => {
  const game = newGame('Skull', 3);
  const [player, target] = game.players;
  const tile = game.tiles.find(t => t.type === TileType.NORMAL);
  tile.owner = player.id;
  tile.level = 3;
  tile.cardPlaced = { value: 6, name: 'Meteor' };
  updateAllTolls(game.tiles);
  const toll = tile.tollValue;
  const before = { player: player.gp, target: target.gp };

  drive(game._eventPixieDust(player), () => ({ targetId: target.id, tileId: tile.id }));

  assert.equal(target.position, tile.id);
  assert.equal(target.gp, before.target - toll);
  assert.equal(player.gp, before.player + toll);
});

test('un Prize Cube arrivé à son dernier pas se brise, paie son cavalier et revient à son origine', () => {
  const game = newGame('Keyblade', 3);
  const player = game.players[0];
  const cube = game.prizeCubes[0];
  const source = game.tiles[cube.sourceTileId];
  // Une case de dégâts voisine de la case d'origine du cube
  const [direction, next] = Object.entries(source.adjacencies)
    .find(([, adj]) => adj && game.tiles[adj.tileId].type === TileType.DAMAGE);
  const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' }[direction];

  cube.riderId = player.id;
  cube.counter = 1;
  cube.accumulatedGP = 300;
  player.position = source.id;
  player.lastDirection = direction;
  const gpBefore = player.gp;

  const { requests, result } = drive(game._move(player, 1), req => ({ tileId: next.tileId }));

  const broke = requests.find(r => r.type === 'cubeBreak');
  assert.ok(broke, 'le bris est annoncé à l\'interface');
  assert.equal(broke.sourceTileId, source.id);
  assert.equal(broke.tileId, next.tileId);
  assert.ok(broke.gp > 300, 'le dernier pas ajoute encore au magot');
  assert.equal(player.gp, gpBefore + broke.gp);
  assert.equal(player.position, next.tileId);
  assert.equal(cube.tileId, source.id, 'le cube revient à sa case d\'origine');
  assert.equal(cube.riderId, null);
  assert.equal(cube.counter, RULES.cubeCounter);
  assert.equal(result.cubeBrokeOnArrival, true, 'le joueur ne subit pas de dégâts à cet arrêt');
  assert.ok(opposite);
});

test('un Prize Cube neuf suit le joueur qui monte dessus et continue sur la piste', () => {
  const game = newGame('Keyblade', 3);
  const player = game.players[0];
  const cube = game.prizeCubes[0];
  const source = game.tiles[cube.sourceTileId];
  const [direction, next] = Object.entries(source.adjacencies)
    .find(([, adj]) => adj && game.tiles[adj.tileId].type === TileType.DAMAGE);
  // Le joueur arrive par le côté opposé, sans cube
  const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' }[direction];
  const before = source.adjacencies[opposite];
  assert.ok(before, 'la case d\'origine du cube a un voisin de l\'autre côté');
  player.position = before.tileId;
  player.lastDirection = direction;

  drive(game._move(player, 2), req => ({ tileId: req.moves.find(m => m.tileId === next.tileId || m.tileId === source.id).tileId }));

  assert.equal(player.position, next.tileId);
  assert.equal(cube.tileId, next.tileId, 'le cube a suivi');
  assert.equal(cube.riderId, player.id);
  assert.equal(cube.counter, RULES.cubeCounter - 1);
});

test('une main jouée est annoncée ; une capture par le Joker nomme le joueur et désigne la case', async () => {
  const { getHandDef, HandType } = await import('../js/engine/cards.js');
  const game = newGame('Keyblade', 9);
  const player = game.players[2];
  game.takeEvents();

  // Une main simple : annonce avec son effet
  game._resolveHandEffect(player, getHandDef(HandType.TWO_DICE));
  let events = game.takeEvents();
  let announce = events.find(e => e.type === 'announce');
  assert.equal(announce.playerId, player.id);
  assert.equal(announce.title, 'Double Dé');
  assert.equal(announce.text, '2 dés ce tour.');
  assert.equal(announce.random, false);
  assert.deepEqual(announce.fx, { type: 'dice', count: 2 });
  assert.equal(game.diceCount(), 2);

  // Fortune du Joker, 5e issue de la roulette : capture d'une case libre
  game.rng.int = () => 4;
  game._resolveHandEffect(player, getHandDef(HandType.JOKERS_FORTUNE));
  events = game.takeEvents();
  announce = events.find(e => e.type === 'announce');
  assert.equal(announce.title, 'Fortune du Joker');
  assert.equal(announce.random, true);
  assert.deepEqual(announce.fx, { type: 'roulette', symbol: 'joker', then: null }, 'la capture est montrée sur la case');
  assert.equal(announce.tileIds.length, 1);
  const tile = game.tiles[announce.tileIds[0]];
  assert.equal(tile.owner, player.id);
  assert.equal(tile.level, 1);
  assert.equal(tile.type, TileType.NORMAL);
  const log = events.find(e => e.type === 'log').message;
  assert.ok(log.includes(player.name), 'le journal dit qui a capturé la case');
  assert.ok(log.includes(String(tile.id)), 'et laquelle');
});

test('chaque main annonce un effet visuel, avec ce qu\'il lui faut pour se jouer', async () => {
  const { HAND_DEFINITIONS } = await import('../js/engine/cards.js');
  const game = newGame('Keyblade', 4);
  const [player, rival, third] = game.players;
  // Deux cases au rival, une au joueur, pour l'Aimant GP et le Double Péage
  const commands = game.tiles.filter(t => t.type === TileType.NORMAL);
  for (const [tile, owner] of [[commands[0], rival], [commands[1], rival], [commands[2], player]]) {
    tile.owner = owner.id;
    tile.level = 1;
  }
  updateAllTolls(game.tiles);

  const fxOf = (type) => {
    game.takeEvents();
    game._resolveHandEffect(player, HAND_DEFINITIONS.find(h => h.type === type), rival.id);
    return game.takeEvents().find(e => e.type === 'announce').fx;
  };

  assert.deepEqual(fxOf('stun'), { type: 'stun', targetId: rival.id });
  assert.deepEqual(fxOf('two_dice'), { type: 'dice', count: 2 });
  assert.deepEqual(fxOf('three_dice'), { type: 'dice', count: 3 });
  assert.deepEqual(fxOf('gp_protector'), { type: 'shield' });
  assert.deepEqual(fxOf('navigator'), { type: 'navigator' });
  assert.deepEqual(fxOf('confuse'), { type: 'confuse', targetIds: [rival.id, third.id] });
  assert.deepEqual(fxOf('double_toll'), { type: 'doubleToll', tileIds: [commands[2].id] });
  assert.deepEqual(fxOf('gp_magnet'), { type: 'magnet', tileIds: [commands[0].id, commands[1].id].sort((a, b) => a - b) });
  for (const type of ['jokers_fortune', 'golden_chance']) {
    const fx = fxOf(type);
    assert.equal(fx.type, 'roulette');
    assert.ok(fx.then === null || typeof fx.then.type === 'string');
  }
});
