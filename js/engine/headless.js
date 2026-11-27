// Fait jouer une partie d'un bout à l'autre sans interface : toutes les décisions sont
// prises par l'IA, les effets visuels sont ignorés. Sert aux tests et à la simulation.

import { decide } from './ai.js';

// Retourne true si la partie s'est terminée, false si la limite de tours a été atteinte.
export function runHeadless(game, { maxTurns = 500, onRequest = null } = {}) {
  if (!game.pending) game.start();

  while (!game.over && game.pending) {
    if (game.turnNumber > maxTurns) return false;
    const request = game.pending;
    if (onRequest) onRequest(request, game);
    game.resume(request.kind === 'decision' ? decide(game, request) : undefined);
    game.events.length = 0;
  }
  return game.over;
}
