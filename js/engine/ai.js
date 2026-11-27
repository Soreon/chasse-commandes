// Intelligence artificielle : répond aux décisions demandées par le moteur. Module pur.
// Tout le hasard vient de `game.rng`, donc une partie reste rejouable à l'identique.

import { RULES } from './config.js';
import {
  TileType, getAvailableMoves, distancesTo, directedDistances, getUpgradeCost, getBuyCost,
  isCheckpoint, getCheckpointColor, countOwnedInZone, countTilesInZone,
} from './board.js';
import { CardType, HandType, DIE_FACES, canPlaceOnTile } from './cards.js';
import { allCheckpointsVisited } from './player.js';
import { GLIDER_BOARDS } from './game.js';

// Poids de l'IA, en « équivalent GP ». C'est ici qu'on règle son caractère.
const W = {
  win: 100000,          // atteindre le Départ avec l'objectif rempli
  stepToTarget: 25,     // valeur d'un pas de moins vers l'objectif de route
  lapExtra: 200,        // valeur de la main complétée par le bonus de tour
  checkpointCard: 80,   // valeur de la carte gagnée à un checkpoint
  freeTile: 120,        // intérêt d'atterrir sur une case achetable
  zoneTile: 60,         // ... par case déjà possédée dans la même zone
  zoneComplete: 200,    // ... si l'achat complète la zone
  upgrade: 60,
  event: 250,
  honey: 250,
  bonus: 40,            // en plus d'une case libre : une case Bonus ne coûte aucune carte
  outlook: 0.8,         // poids de ce qui attend le joueur au tour suivant
  cubeStep: 40,         // un pas sur un Prize Cube : gain incertain tant qu'il ne s'est pas brisé
  protectorUse: 30,     // coût de consommer un Protecteur GP
  noise: 10,            // un peu de hasard pour varier les parties
  buyReserve: 150,      // GP gardés en poche après un achat
  upgradeReserve: 200,
};

export function decide(game, request) {
  const player = game.players[request.playerId];
  switch (request.type) {
    case 'turn': return decideTurn(game, player, request);
    case 'direction': return decideDirection(game, player, request);
    case 'buy': return decideBuy(game, player, request);
    case 'upgrade': return { upgrade: player.gp - request.cost >= W.upgradeReserve };
    case 'toll': return decideToll(game, player, request);
    case 'bonus': return decideBonus(game, player, request);
    case 'forcedSale': return decideForcedSale(game, player, request);
    case 'teleport': return decideTeleport(game, player, request);
    case 'pixieDust': return decidePixieDust(game, player, request);
    default: return undefined;
  }
}

function avgDamage() {
  return RULES.damageMin + RULES.damageSpread / 2;
}

// === Route ===

// Le joueur a-t-il intérêt à rentrer au Départ ? (victoire possible ou tour complet)
function startStatus(game, player) {
  const wouldWin = game.netWorth(player) >= game.gpGoal;
  const lapReady = allCheckpointsVisited(player);
  return { wouldWin, lapReady };
}

// Cases vers lesquelles se diriger : le Départ si on doit y rentrer, sinon les checkpoints manquants
function routeTargets(game, player) {
  const { wouldWin, lapReady } = startStatus(game, player);
  if (wouldWin || lapReady) return [game.startTileId];
  const missing = game.tiles
    .filter(t => isCheckpoint(t.type) && !player.checkpoints[getCheckpointColor(t.type)])
    .map(t => t.id);
  return missing.length > 0 ? missing : [game.startTileId];
}

// Probabilité que la somme de `dice` dés atteigne au moins `distance`
function reachChance(dice, distance) {
  if (distance <= dice) return 1;
  if (distance > dice * DIE_FACES) return 0;
  let counts = new Map([[0, 1]]);
  for (let d = 0; d < dice; d++) {
    const nextCounts = new Map();
    for (const [sum, n] of counts) {
      for (let face = 1; face <= DIE_FACES; face++) {
        nextCounts.set(sum + face, (nextCounts.get(sum + face) || 0) + n);
      }
    }
    counts = nextCounts;
  }
  let hits = 0;
  let total = 0;
  for (const [sum, n] of counts) {
    total += n;
    if (sum >= distance) hits += n;
  }
  return hits / total;
}

