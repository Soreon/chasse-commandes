// Génère des plateaux et les affiche en caractères, avec leurs mesures : pour juger le
// générateur de l'éditeur (js/boardGenerator.js) sans ouvrir le navigateur.
//
//   npm run generate                              3 plateaux moyens, graines 1 à 3
//   npm run generate -- --size large --count 5 --seed 40
//   npm run generate -- --games 6                 avec 6 parties d'essai entre IA par plateau
//   npm run generate -- --count 200 --quiet       seulement le bilan (pour vérifier en masse)
//   npm run generate -- --reference               mesures des plateaux de boards.json
//
// Légende : S Départ, R B Y G checkpoints, a-f cases commande (leur zone), x dégâts, D Prize Cube,
//           + Bonus, ? Événement, $ Booster, - | téléporteurs.

import { readFileSync } from 'node:fs';
import { generateBoard, playtestBoard, BOARD_SIZES } from '../js/boardGenerator.js';
import { boardToText, checkBoard, measureBoard, referenceProfile, styleGap } from '../js/boardCheck.js';

function parseArgs(argv) {
  const opts = { size: 'medium', count: 3, seed: 1, games: 0, quiet: false, reference: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === '--size') opts.size = value();
    else if (arg === '--count') opts.count = Number(value());
    else if (arg === '--seed') opts.seed = Number(value());
    else if (arg === '--games') opts.games = Number(value());
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--reference') opts.reference = true;
    else throw new Error(`Option inconnue : ${arg}`);
  }
  return opts;
}

const percent = value => `${Math.round(value * 100)} %`;

function describe(metrics) {
  return [
    `${metrics.tiles} cases : ${metrics.command} commande (${percent(metrics.commandShare)}) en zones de ${metrics.zones.join('/')},`,
    `${metrics.damage} dégâts (pistes de ${metrics.tracks.join('/')}), ${metrics.bonus} bonus, ${metrics.events} événements, ${metrics.boosters} booster(s)`,
    `\n  ${metrics.loops} boucles, ${metrics.junctions} carrefours, ${metrics.links} téléporteurs, tour complet en ${metrics.lap} pas,`,
    `plus long couloir sans choix : ${metrics.corridor} cases`,
  ].join(' ');
}

const opts = parseArgs(process.argv.slice(2));
const boards = JSON.parse(readFileSync(new URL('../boards.json', import.meta.url), 'utf8'));
const profile = referenceProfile(boards);

if (opts.reference) {
  for (const [name, entry] of Object.entries(boards)) {
    const check = checkBoard(entry);
    console.log(`\n=== ${name} : ${check.ok ? 'valide' : check.errors.join(' ')} ===`);
    console.log(`  ${describe(measureBoard(entry))}`);
    if (opts.games > 0) {
      const trial = playtestBoard(entry, { games: opts.games });
      console.log(`  parties d'essai : ${trial.finished}/${trial.games} terminées, ${trial.turns} tours (médiane)`);
    }
  }
} else {
  if (!BOARD_SIZES[opts.size]) throw new Error(`Taille inconnue : ${opts.size} (${Object.keys(BOARD_SIZES).join(', ')})`);
  const summary = { made: 0, failed: 0, gap: 0, inStyle: 0, unfinished: 0, turns: [] };
  const started = Date.now();
  for (let seed = opts.seed; seed < opts.seed + opts.count; seed++) {
    let result;
    try {
      result = generateBoard({ seed, size: opts.size, reference: boards, playtest: opts.games });
    } catch (error) {
      summary.failed++;
      console.log(`\n=== graine ${seed} : ${error.message} ===`);
      continue;
    }
    summary.made++;
    summary.gap += result.gap;
    if (result.gap === 0) summary.inStyle++;
    if (result.playtest) summary.turns.push(result.playtest.turns);
    if (opts.quiet) continue;
    console.log(`\n=== graine ${seed}, ${BOARD_SIZES[opts.size].name.toLowerCase()} : écart de style ${styleGap(result.metrics, profile).toFixed(2)} ===`);
    console.log(boardToText(result.board));
    console.log(`  ${describe(result.metrics)}`);
    if (result.playtest) {
      console.log(`  parties d'essai : ${result.playtest.finished}/${result.playtest.games} terminées, ${result.playtest.turns} tours (médiane)`);
    }
  }
  summary.turns.sort((a, b) => a - b);
  console.log(`\n${summary.made} plateau(x) généré(s), ${summary.failed} échec(s), ${summary.inStyle} dans les proportions de référence,`
    + ` écart de style moyen ${(summary.gap / Math.max(1, summary.made)).toFixed(2)},`
    + ` ${Math.round((Date.now() - started) / Math.max(1, opts.count))} ms par plateau`
    + (summary.turns.length > 0 ? `, parties de ${summary.turns[0]} à ${summary.turns[summary.turns.length - 1]} tours` : ''));
}
