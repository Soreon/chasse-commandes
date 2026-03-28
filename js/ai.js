// Intelligence Artificielle pour les adversaires

import { HandType, getAvailableHands, canPlaceOnTile } from './cards.js';
import { TileType, getUpgradeCost, getBuyoutCost } from './board.js';

export class AI {
  // Choisit une main de cartes a jouer (ou null pour passer)
  static chooseHand(player, allPlayers, board) {
    const available = getAvailableHands(player.hand);
    if (available.length === 0) return null;

    // 30% de chance de jouer une main
    if (Math.random() > 0.4) return null;

    // Priorite : Stun si adversaire en tete, GP Protector si GP bas, Two/Three Dice, etc.
    const leader = allPlayers
      .filter(p => p.id !== player.id)
      .sort((a, b) => b.gp - a.gp)[0];

    // Stun sur le leader s'il est loin devant
    const stunHand = available.find(h => h.type === HandType.STUN);
    if (stunHand && leader && leader.gp > player.gp + 500) {
      return { handDef: stunHand, targetId: leader.id };
    }

    // GP Protector si GP bas
    const protector = available.find(h => h.type === HandType.GP_PROTECTOR);
    if (protector && player.gp < 500) {
      return { handDef: protector };
    }

    // Double Toll si on a des cases
    const doubleToll = available.find(h => h.type === HandType.DOUBLE_TOLL);
    const ownedTiles = board.filter(t => t.owner === player.id).length;
    if (doubleToll && ownedTiles >= 3) {
      return { handDef: doubleToll };
    }

    // GP Magnet si adversaires ont beaucoup de cases
    const gpMagnet = available.find(h => h.type === HandType.GP_MAGNET);
    if (gpMagnet) {
      let totalEnemyTiles = 0;
      for (const p of allPlayers) {
        if (p.id !== player.id) totalEnemyTiles += board.filter(t => t.owner === p.id).length;
      }
      if (totalEnemyTiles >= 5) return { handDef: gpMagnet };
    }

    // Two Dice (bonne mobilite)
    const twoDice = available.find(h => h.type === HandType.TWO_DICE);
    if (twoDice && Math.random() < 0.5) {
      return { handDef: twoDice };
    }

    // Joker's Fortune (toujours jouer si disponible car le Joker ne peut pas etre place)
    const jokersFortune = available.find(h => h.type === HandType.JOKERS_FORTUNE);
    if (jokersFortune) return { handDef: jokersFortune };

    // Golden Chance
    const goldenChance = available.find(h => h.type === HandType.GOLDEN_CHANCE);
    if (goldenChance) return { handDef: goldenChance };

    return null;
  }

  // Choisit la direction a une intersection
  static chooseDirection(player, moves, board, allPlayers) {
    let bestMove = moves[0];
    let bestScore = -Infinity;

    for (const move of moves) {
      const tile = board[move.tileId];
      let score = 0;

      // Chercher les checkpoints non visites
      if (tile.type.startsWith('checkpoint_')) {
        const color = tile.type.split('_')[1];
        if (!player.checkpoints[color]) {
          score += 50;
        }
      }

      // Bonus
      if (tile.type === TileType.BONUS) score += 20;
      if (tile.type === TileType.START) score += 15;

      // Les liens sont strategiques (raccourcis)
      if (move.isLink) score += 8;

      // Eviter les cases adverses avec gros peage
      if (tile.owner !== null && tile.owner !== player.id) {
        score -= tile.tollValue / 10;
      }

      // Preferer les cases vides (possibilite d'achat)
      if (tile.type === TileType.NORMAL && tile.owner === null) {
        score += 10;
      }

      // Preferer les cases de la meme zone que celles deja possedees
      if (tile.type === TileType.NORMAL && tile.owner === null && tile.zone) {
        const ownedInZone = board.filter(t => t.zone === tile.zone && t.owner === player.id).length;
        if (ownedInZone > 0) score += 15 * ownedInZone;
      }

      // Preferer nos propres cases (possibilite d'upgrade)
      if (tile.owner === player.id) {
        score += 5;
      }

      // Eviter les degats (sauf si on chevauche un Prize Cube)
      if (tile.type === TileType.DAMAGE) {
        if (player.prizeCube) {
          score += 5; // On est protege, les degats sont accumules
        } else if (tile.hasDice) {
          score += 10; // Prize Cube disponible !
        } else {
          score -= 15;
        }
      }

      // Booster
      if (tile.type === TileType.BOOSTER) score += 12;

      // Un peu d'aleatoire
      score += Math.random() * 10;

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  // Decide s'il faut acheter une case
  static shouldBuyTile(player, tile, board) {
    if (player.gp < tile.baseValue) return false;

    const placeableCards = player.hand.filter(c => canPlaceOnTile(c));
    if (placeableCards.length === 0) return false;

    // Toujours acheter si dans une zone ou on a deja des cases
    if (tile.zone) {
      const ownedInZone = board.filter(t => t.zone === tile.zone && t.owner === player.id).length;
      if (ownedInZone > 0) return true;
    }

    // Acheter si on a au moins 50% de plus que le cout
    if (player.gp > tile.baseValue * 1.5) return true;

    return player.gp > tile.baseValue * 2;
  }

  // Choisit la carte a placer sur une case achetee (pas de Joker ni Magie)
  static chooseCardToPlace(player) {
    const placeable = player.hand
      .filter(c => canPlaceOnTile(c))
      .sort((a, b) => b.value - a.value);
    return placeable[0] || null;
  }

  // Decide s'il faut ameliorer une case
  static shouldUpgradeTile(player, tile) {
    const cost = getUpgradeCost(tile);
    if (player.gp < cost) return false;
    if (tile.level >= 3) return false;
    return player.gp > cost * 2;
  }

  // Decide s'il faut racheter de force une case adverse
  static shouldBuyout(player, tile) {
    const cost = getBuyoutCost(tile);
    if (player.gp < cost) return false;
    return player.gp > cost * 2 && tile.tollValue > 200;
  }
}
