// Analyse d'un journal de partie (fichier téléchargé depuis le jeu, ou produit par la simulation).
//
//   npm run journal -- partie.json              résumé : partie, joueurs, GP par origine, technique
//   npm run journal -- partie.json --replay     rejoue la partie et vérifie qu'elle se déroule à l'identique
//   npm run journal -- partie.json --turn 12    tout ce qui s'est passé au tour 12, dans l'ordre
//   npm run journal -- partie.json --errors     erreurs et images figées, avec leur contexte
//   npm run journal -- partie.json --player 1   mouvements de GP et décisions d'un joueur

import { readFileSync } from 'node:fs';
import { replayJournal } from '../js/engine/replay.js';
import { JOURNAL_FORMAT } from '../js/engine/journal.js';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const option = name => args.includes(`--${name}`);
const valueOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};

if (!file) {
  console.error('Usage : npm run journal -- <fichier.json> [--replay] [--turn N] [--errors] [--player N]');
  process.exit(1);
}

// Un fichier copié depuis certains outils peut commencer par une marque d'ordre des octets
const data = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
if (data.format !== JOURNAL_FORMAT) {
  console.error('Ce fichier n\'est pas un journal de partie.');
  process.exit(1);
}

const { meta, entries } = data;
const setup = meta.setup || {};
const players = setup.players || [];
const nameOf = id => (players[id] ? players[id].name : `joueur ${id}`);
const fmt = n => Math.round(n).toLocaleString('fr-FR');
const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const ofType = type => entries.filter(e => e.type === type);

// Description lisible d'une entrée
function describe(entry) {
  switch (entry.type) {
    case 'turn':
      return `── début du tour de ${nameOf(entry.players[entry.current].id)} : ${entry.players.map(p => `${p.name} ${fmt(p.gp)} GP (fortune ${fmt(p.net)}, case ${p.position})`).join(' | ')}`;
    case 'request': {
      const r = entry.request;
      if (r.kind === 'decision') return `? décision « ${r.type} » demandée à ${nameOf(r.playerId)}${r.stepsRemaining ? ` (${r.stepsRemaining} pas restants)` : ''}`;
      if (r.type === 'move') return `  déplacement de ${nameOf(r.playerId)} : case ${r.from} → ${r.to}${r.cubeId !== null && r.cubeId !== undefined ? ' (sur un Prize Cube)' : ''}`;
      if (r.type === 'dice') return `  dés de ${nameOf(r.playerId)} : ${r.rolls.join(' + ')}`;
      return `  effet « ${r.type} »${r.playerId !== undefined ? ` (${nameOf(r.playerId)})` : ''}`;
    }
    case 'choice':
      return `> ${nameOf(entry.playerId)} (${entry.human ? 'humain' : 'IA'}) répond à « ${entry.request} » : ${JSON.stringify(entry.value)}`;
    case 'log':
      return `  « ${entry.message} »`;
    case 'gp':
      return `  GP ${nameOf(entry.playerId)} ${entry.amount >= 0 ? '+' : ''}${fmt(entry.amount)} (${entry.source}) → ${fmt(entry.gp)}`;
    case 'announce':
      return `  annonce : ${nameOf(entry.playerId)} — ${entry.title} : ${entry.text}`;
    case 'notif':
      return `  notification : ${entry.text}`;
    case 'ui':
      return `* interface : ${entry.action}${entry.speed ? ` ×${entry.speed}` : ''}`;
    case 'perf':
      return `~ fluidité : ${entry.fps} images/s, pire image ${entry.worstFrameMs} ms${entry.visible === false ? ' (onglet masqué)' : ''}`;
    case 'slowFrame':
      return `! image figée pendant ${entry.ms} ms`;
    case 'visibility':
      return `* onglet ${entry.state === 'visible' ? 'revenu au premier plan' : 'masqué'}`;
    case 'error':
      return `!! ERREUR (${entry.kind}) : ${entry.message}`;
    case 'end':
      return `══ fin : ${nameOf(entry.winnerId)} gagne (${entry.reason === 'lastStanding' ? 'dernier en lice' : 'objectif atteint'})`;
    default:
      return `  ${entry.type} ${JSON.stringify(entry).slice(0, 140)}`;
  }
}

const line = entry => `${String(entry.n).padStart(5)}  ${seconds(entry.t).padStart(8)}  T${String(entry.turn).padEnd(3)} ${describe(entry)}`;