function tollOf(game, tile) {
  const owner = game.players[tile.owner];
  return tile.tollValue * (owner.doubleTollTurns > 0 ? 2 : 1);
}

function anyCubeAt(game, tileId) {
  return game.prizeCubes.some(c => c.tileId === tileId);
}

// Intérêt d'entrer sur une case, qu'on s'y arrête ou non
function enterScore(game, player, tile) {
  let score = 0;
  if (isCheckpoint(tile.type) && !player.checkpoints[getCheckpointColor(tile.type)]) {
    score += RULES.checkpointBonus + W.checkpointCard;
  }
  if (game.honeyPots.some(p => p.tileId === tile.id)) score += W.honey;
  return score;
}

// Intérêt de traverser une case sans s'y arrêter
function passScore(game, player, tile, status) {
  if (tile.type === TileType.START) {
    let score = RULES.startPassBonus;
    if (status.lapReady) score += RULES.lapBonus + W.lapExtra;
    if (status.wouldWin && RULES.winOnPass) score += W.win;
    return score;
  }
  if (tile.type === TileType.BOOSTER) return Math.max(0, player.gp) * RULES.boosterStep / 100;
  return 0;
}

// Intérêt de terminer son déplacement sur une case
function landScore(game, player, tile, status, riding) {
  switch (tile.type) {
    case TileType.START: {
      let score = RULES.startStopBonus;
      if (status.lapReady) score += RULES.lapBonus + W.lapExtra;
      if (status.wouldWin) score += W.win;
      return score;
    }
    case TileType.NORMAL:
    case TileType.BONUS: {
      if (tile.owner === null && tile.type === TileType.BONUS) {
        // Case Bonus libre : achetable sans dépenser de carte
        return player.gp - getBuyCost(tile, tile.presetCard) >= W.buyReserve ? W.freeTile + W.bonus : 0;
      }
      if (tile.owner === null) {
        const canBuy = player.hand.some(canPlaceOnTile) && player.gp >= tile.baseValue + 2 * RULES.cardValueGP;
        if (!canBuy) return 0;
        const owned = countOwnedInZone(game.tiles, tile.zone, player.id);
        let score = W.freeTile + W.zoneTile * owned;
        if (tile.zone && owned === countTilesInZone(game.tiles, tile.zone) - 1) score += W.zoneComplete;
        return score;
      }
      if (tile.owner === player.id) {
        return tile.level < RULES.maxLevel && player.gp - getUpgradeCost(tile) >= W.upgradeReserve ? W.upgrade : 0;
      }
      return player.gpProtector > 0 ? -W.protectorUse : -tollOf(game, tile);
    }
    case TileType.DAMAGE:
      if (riding) return 0;
      return player.gpProtector > 0 ? -W.protectorUse : -avgDamage();
    case TileType.EVENT:
      return W.event;
    case TileType.BOOSTER:
      return Math.max(0, player.gp) * player.boosterPercent / 100;
    default:
      return 0;
  }
}

// Ce que rapporte un Prize Cube quand il se brise sous le joueur : son magot, plus ce que les
// derniers pas y ajoutent (déjà comptés en partie pas à pas)
function cubePayout(game, cubeId) {
  const cube = game.prizeCubes.find(c => c.id === cubeId);
  const avgGain = RULES.cubeGainMin + RULES.cubeGainSpread / 2;
  return cube.accumulatedGP + cube.counter * Math.max(0, avgGain - W.cubeStep);
}

// Chance qu'une case Événement téléporte le joueur là où il veut (plateaux à Keyblade Glider)
function teleportOdds(game) {
  return GLIDER_BOARDS.includes(game.boardName) ? 1 - RULES.captainChance : 0;
}

