import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = path => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

// Le chef d'orchestre (controller.js) appelle l'interface par son objet `ui`, défini dans main.js.
// main.js ne peut pas être chargé hors navigateur : on vérifie donc sur le texte que chaque
// méthode appelée existe bien, pour qu'un oubli ne se découvre pas en pleine partie.
test('l\'objet ui de main.js fournit toutes les méthodes appelées par le chef d\'orchestre', () => {
  const controller = read('js/controller.js');
  const called = [...new Set([...controller.matchAll(/\bui\.(\w+)\(/g)].map(m => m[1]))];
  assert.ok(called.length >= 8, `méthodes repérées : ${called.join(', ')}`);

  const main = read('js/main.js');
  const start = main.indexOf('const ui = {');
  assert.ok(start !== -1, 'main.js définit `const ui = {`');
  const block = main.slice(start, main.indexOf('\n};', start));

  // Une méthode de `ui` commence une ligne, indentée de deux espaces : `nom(`, `nom:` ou `nom,`
  const missing = called.filter(name => !new RegExp(String.raw`\n  (async )?${name}[(:,]`).test(block));
  assert.deepEqual(missing, [], `méthodes manquantes dans ui : ${missing.join(', ')}`);
});
