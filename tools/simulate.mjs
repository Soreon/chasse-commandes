// Simulation de parties IA contre IA, pour régler l'équilibrage avec des chiffres.
//
//   npm run simulate                          20 parties par plateau, 3 joueurs, objectif 7 500
//   npm run simulate -- --games 100 --board Skull
//   npm run simulate -- --set lapBonus=800 --set winOnPass=false
//   npm run simulate -- --json > resultats.json
//
//   npm run simulate -- --games 1 --board Keyblade --journal partie.json   (journal détaillé de la partie)
//
// Options : --games N  --board NOM|all  --players N  --goal GP  --seed N  --max-turns N  --journal FICHIER
//           --set cle=valeur (règle de js/engine/config.js, répétable)  --json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game } from '../js/engine/game.js';
import { RULES } from '../js/engine/config.js';
import { TileType } from '../js/engine/board.js';
import { runHeadless } from '../js/engine/headless.js';

function parseArgs(argv) {
  const opts = { games: 20, board: 'all', players: 3, goal: 7500, seed: 1, maxTurns: 500, json: false, set: [], journal: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === '--games') opts.games = Number(value());
    else if (arg === '--board') opts.board = value();
    else if (arg === '--players') opts.players = Number(value());
    else if (arg === '--goal') opts.goal = Number(value());
    else if (arg === '--seed') opts.seed = Number(value());
    else if (arg === '--max-turns') opts.maxTurns = Number(value());
    else if (arg === '--json') opts.json = true;
    else if (arg === '--journal') opts.journal = value();
    else if (arg === '--set') opts.set.push(value());
    else throw new Error(`Option inconnue : ${arg}`);
  }
  return opts;
}

function applyRuleOverrides(pairs) {
  for (const pair of pairs) {
    const [key, raw] = pair.split('=');
    if (!(key in RULES)) throw new Error(`Règle inconnue : ${key}`);
    RULES[key] = JSON.parse(raw);
  }
}

const median = values => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const mean = values => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function playOne(boardEntry, boardName, seed, opts) {
  const players = Array.from({ length: opts.players }, (_, i) => ({ name: `IA ${i + 1}`, isHuman: false }));
  const game = new Game({ boardEntry, boardName, players, gpGoal: opts.goal, seed });
  // Le journal détaillé ralentit la simulation en masse : on ne le garde que s'il est demandé
  game.journal.enabled = !!opts.journal;
  const finished = runHeadless(game, { maxTurns: opts.maxTurns });
  if (opts.journal) writeFileSync(opts.journal, JSON.stringify(game.journal));
  const winner = finished ? game.players[game.winnerId] : null;
  return {
    finished,
    turns: game.turnNumber,
    winner: game.winnerId,
    reason: game.winReason,
    winnerNet: winner ? game.netWorth(winner) : null,
    winnerCashShare: winner && game.netWorth(winner) > 0 ? winner.gp / game.netWorth(winner) : null,
    bankrupt: game.players.filter(p => p.eliminated).length,
    freeTiles: game.tiles.filter(t => t.type === TileType.NORMAL && t.owner === null).length,
    commandTiles: game.tiles.filter(t => t.type === TileType.NORMAL).length,
    maxLevel: Math.max(0, ...game.tiles.map(t => t.level)),
    flow: game.stats.flow,
    count: game.stats.count,
  };
}

function summarize(runs, players) {
  const done = runs.filter(r => r.finished);
  const flowKeys = [...new Set(runs.flatMap(r => Object.keys(r.flow)))];
  const countKeys = [...new Set(runs.flatMap(r => Object.keys(r.count)))];
  return {
    games: runs.length,
    finished: done.length,
    turns: { min: Math.min(...runs.map(r => r.turns)), median: median(runs.map(r => r.turns)), max: Math.max(...runs.map(r => r.turns)) },
    over100Turns: runs.filter(r => r.turns > 100).length,
    winsBySeat: Array.from({ length: players }, (_, i) => done.filter(r => r.winner === i).length),
    lastStandingWins: done.filter(r => r.reason === 'lastStanding').length,
    winnerNetMedian: median(done.map(r => r.winnerNet)),
    winnerCashShareMedian: Math.round(median(done.map(r => r.winnerCashShare)) * 100),
    bankruptPerGame: +mean(runs.map(r => r.bankrupt)).toFixed(2),
    freeTilesMedian: median(runs.map(r => r.freeTiles)),
    commandTiles: runs[0].commandTiles,
    maxLevel: Math.max(...runs.map(r => r.maxLevel)),
    flowPerGame: Object.fromEntries(flowKeys.map(k => [k, Math.round(mean(runs.map(r => r.flow[k] || 0)))])),
    countPerGame: Object.fromEntries(countKeys.map(k => [k, +mean(runs.map(r => r.count[k] || 0)).toFixed(1)])),
  };
}

function printSummary(name, s) {
  const pad = (v, n) => String(v).padStart(n);
  console.log(`\n=== ${name} (${s.commandTiles} cases commande) ===`);
  console.log(`  parties terminées      ${s.finished}/${s.games}   dont au dernier survivant : ${s.lastStandingWins}`);
  console.log(`  tours (min/méd/max)    ${s.turns.min} / ${s.turns.median} / ${s.turns.max}   parties de plus de 100 tours : ${s.over100Turns}`);
  console.log(`  victoires par siège    ${s.winsBySeat.join(' / ')}`);
  console.log(`  fortune du vainqueur   ${s.winnerNetMedian} GP (médiane), dont ${s.winnerCashShareMedian} % en liquide`);
  console.log(`  faillites par partie   ${s.bankruptPerGame}   cases libres en fin : ${s.freeTilesMedian}   niveau max atteint : ${s.maxLevel}`);
  const flows = Object.entries(s.flowPerGame).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  console.log('  GP par partie, par origine :');
  for (const [key, value] of flows) console.log(`    ${key.padEnd(12)} ${pad(value, 8)}`);
  const counts = Object.entries(s.countPerGame).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`  actions par partie : ${counts.map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

const opts = parseArgs(process.argv.slice(2));
applyRuleOverrides(opts.set);

const boardsPath = fileURLToPath(new URL('../boards.json', import.meta.url));
const boards = JSON.parse(readFileSync(boardsPath, 'utf8'));
const names = opts.board === 'all' ? Object.keys(boards) : [opts.board];

const report = {};
const allRuns = [];
for (const name of names) {
  if (!boards[name]) throw new Error(`Plateau inconnu : ${name} (disponibles : ${Object.keys(boards).join(', ')})`);
  const runs = [];
  for (let i = 0; i < opts.games; i++) runs.push(playOne(boards[name], name, opts.seed + i, opts));
  report[name] = summarize(runs, opts.players);
  allRuns.push(...runs);
}
if (names.length > 1) report.TOUS = summarize(allRuns, opts.players);

if (opts.json) {
  console.log(JSON.stringify({ options: opts, report }, null, 2));
} else {
  console.log(`${opts.games} parties par plateau, ${opts.players} joueurs, objectif ${opts.goal} GP, graine ${opts.seed}`);
  if (opts.set.length) console.log(`Règles modifiées : ${opts.set.join(', ')}`);
  for (const [name, summary] of Object.entries(report)) printSummary(name, summary);
}