// Le cube vient de se briser sous le joueur : il est à l'abri pour cet arrêt, mais n'a plus de cube
const JUST_BROKE = { broke: true };

// Meilleur premier pas pour un déplacement de `steps` cases. On explore tous les trajets possibles
// (avec mémoïsation) en notant ce qu'on traverse et la case d'arrivée. Puis on regarde un tour
// plus loin : en moyenne sur le prochain lancer de dé, où pourra-t-on s'arrêter depuis là, et à
// quelle distance de son objectif (sans demi-tour) ? Cela évite de s'engager dans une boucle ou
// une impasse d'où l'on sera forcé de mal finir.
function decideDirection(game, player, request) {
  const { moves, stepsRemaining } = request;
  const tiles = game.tiles;
  const status = startStatus(game, player);
  const toTarget = directedDistances(tiles, routeTargets(game, player));
  const navigator = game.activeHandEffect === HandType.NAVIGATOR;
  const teleport = teleportOdds(game);
  const memo = new Map();

  // Arrêt du tour suivant : valeur de la case et chemin restant vers l'objectif
  const finalValue = (tileId, lastDir, ride) => {
    const distance = toTarget(tileId, lastDir);
    const steps = distance === Infinity ? tiles.length : distance;
    return landScore(game, player, tiles[tileId], status, ride !== null) - W.stepToTarget * steps;
  };

  // Arrêt de ce tour : valeur de la case, plus ce qui attend le joueur au tour suivant
  const landingValue = (tileId, lastDir, ride) => {
    const tile = tiles[tileId];
    const riding = ride === JUST_BROKE ? null : ride;
    let outlook = 0;
    for (let roll = 1; roll <= DIE_FACES; roll++) outlook += valueFrom(tileId, lastDir, roll, riding, 1);
    outlook /= DIE_FACES;
    // Une case qui téléporte : la suite ne dépend de cet endroit que si la téléportation échoue
    if (tile.type === TileType.EVENT) outlook *= 1 - teleport;
    return landScore(game, player, tile, status, ride !== null) + W.outlook * outlook;
  };

  // Valeur du meilleur trajet restant, debout sur `tileId` avec `remaining` pas à faire.
  // `ride` : null, ou { id, left } quand on chevauche un Prize Cube à qui il reste `left` pas.
  // `depth` : 0 pour le déplacement en cours, 1 pour celui du tour suivant.
  const valueFrom = (tileId, lastDir, remaining, ride, depth) => {
    if (remaining === 0) {
      return depth === 0 ? landingValue(tileId, lastDir, ride) : finalValue(tileId, lastDir, ride);
    }
    const riding = ride === JUST_BROKE ? null : ride;
    const key = `${depth}|${tileId}|${lastDir}|${remaining}|${riding ? `${riding.id}:${riding.left}` : ''}`;
    if (memo.has(key)) return memo.get(key);
    // Le Navigateur ne lève l'interdiction de demi-tour que pour le tour en cours
    const anyDirection = navigator && depth === 0;
    let best = -Infinity;
    for (const move of getAvailableMoves(tiles, tileId, anyDirection ? null : lastDir)) {
      best = Math.max(best, stepValue(move, remaining, riding, depth));
    }
    memo.set(key, best);
    return best;
  };

  const stepValue = (move, remaining, ride, depth) => {
    const tile = tiles[move.tileId];
    let score = enterScore(game, player, tile);
    let nextRide = null;
    if (tile.type === TileType.DAMAGE) {
      if (ride) {
        // Le cube suit : chaque pas l'approche du moment où il se brise et paie
        score += W.cubeStep;
        if (ride.left <= 1) {
          score += cubePayout(game, ride.id);
          nextRide = JUST_BROKE;
        } else {
          nextRide = { id: ride.id, left: ride.left - 1 };
        }
      } else {
        const cube = game.prizeCubes.find(c => c.tileId === tile.id);
        if (cube) nextRide = { id: cube.id, left: cube.counter };
      }
    }
    if (remaining > 1) {
      const pass = passScore(game, player, tile, status);
      if (pass >= W.win) return score + pass; // victoire au passage : la suite ne compte plus
      score += pass;
    }
    return score + valueFrom(move.tileId, move.direction, remaining - 1, nextRide, depth);
  };

  const ridden = game.cubeOf(player.id);
  const startRide = ridden ? { id: ridden.id, left: ridden.counter } : null;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = stepValue(move, stepsRemaining, startRide, 0) + game.rng.next() * W.noise;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return { tileId: best.tileId };
}