// --- Tour détaillé ---
if (valueOf('turn')) {
  const turn = Number(valueOf('turn'));
  const selected = entries.filter(e => e.turn === turn);
  console.log(`Tour ${turn} : ${selected.length} entrées\n`);
  for (const entry of selected) console.log(line(entry));
  process.exit(0);
}

// --- Erreurs et images figées, avec ce qui précède ---
if (option('errors')) {
  // Toutes les erreurs, et seulement les images figées les plus longues
  const frozen = ofType('slowFrame').sort((a, b) => b.ms - a.ms).slice(0, 5);
  const problems = entries.filter(e => e.type === 'error' || frozen.includes(e));
  if (problems.length === 0) console.log('Aucune erreur ni image figée dans ce journal.');
  else console.log(`${ofType('error').length} erreur(s), ${ofType('slowFrame').length} image(s) figée(s)${ofType('slowFrame').length > frozen.length ? ` (les ${frozen.length} plus longues sont détaillées)` : ''}`);
  for (const problem of problems) {
    console.log(`\n${line(problem)}`);
    if (problem.stack) console.log(problem.stack.split('\n').slice(0, 6).map(l => `          ${l}`).join('\n'));
    if (problem.pending) console.log(`          le moteur attendait : ${JSON.stringify(problem.pending).slice(0, 200)}`);
    console.log('        juste avant :');
    for (const entry of entries.filter(e => e.n < problem.n).slice(-6)) console.log(`        ${line(entry)}`);
  }
  process.exit(0);
}

// --- Un joueur ---
if (valueOf('player') !== null) {
  const id = Number(valueOf('player'));
  console.log(`${nameOf(id)} : décisions et mouvements de GP\n`);
  for (const entry of entries) {
    if ((entry.type === 'gp' || entry.type === 'choice' || entry.type === 'announce') && entry.playerId === id) console.log(line(entry));
  }
  process.exit(0);
}

// --- Résumé ---
const last = entries[entries.length - 1];
const end = ofType('end')[0];
console.log(`Journal : plateau ${setup.boardName}, graine ${setup.seed}, objectif ${fmt(setup.gpGoal)} GP${meta.restore ? ' (partie reprise depuis une sauvegarde)' : ''}`);
console.log(`Joueurs : ${players.map(p => `${p.name} (${p.isHuman ? 'humain' : 'IA'})`).join(', ')}`);
if (meta.startedAt) console.log(`Commencée le ${meta.startedAt.replace('T', ' à ').slice(0, 22)}`);
console.log(`${entries.length} entrées, ${last ? last.turn : 0} tours${last && last.t ? `, ${Math.round(last.t / 60000)} min ${Math.round((last.t % 60000) / 1000)} s de jeu` : ''}`);
console.log(end
  ? `Fin : ${nameOf(end.winnerId)} gagne (${end.reason === 'lastStanding' ? 'dernier joueur en lice' : 'objectif atteint'})`
  : 'Partie interrompue avant la fin (retour au menu, fermeture ou erreur)');

const env = ofType('env')[0];
if (env) {
  console.log('\nEnvironnement');
  console.log(`  navigateur   ${env.userAgent}`);
  console.log(`  fenêtre      ${env.viewport.width} × ${env.viewport.height} (densité ${env.viewport.pixelRatio})`);
  console.log(`  carte 3D     ${env.graphics}`);
  console.log(`  réglages     vitesse ×${env.settings?.speed}, suivi caméra ${env.settings?.follow ? 'activé' : 'coupé'}`);
}

// Joueurs : état final, décisions, temps de réflexion
const finalState = end ? end.final : ofType('turn').pop();
console.log('\nJoueurs');
for (let id = 0; id < players.length; id++) {
  const choices = entries.filter(e => e.type === 'choice' && e.playerId === id);
  // Temps entre la demande et la réponse
  const delays = choices.map((choice) => {
    const request = entries.slice(0, choice.n).reverse().find(e => e.type === 'request');
    return request ? choice.t - request.t : 0;
  });
  const state = finalState ? finalState.players[id] : null;
  const owned = finalState ? finalState.tiles.filter(t => t.owner === id).length : 0;
  console.log(`  ${nameOf(id).padEnd(12)} ${state ? `${fmt(state.gp).padStart(7)} GP, fortune ${fmt(state.net).padStart(7)}, ${owned} case(s)${state.eliminated ? ', en faillite' : ''}` : ''}`
    + ` | ${choices.length} décisions${delays.some(d => d > 0) ? `, réflexion médiane ${seconds(median(delays))}, max ${seconds(Math.max(...delays))}` : ''}`);
}

