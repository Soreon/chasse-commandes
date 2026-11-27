// Rejoue une partie à partir de son journal et vérifie qu'elle se déroule à l'identique.
// Module pur : sert aux tests et à l'outil d'analyse (tools/journal.mjs).
//
// Le journal contient de quoi recréer la partie (plateau, joueurs, graine, règles) et, pour
// chaque décision, le choix fait et l'état du hasard à cet instant. On refait donc exactement le
// même chemin, en comparant à chaque arrêt ce que le moteur demande, et à chaque début de tour
// l'état complet. La première différence signale soit un journal abîmé, soit un moteur qui ne
// se comporte plus comme le jour de la partie (règle modifiée, bogue, hasard non maîtrisé).

import { Game } from './game.js';
import { RULES } from './config.js';
import { JOURNAL_FORMAT } from './journal.js';

const clone = value => JSON.parse(JSON.stringify(value));

// Champs d'un instantané qui diffèrent entre le journal et la partie rejouée
function snapshotDifferences(recorded, replayed) {
  const differences = [];
  for (const key of Object.keys(replayed)) {
    if (JSON.stringify(recorded[key]) !== JSON.stringify(replayed[key])) {
      differences.push({ field: key, recorded: recorded[key], replayed: replayed[key] });
    }
  }
  return differences;
}

// Retourne { ok, complete, stops, turnsChecked, problem }.
//   ok           aucune différence constatée
//   complete     le journal va jusqu'à la fin de la partie (sinon elle a été interrompue)
//   problem      première différence : { at, turn, message, details }
export function replayJournal(data) {
  if (!data || data.format !== JOURNAL_FORMAT) {
    return { ok: false, complete: false, stops: 0, turnsChecked: 0, problem: { message: 'Ce fichier n\'est pas un journal de partie.' } };
  }

  const savedRules = { ...RULES };
  Object.assign(RULES, data.meta.rules || {});
  try {
    const game = data.meta.restore
      ? Game.restore(clone(data.meta.restore))
      : new Game(clone(data.meta.setup));
    game.journal.enabled = false;
    game.start();

    const steps = data.entries.filter(e => e.type === 'turn' || e.type === 'request' || e.type === 'choice');
    let cursor = 0;
    let stops = 0;
    let turnsChecked = 0;
    const fail = (entry, message, details) => ({
      ok: false, complete: false, stops, turnsChecked,
      problem: { at: entry ? entry.n : null, turn: entry ? entry.turn : game.turnNumber, message, details },
    });

    while (game.pending) {
      // Instantané de début de tour, juste avant l'arrêt correspondant
      const turnEntry = steps[cursor] && steps[cursor].type === 'turn' ? steps[cursor++] : null;

      const stop = steps[cursor++];
      if (!stop) return { ok: true, complete: false, stops, turnsChecked, problem: null }; // journal interrompu ici
      if (stop.type !== 'request') return fail(stop, `Entrée inattendue : « ${stop.type} » au lieu d'un arrêt du moteur.`);

      const expected = stop.request;
      const actual = game.pending;
      if (expected.kind !== actual.kind || expected.type !== actual.type || expected.playerId !== actual.playerId) {
        return fail(stop, 'Le moteur ne s\'arrête pas au même endroit.', { recorded: expected, replayed: actual });
      }
      stops++;

      if (turnEntry) {
        const differences = snapshotDifferences(turnEntry, game.snapshot());
        if (differences.length > 0) return fail(turnEntry, 'L\'état en début de tour diffère.', differences);
        turnsChecked++;
      }

      if (actual.kind === 'decision') {
        const choice = steps[cursor++];
        if (!choice) return { ok: true, complete: false, stops, turnsChecked, problem: null };
        if (choice.type !== 'choice') return fail(choice, `Entrée inattendue : « ${choice.type} » au lieu d'un choix.`);
        game.rng.setState(choice.rng);
        game.resume(choice.value === null ? undefined : choice.value);
      } else {
        game.resume();
      }
    }

    // Fin de partie : même vainqueur ?
    const end = data.entries.find(e => e.type === 'end');
    if (end && end.winnerId !== game.winnerId) {
      return fail(end, 'Le vainqueur diffère.', { recorded: end.winnerId, replayed: game.winnerId });
    }
    return { ok: true, complete: game.over, stops, turnsChecked, problem: null };
  } finally {
    Object.assign(RULES, savedRules);
  }
}