// === Mains de cartes ===

function decideTurn(game, player, request) {
  const roll = { action: 'roll' };
  if (request.hands.length === 0) return roll;

  const has = type => request.hands.includes(type);
  const play = (handType, targetId) => ({ action: 'hand', handType, targetId });
  const rng = game.rng;

  const opponents = game.opponentsOf(player);
  const myNet = game.netWorth(player);
  const status = startStatus(game, player);
  const leader = [...opponents].sort((a, b) => game.netWorth(b) - game.netWorth(a))[0];
  const leaderNet = leader ? game.netWorth(leader) : 0;
  const threat = leader && leaderNet >= game.gpGoal * 0.85;

  // 1. Rentrer au Départ pour gagner : choisir ce qui donne le plus de chances d'y arriver ce tour
  if (status.wouldWin) {
    const forward = directedDistances(game.tiles, [game.startTileId])(player.position, player.lastDirection);
    const direct = distancesTo(game.tiles, [game.startTileId])[player.position];
    const options = [{ choice: roll, chance: reachChance(1, forward) }];
    if (has(HandType.TWO_DICE)) options.push({ choice: play(HandType.TWO_DICE), chance: reachChance(2, forward) });
    if (has(HandType.THREE_DICE)) options.push({ choice: play(HandType.THREE_DICE), chance: reachChance(3, forward) });
    if (has(HandType.NAVIGATOR)) options.push({ choice: play(HandType.NAVIGATOR), chance: reachChance(1, direct) });
    options.sort((a, b) => b.chance - a.chance);
    if (options[0].chance > options.find(o => o.choice === roll).chance) return options[0].choice;
    return roll;
  }

  // 2. Freiner un adversaire sur le point de gagner
  if (threat && has(HandType.STUN)) return play(HandType.STUN, leader.id);
  if (threat && has(HandType.CONFUSE) && leader.confusedTurns === 0) return play(HandType.CONFUSE);

  // 3. Jouer le reste avec retenue : chaque carte jouée est une case de moins à acheter
  if (!rng.chance(0.4)) return roll;

  if (has(HandType.STUN) && leader && leaderNet > myNet + 1500) return play(HandType.STUN, leader.id);
  if (has(HandType.GP_PROTECTOR) && player.gp < 500 && player.gpProtector === 0) return play(HandType.GP_PROTECTOR);

  const ownedTiles = game.tiles.filter(t => t.owner === player.id).length;
  if (has(HandType.DOUBLE_TOLL) && ownedTiles >= 3 && player.doubleTollTurns === 0) return play(HandType.DOUBLE_TOLL);

  const enemyTiles = game.tiles.filter(t => t.owner !== null && t.owner !== player.id).length;
  if (has(HandType.GP_MAGNET) && enemyTiles >= 5) return play(HandType.GP_MAGNET);

  if (has(HandType.GOLDEN_CHANCE)) return play(HandType.GOLDEN_CHANCE);
  if (has(HandType.JOKERS_FORTUNE)) return play(HandType.JOKERS_FORTUNE);

  // Aller plus vite quand le tour est bouclé et que le Départ est loin
  if (status.lapReady) {
    const forward = directedDistances(game.tiles, [game.startTileId])(player.position, player.lastDirection);
    if (has(HandType.THREE_DICE) && forward > 2 * DIE_FACES) return play(HandType.THREE_DICE);
    if (has(HandType.TWO_DICE) && forward > DIE_FACES) return play(HandType.TWO_DICE);
  }
  if (has(HandType.CONFUSE) && leader && leaderNet > myNet + 1500 && leader.confusedTurns === 0) return play(HandType.CONFUSE);

  return roll;
}

