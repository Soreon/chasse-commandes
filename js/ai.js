// Intelligence Artificielle pour les adversaires

import { CardType } from './cards.js';
import { TileType, getUpgradeCost, getBuyoutCost } from './board.js';

export class AI {
  // Choisit les cartes a sacrifier pour le lancer de des (1, 2 ou 3)
  static chooseDiceCards(player) {
    // Strategie simple : toujours lancer 1 de sauf si beaucoup de cartes
    if (player.hand.length >= 4 && Math.random() < 0.3) {
      // Sacrifier 1 carte supplémentaire pour lancer 2 des
      const sacrificeable = player.hand.filter(c => c.type === CardType.ATTACK);
      if (sacrificeable.length >= 1) {
        return [sacrificeable[0].instanceId];
      }
    }
    return []; // Lancer standard (1 de)
  }

  // Choisit la direction a une intersection
  static chooseDirection(player, possibleNextTiles, board, allPlayers) {
    // Priorite : checkpoint non visite > bonus > case vide > eviter peages
    let bestTile = possibleNextTiles[0];
    let bestScore = -Infinity;

    for (const tileId of possibleNextTiles) {
      const tile = board[tileId];
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

      // Eviter les cases adverses avec gros peage
      if (tile.owner !== null && tile.owner !== player.id) {
        score -= tile.tollValue / 10;
      }

      // Preferer les cases vides (possibilite d'achat)
      if (tile.type === TileType.NORMAL && tile.owner === null) {
        score += 10;
      }

      // Preferer nos propres cases (possibilite d'upgrade)
      if (tile.owner === player.id) {
        score += 5;
      }

      // Eviter les degats
      if (tile.type === TileType.DAMAGE) score -= 15;

      // Un peu d'aleatoire
      score += Math.random() * 10;

      if (score > bestScore) {
        bestScore = score;
        bestTile = tileId;
      }
    }

    return bestTile;
  }

  // Decide s'il faut acheter une case
  static shouldBuyTile(player, tile, board) {
    if (player.gp < tile.baseValue) return false;

    // Toujours acheter si on a assez et si on a des cartes
    const attackCards = player.hand.filter(c => c.type !== CardType.MAGIC);
    if (attackCards.length === 0) return false;

    // Acheter si on a au moins 50% de plus que le cout
    if (player.gp > tile.baseValue * 1.5) return true;

    // Acheter si une case adjacente nous appartient (creer une chaine)
    for (const connId of tile.connections) {
      if (board[connId].owner === player.id) return true;
    }

    return player.gp > tile.baseValue * 2;
  }

  // Choisit la carte a placer sur une case achetee
  static chooseCardToPlace(player) {
    // Placer la carte attaque de plus haute valeur
    const attackCards = player.hand
      .filter(c => c.type !== CardType.MAGIC)
      .sort((a, b) => b.value - a.value);
    return attackCards[0] || player.hand[0];
  }

  // Decide s'il faut ameliorer une case
  static shouldUpgradeTile(player, tile) {
    const cost = getUpgradeCost(tile);
    if (player.gp < cost) return false;
    if (tile.level >= 3) return false;
    return player.gp > cost * 2; // Garder une marge
  }

  // Decide s'il faut racheter de force une case adverse
  static shouldBuyout(player, tile) {
    const cost = getBuyoutCost(tile);
    if (player.gp < cost) return false;
    // Racheter seulement si c'est strategique et qu'on est tres riche
    return player.gp > cost * 2 && tile.tollValue > 200;
  }

  // Choisit une carte magie a jouer (ou null)
  static chooseMagicCard(player, allPlayers) {
    const magicCards = player.hand.filter(c => c.type === CardType.MAGIC);
    if (magicCards.length === 0) return null;

    // 30% de chance de jouer une magie
    if (Math.random() > 0.3) return null;

    // Jouer Soin si GP bas
    const cure = magicCards.find(c => c.magicEffect === 'heal');
    if (cure && player.gp < 500) return cure;

    // Jouer Foudre sur le joueur en tete
    const thunder = magicCards.find(c => c.magicEffect === 'stun');
    if (thunder) {
      const leader = allPlayers
        .filter(p => p.id !== player.id)
        .sort((a, b) => b.gp - a.gp)[0];
      if (leader && leader.gp > player.gp + 500) {
        return { card: thunder, targetId: leader.id };
      }
    }

    return null;
  }

  // Choisit la cible d'une magie
  static chooseTarget(player, allPlayers) {
    // Cibler le joueur le plus riche
    return allPlayers
      .filter(p => p.id !== player.id)
      .sort((a, b) => b.gp - a.gp)[0];
  }
}
