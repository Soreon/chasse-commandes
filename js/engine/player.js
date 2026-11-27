// Modèle de joueur. Module pur.

import { RULES } from './config.js';

export const PLAYER_COLORS = ['#4a9eff', '#ff6b6b', '#50e890'];
export const AI_NAMES = ['Terra', 'Aqua'];

export function createPlayer(id, name, isHuman, color, hand) {
  return {
    id,
    name,
    isHuman,
    color,
    gp: RULES.startingGP,   // GP en poche
    position: 0,            // id de la case occupée
    hand,
    checkpoints: { red: false, blue: false, yellow: false, green: false },
    // États temporaires
    stunned: false,         // passe son prochain tour
    confusedTurns: 0,       // tours restants à partir au hasard aux intersections
    gpProtector: 0,         // pertes de GP encore bloquées (cumulable)
    doubleTollTurns: 0,     // tours restants de péages doublés
    justiceTurns: 0,        // tours restants avec Captain Justice
    darkTurns: 0,           // tours restants avec Captain Dark
    boosterPercent: RULES.boosterStart,
    lastDirection: null,    // pour interdire le demi-tour
    eliminated: false,
  };
}

// Fortune = GP en poche + valeur des cases possédées
export function calculateNetWorth(player, tiles) {
  let tileValues = 0;
  for (const tile of tiles) {
    if (tile.owner === player.id) tileValues += tile.currentValue;
  }
  return player.gp + tileValues;
}

export function removeCardFromHand(player, instanceId) {
  const idx = player.hand.findIndex(c => c.instanceId === instanceId);
  return idx !== -1 ? player.hand.splice(idx, 1)[0] : null;
}

export function allCheckpointsVisited(player) {
  return Object.values(player.checkpoints).every(Boolean);
}

export function resetCheckpoints(player) {
  for (const color of Object.keys(player.checkpoints)) {
    player.checkpoints[color] = false;
  }
}