// === Cases ===

function decideBuy(game, player, request) {
  const tile = game.tiles[request.tileId];
  const inOwnZone = countOwnedInZone(game.tiles, tile.zone, player.id) > 0;
  const reserve = inOwnZone ? 0 : W.buyReserve;

  const withCards = request.options
    .map(o => ({ ...o, card: player.hand.find(c => c.instanceId === o.cardId) }))
    .filter(o => o.card && player.gp - o.cost >= reserve)
    .sort((a, b) => b.card.value - a.card.value);

  return withCards.length > 0 ? { cardId: withCards[0].cardId } : null;
}

function decideToll(game, player, request) {
  const tile = game.tiles[request.tileId];
  const completesZone = tile.zone
    && countOwnedInZone(game.tiles, tile.zone, player.id) === countTilesInZone(game.tiles, tile.zone) - 1;
  const cost = request.buyoutCost;
  const worthIt = (player.gp >= cost * 2 && request.toll >= 200) || (completesZone && player.gp >= cost * 1.3);
  return { action: worthIt ? 'buyout' : 'pay' };
}

// Case Bonus : on l'achète dès qu'il reste de quoi voir venir (elle ne coûte aucune carte)
function decideBonus(game, player, request) {
  return { buy: player.gp - request.cost >= W.buyReserve };
}

// Vendre le moins possible : la case la moins chère qui couvre la dette, sinon la plus chère
function decideForcedSale(game, _player, request) {
  const owned = request.tileIds.map(id => game.tiles[id]).sort((a, b) => a.currentValue - b.currentValue);
  const covering = owned.find(t => t.currentValue >= request.debt);
  return { tileId: (covering || owned[owned.length - 1]).id };
}

function decideTeleport(game, player, request) {
  const status = startStatus(game, player);
  const toTarget = directedDistances(game.tiles, routeTargets(game, player));
  let best = request.tileIds[0];
  let bestScore = -Infinity;
  for (const tileId of request.tileIds) {
    const tile = game.tiles[tileId];
    const riding = tile.type === TileType.DAMAGE && anyCubeAt(game, tileId);
    const distance = toTarget(tileId, null);
    const d = distance === Infinity ? game.tiles.length : distance;
    const score = enterScore(game, player, tile) + landScore(game, player, tile, status, riding)
      - W.stepToTarget * d + game.rng.next() * W.noise;
    if (score > bestScore) {
      bestScore = score;
      best = tileId;
    }
  }
  return { tileId: best };
}

// Envoyer l'adversaire le plus riche là où ça lui coûte le plus
function decidePixieDust(game, player, request) {
  const targets = request.targetIds.map(id => game.players[id]);
  const target = targets.sort((a, b) => game.netWorth(b) - game.netWorth(a))[0];
  const fromStart = distancesTo(game.tiles, [game.startTileId]);
  const targetWinning = game.netWorth(target) >= game.gpGoal;

  let best = target.position;
  let bestScore = 0;
  for (const tileId of request.tileIds) {
    const tile = game.tiles[tileId];
    let score = 0;
    if (tile.type === TileType.DAMAGE && !anyCubeAt(game, tileId)) score = avgDamage();
    if (tile.owner === player.id) score = tollOf(game, tile);
    if (target.gpProtector > 0) score = Math.min(score, W.protectorUse);
    if (targetWinning && fromStart[tileId] !== Infinity) score += fromStart[tileId] * W.stepToTarget;
    if (score > bestScore) {
      bestScore = score;
      best = tileId;
    }
  }
  return { targetId: target.id, tileId: best };
}
