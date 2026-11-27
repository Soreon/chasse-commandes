import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Game } from '../js/engine/game.js';
import { RULES } from '../js/engine/config.js';
import { JOURNAL_FORMAT } from '../js/engine/journal.js';
import { replayJournal } from '../js/engine/replay.js';
import { runHeadless } from '../js/engine/headless.js';

const boards = JSON.parse(readFileSync(fileURLToPath(new URL('../boards.json', import.meta.url)), 'utf8'));

function playedGame(boardName = 'Skull', seed = 21) {
  const game = new Game({
    boardEntry: boards[boardName], boardName, gpGoal: 7500, seed,
    players: [{ name: 'A', isHuman: false }, { name: 'B', isHuman: false }, { name: 'C', isHuman: false }],
  });
  runHeadless(game);
  return game;
}

// Le journal tel qu'il serait écrit dans un fichier puis relu
const exported = game => JSON.parse(JSON.stringify(game.journal));

test('le journal note tout ce qu\'il faut pour comprendre une partie', () => {
  const game = playedGame();
  const data = exported(game);

  assert.equal(data.format, JOURNAL_FORMAT);
  assert.equal(data.meta.setup.boardName, 'Skull');
  assert.equal(data.meta.setup.seed, 21);
  assert.equal(data.meta.setup.players.length, 3);
  assert.equal(data.meta.rules.winOnPass, RULES.winOnPass);

  const byType = {};
  for (const entry of data.entries) byType[entry.type] = (byType[entry.type] || 0) + 1;
  for (const type of ['turn', 'request', 'choice', 'log', 'gp', 'end']) {
    assert.ok(byType[type] > 0, `aucune entrée « ${type} »`);
  }

  // Numérotation continue, tours croissants
  data.entries.forEach((entry, i) => assert.equal(entry.n, i));
  assert.ok(data.entries.every((entry, i) => i === 0 || entry.turn >= data.entries[i - 1].turn));

  // Un instantané de tour décrit joueurs, cases possédées et hasard
  const turn = data.entries.filter(e => e.type === 'turn').pop();
  assert.equal(turn.players.length, 3);
  assert.ok(Array.isArray(turn.tiles));
  assert.equal(typeof turn.rng, 'number');
  assert.ok('gp' in turn.players[0] && 'position' in turn.players[0] && 'hand' in turn.players[0]);

  // Chaque mouvement de GP dit qui, combien, pourquoi, et le solde obtenu
  const gp = data.entries.find(e => e.type === 'gp');
  assert.ok(Number.isInteger(gp.playerId) && typeof gp.amount === 'number' && gp.source && typeof gp.gp === 'number');

  // Les soldes notés au fil de l'eau aboutissent bien au solde final de chaque joueur
  const end = data.entries.find(e => e.type === 'end');
  assert.equal(end.winnerId, game.winnerId);
  for (const player of game.players) {
    const last = data.entries.filter(e => e.type === 'gp' && e.playerId === player.id).pop();
    if (last && !player.eliminated) assert.equal(last.gp, player.gp, `solde final de ${player.name}`);
  }
});

test('une partie se rejoue à l\'identique à partir de son journal', () => {
  const game = playedGame('Spaceship', 5);
  const report = replayJournal(exported(game));

  assert.equal(report.problem, null);
  assert.equal(report.ok, true);
  assert.equal(report.complete, true);
  assert.ok(report.turnsChecked > 10, `${report.turnsChecked} tours vérifiés`);
});

test('le rejeu signale la première différence', () => {
  const data = exported(playedGame('Keyblade', 8));

  // Un solde falsifié dans un instantané de tour
  const tampered = JSON.parse(JSON.stringify(data));
  const turn = tampered.entries.filter(e => e.type === 'turn')[6];
  turn.players[1].gp += 1;
  const report = replayJournal(tampered);
  assert.equal(report.ok, false);
  assert.equal(report.problem.at, turn.n);
  assert.equal(report.problem.details[0].field, 'players');

  // Une règle différente de celle du jour de la partie : la partie ne se déroule plus pareil
  const otherRules = JSON.parse(JSON.stringify(data));
  otherRules.meta.rules.checkpointBonus = 50;
  assert.equal(replayJournal(otherRules).ok, false);

  // Les règles du moteur sont remises en place après un rejeu
  assert.equal(RULES.checkpointBonus, data.meta.rules.checkpointBonus);

  assert.equal(replayJournal({ format: 'autre' }).ok, false);
});

test('un journal interrompu se rejoue jusqu\'où il va', () => {
  const data = exported(playedGame('Honeypot', 3));
  const cut = { ...data, entries: data.entries.slice(0, Math.floor(data.entries.length / 2)) };
  const report = replayJournal(cut);
  assert.equal(report.ok, true);
  assert.equal(report.complete, false);
  assert.ok(report.turnsChecked > 0);
});

test('le journal d\'une partie reprise depuis une sauvegarde se rejoue aussi', () => {
  const original = new Game({
    boardEntry: boards.Royal, boardName: 'Royal', gpGoal: 7500, seed: 13,
    players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  });
  let saved = null;
  runHeadless(original, {
    onRequest: (request, game) => {
      if (!saved && request.type === 'turnStart' && game.turnNumber === 5) saved = game.serialize();
    },
  });

  const resumed = Game.restore(JSON.parse(JSON.stringify(saved)));
  runHeadless(resumed);
  const data = exported(resumed);
  assert.ok(data.meta.restore, 'le journal garde la sauvegarde dont la partie est repartie');
  assert.equal(data.entries.find(e => e.type === 'turn').turn, 5);

  const report = replayJournal(data);
  assert.equal(report.problem, null);
  assert.equal(report.complete, true);
  assert.equal(resumed.winnerId, original.winnerId);
});

test('journal coupé : rien n\'est noté, la partie se déroule pareil', () => {
  const withJournal = playedGame('Toon', 2);
  const without = new Game({
    boardEntry: boards.Toon, boardName: 'Toon', gpGoal: 7500, seed: 2,
    players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  });
  without.journal.enabled = false;
  runHeadless(without);

  assert.equal(without.journal.entries.length, 0);
  assert.equal(without.winnerId, withJournal.winnerId);
  assert.equal(without.turnNumber, withJournal.turnNumber);
});
