import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pixelLabelGrid, unknownCharacters } from '../js/pixelLabel.js';

const count = (grid, color) => grid.pixels.flat().filter(pixel => pixel === color).length;

test('une étiquette de texte est une plaque de 11 points de haut', () => {
  const grid = pixelLabelGrid('7 pas');
  // 7 (5) + espace (3) + P A S (5 + 1 + 5 + 1 + 5), plus 3 points de bord et de marge par côté
  assert.equal(grid.width, 31);
  assert.equal(grid.height, 11);
  assert.ok(grid.pixels.every(row => row.length === grid.width));
  assert.equal(grid.pixels[0][0], null, 'coins rognés');
  assert.ok(count(grid, '#ffffff') > 0, 'texte en blanc');
});

test('minuscules et accents se ramènent aux capitales', () => {
  assert.deepEqual(pixelLabelGrid('é'), pixelLabelGrid('E'));
  assert.deepEqual(pixelLabelGrid('nv 2'), pixelLabelGrid('NV 2'));
});

test('la couleur du texte se choisit', () => {
  const grid = pixelLabelGrid('+250 GP', { fg: '#ffd700' });
  assert.ok(count(grid, '#ffd700') > 0);
  assert.equal(count(grid, '#ffffff'), 0);
});

test('un émoji devient une icône de 7 × 7 points, avec ou sans variante d\'affichage', () => {
  const bare = pixelLabelGrid('\u{1F6E1}', { bg: null });
  const withVariant = pixelLabelGrid('\u{1F6E1}\uFE0F', { bg: null });
  assert.deepEqual(bare, withVariant);
  // 7 points d'icône, plus 1 point de liseré de chaque côté
  assert.equal(bare.width, 9);
  assert.equal(bare.height, 9);
  assert.ok(count(bare, '#0b0b1c') > 0, 'liseré sombre autour du dessin nu');
});

test('toutes les icônes font 7 × 7 points', () => {
  for (const emoji of ['🎲', '⚡', '❓', '🛡️', '🦸', '🦹', '🍯', '🧭', '💰', '⭐', '💫', '🃏', '🎰', '🪙']) {
    const grid = pixelLabelGrid(emoji, { bg: null });
    assert.equal(grid.width, 9, emoji);
    assert.equal(grid.height, 9, emoji);
    assert.ok(grid.pixels.flat().some(pixel => pixel !== null && pixel !== '#0b0b1c'), emoji);
  }
});

test('les étiquettes du jeu n\'utilisent que des caractères dessinés', () => {
  const labels = [
    'Nv 5', '7 pas', '+1250 GP', '×2',
    '🎲 7 pas ⚡ ❓3 🛡️2 ×2 🦸4 🦹1',
    '🍯', '🧭', '💰', '⭐', '💫', '🃏', '🎰', '🪙',
  ];
  for (const label of labels) assert.deepEqual(unknownCharacters(label), [], label);
  assert.deepEqual(unknownCharacters('7 pas €'), ['€']);
});
