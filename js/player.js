// Modele de joueur

import { createStartingHand, drawRandomCards } from './cards.js';

export const MAX_HAND_SIZE = 5;

export function createPlayer(id, name, isHuman = false, color = '#4a9eff') {
  return {
    id,
    name,
    isHuman,
    color,
    gp: 1000,           // GP de depart
    position: 0,         // ID de la case actuelle (depart)
    hand: createStartingHand(),
    checkpoints: {       // Checkpoints visites
      red: false,
      blue: false,
      yellow: false,
      green: false,
    },
    // Etats temporaires
    stunned: false,      // Passe le prochain tour
    frozen: false,       // De force (1-3) au prochain tour
    confused: false,     // Controles inverses
    tollShield: false,   // Reduit le prochain peage de 50%
    tollReflect: false,  // Renvoie le prochain peage
    hasJustice: false,   // Captain Justice attache
    hasDark: false,      // Captain Dark attache
    // Historique pour anti-demi-tour
    previousPosition: null,
  };
}

// Calcule la valeur nette d'un joueur
export function calculateNetWorth(player, board) {
  let tileValues = 0;
  for (const tile of board) {
    if (tile.owner === player.id) {
      tileValues += tile.currentValue;
    }
  }
  return player.gp + tileValues;
}

// Ajoute des GP a un joueur
export function addGP(player, amount) {
  player.gp += amount;
  if (player.gp < 0) player.gp = 0;
}

// Transfere des GP entre joueurs
export function transferGP(from, to, amount) {
  const actual = Math.min(from.gp, amount);
  from.gp -= actual;
  to.gp += actual;
  return actual;
}

// Ajoute une carte a la main (max 5)
export function addCardToHand(player, card) {
  if (player.hand.length < MAX_HAND_SIZE) {
    player.hand.push(card);
    return true;
  }
  return false;
}

// Retire une carte de la main par instanceId
export function removeCardFromHand(player, instanceId) {
  const idx = player.hand.findIndex(c => c.instanceId === instanceId);
  if (idx !== -1) {
    return player.hand.splice(idx, 1)[0];
  }
  return null;
}

// Restaure la main a 5 cartes (quand on passe par le depart)
export function refillHand(player) {
  const needed = MAX_HAND_SIZE - player.hand.length;
  if (needed > 0) {
    const newCards = drawRandomCards(needed);
    player.hand.push(...newCards);
  }
}

// Verifie si tous les checkpoints sont actives
export function allCheckpointsVisited(player) {
  return player.checkpoints.red &&
         player.checkpoints.blue &&
         player.checkpoints.yellow &&
         player.checkpoints.green;
}

// Reset les checkpoints apres un lap bonus
export function resetCheckpoints(player) {
  player.checkpoints.red = false;
  player.checkpoints.blue = false;
  player.checkpoints.yellow = false;
  player.checkpoints.green = false;
}

// Les couleurs des joueurs
export const PLAYER_COLORS = ['#4a9eff', '#ff6b6b', '#50e890'];
export const AI_NAMES = ['Terra', 'Aqua'];