// GP par origine et par joueur
const sources = [...new Set(ofType('gp').map(e => e.source))].sort();
if (sources.length > 0) {
  console.log('\nGP par origine');
  console.log(`  ${'origine'.padEnd(12)} ${players.map(p => p.name.padStart(10)).join('')}`);
  for (const source of sources) {
    const totals = players.map((_, id) => ofType('gp').filter(e => e.source === source && e.playerId === id).reduce((sum, e) => sum + e.amount, 0));
    console.log(`  ${source.padEnd(12)} ${totals.map(v => fmt(v).padStart(10)).join('')}`);
  }
}

// Mains jouées
const announces = ofType('announce');
if (announces.length > 0) {
  console.log('\nMains et captures annoncées');
  const counts = {};
  for (const a of announces) counts[`${nameOf(a.playerId)} — ${a.title}`] = (counts[`${nameOf(a.playerId)} — ${a.title}`] || 0) + 1;
  for (const [key, n] of Object.entries(counts).sort()) console.log(`  ${key.padEnd(34)} × ${n}`);
}

// Technique
const errors = ofType('error');
const perf = ofType('perf').filter(p => p.visible !== false);
console.log('\nTechnique');
console.log(`  erreurs            ${errors.length}${errors.length ? ` — ${[...new Set(errors.map(e => `${e.kind} : ${e.message}`))].slice(0, 3).join(' ; ')}` : ''}`);
console.log(`  images figées      ${ofType('slowFrame').length}${ofType('slowFrame').length ? ` (la plus longue ${Math.max(...ofType('slowFrame').map(e => e.ms))} ms)` : ''}`);
if (perf.length > 0) {
  const fps = perf.map(p => p.fps);
  console.log(`  fluidité           ${median(fps)} images/s en médiane, ${Math.min(...fps)} au plus bas (${perf.length} relevés)`);
  const lastPerf = perf[perf.length - 1];
  if (lastPerf.drawCalls) console.log(`  charge 3D          ${lastPerf.drawCalls} appels de dessin, ${fmt(lastPerf.triangles)} triangles${lastPerf.memoryMB ? `, ${lastPerf.memoryMB} Mo de mémoire` : ''}`);
}
const hidden = ofType('visibility').filter(v => v.state !== 'visible').length;
if (hidden) console.log(`  onglet masqué      ${hidden} fois`);
const uiActions = ofType('ui');
if (uiActions.length) console.log(`  actions interface  ${Object.entries(uiActions.reduce((acc, e) => ({ ...acc, [e.action]: (acc[e.action] || 0) + 1 }), {})).map(([k, n]) => `${k} × ${n}`).join(', ')}`);

// Durée réelle de chaque type d'effet (du moment où le moteur s'arrête à l'arrêt suivant)
const stops = ofType('request');
if (last && last.t > 0) {
  const durations = {};
  stops.forEach((stop, i) => {
    if (stop.request.kind !== 'effect' || !stops[i + 1]) return;
    (durations[stop.request.type] ||= []).push(stops[i + 1].t - stop.t);
  });
  console.log('  durée des effets   (médiane / maximum)');
  for (const [type, values] of Object.entries(durations)) {
    console.log(`    ${type.padEnd(12)} ${seconds(median(values)).padStart(8)} / ${seconds(Math.max(...values)).padStart(8)}   × ${values.length}`);
  }
}

// --- Rejeu ---
if (option('replay')) {
  console.log('\nRejeu');
  const report = replayJournal(data);
  if (report.ok) {
    console.log(`  identique : ${report.stops} arrêts du moteur et ${report.turnsChecked} débuts de tour vérifiés${report.complete ? ', jusqu\'à la fin de la partie' : ' (journal interrompu avant la fin)'}`);
  } else {
    console.log(`  DIFFÉRENCE à l'entrée ${report.problem.at} (tour ${report.problem.turn}) : ${report.problem.message}`);
    console.log(`  ${JSON.stringify(report.problem.details, null, 1).split('\n').slice(0, 30).join('\n  ')}`);
    console.log(`  ${report.stops} arrêts et ${report.turnsChecked} débuts de tour étaient identiques avant cela.`);
    process.exitCode = 2;
  }
} else {
  console.log('\nAjouter --replay pour vérifier que la partie se rejoue à l\'identique, --turn N pour le détail d\'un tour.');
}
