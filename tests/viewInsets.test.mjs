import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coveredInsets } from '../js/viewInsets.js';

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height });

// Téléphone en paysage : le plateau occupe tout l'écran
const LANDSCAPE = rect(0, 0, 730, 330);
// Téléphone en portrait : le plateau est entre la barre du haut (43 px) et celle du bas
const PORTRAIT = rect(0, 43, 412, 484);

test('rien ne recouvre le plateau : toute la vue est libre', () => {
  assert.deepEqual(coveredInsets(LANDSCAPE, []), { top: 0, right: 0, bottom: 0, left: 0 });
  // La barre du bas, en portrait, est sous le plateau et non dessus
  assert.deepEqual(coveredInsets(PORTRAIT, [{ rect: rect(0, 527, 412, 133), side: 'bottom' }]), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('paysage : pastilles en haut, joueurs en colonne à droite, main en bas', () => {
  const insets = coveredInsets(LANDSCAPE, [
    { rect: rect(0, 0, 260, 40), side: 'top' },
    { rect: rect(0, 258, 730, 72), side: 'bottom' },
    { rect: rect(562, 6, 160, 146), side: 'auto' },
  ]);
  assert.deepEqual(insets, { top: 40, right: 168, bottom: 72, left: 0 });
});

test('portrait : joueurs en ligne en haut, fenêtre de décision en bas', () => {
  const insets = coveredInsets(PORTRAIT, [
    { rect: rect(6, 49, 400, 64), side: 'auto' },
    { rect: rect(6, 330, 400, 191), side: 'auto' },
  ]);
  assert.deepEqual(insets, { top: 70, right: 0, bottom: 197, left: 0 });
});

test('une fenêtre plus large que la colonne des joueurs l\'emporte sur le même bord', () => {
  const insets = coveredInsets(LANDSCAPE, [
    { rect: rect(562, 6, 160, 146), side: 'auto' },
    { rect: rect(364, 6, 360, 318), side: 'auto' },
  ]);
  assert.equal(insets.right, 366);
});

test('il reste toujours une part libre : deux bords opposés sont réduits ensemble', () => {
  const insets = coveredInsets(rect(0, 0, 400, 400), [
    { rect: rect(0, 0, 400, 200), side: 'top' },
    { rect: rect(0, 200, 400, 200), side: 'bottom' },
  ], 0.4);
  assert.deepEqual(insets, { top: 120, right: 0, bottom: 120, left: 0 });
});

test('un élément masqué (rectangle vide) ou un plateau sans taille ne comptent pas', () => {
  assert.deepEqual(coveredInsets(LANDSCAPE, [{ rect: rect(0, 0, 0, 0), side: 'auto' }]), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(coveredInsets(rect(0, 0, 0, 0), [{ rect: rect(0, 0, 100, 100), side: 'top' }]), { top: 0, right: 0, bottom: 0, left: 0 });
});
