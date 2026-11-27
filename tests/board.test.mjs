import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  TileType, parseBoardJSON, getAvailableMoves, distancesTo, updateAllTolls,
  getBuyCost, getUpgradeCost, getBuyoutCost, isCheckpoint, OPPOSITE_DIR,
} from '../js/engine/board.js';
import { RULES } from '../js/engine/config.js';
import { selectCardsForHand, getHandDef, HandType } from '../js/engine/cards.js';

const root = new URL('../', import.meta.url);
const boards = JSON.parse(readFileSync(fileURLToPath(new URL('boards.json', root)), 'utf8'));

// Trois cases commande en ligne dans la zone A, plus un départ
const lineBoard = () => parseBoardJSON({
  grid: [[{ type: 'start' }, { type: 'command', zone: 'A' }, { type: 'command', zone: 'A' }, { type: 'command', zone: 'A' }]],
  zones: [],
});

function own(tiles, tileId, owner, { level = 1, cardValue = 3 } = {}) {
  tiles[tileId].owner = owner;
  tiles[tileId].level = level;
  tiles[tileId].cardPlaced = { value: cardValue };
  updateAllTolls(tiles);
}

test('les cases du joueur n° 0 ont une valeur et un péage (régression)', () => {
  const a = lineBoard().tiles;
  const b = lineBoard().tiles;
  own(a, 1, 0);
  own(b, 1, 1);

  assert.equal(a[1].currentValue, 250);
  assert.equal(a[1].tollValue, 100);
  assert.equal(a[1].currentValue, b[1].currentValue);
  assert.equal(a[1].tollValue, b[1].tollValue);
  assert.equal(getBuyoutCost(a[1]), 250 * RULES.buyoutMultiplier);
});

test('bonus de chaîne puis d\'exclusivité dans une zone', () => {
  const { tiles } = lineBoard();
  own(tiles, 1, 0);
  assert.equal(tiles[1].currentValue, 250);

  own(tiles, 2, 0);
  assert.equal(tiles[1].currentValue, Math.floor(250 * (1 + RULES.chainBonusPerTile)));

  own(tiles, 3, 0);
  assert.equal(tiles[1].currentValue, Math.floor(250 * (1 + 2 * RULES.chainBonusPerTile) * RULES.exclusivityBonus));
});

test('une case revendue ou libre ne vaut plus rien', () => {
  const { tiles } = lineBoard();
  own(tiles, 1, 0);
  tiles[1].owner = null;
  tiles[1].level = 0;
  updateAllTolls(tiles);
  assert.equal(tiles[1].currentValue, 0);
  assert.equal(tiles[1].tollValue, 0);
});

test('acheter ou améliorer coûte la valeur ajoutée à la case', () => {
  const { tiles } = lineBoard();
  const card = { value: 5 };
  assert.equal(getBuyCost(tiles[1], card), 350);

  own(tiles, 1, 0, { cardValue: 5 });
  assert.equal(tiles[1].currentValue, 350);
  // niveau 1 -> 2 : la valeur passe de 350 à 525
  assert.equal(getUpgradeCost(tiles[1]), 175);

  tiles[1].level = RULES.maxLevel;
  assert.equal(getUpgradeCost(tiles[1]), Infinity);
});

test('demi-tour interdit, sauf dans un cul-de-sac', () => {
  const { tiles } = lineBoard();
  const fromMiddle = getAvailableMoves(tiles, 2, 'east');
  assert.deepEqual(fromMiddle.map(m => m.tileId), [3]);

  const deadEnd = getAvailableMoves(tiles, 3, 'east');
  assert.deepEqual(deadEnd.map(m => m.tileId), [2]);

  const free = getAvailableMoves(tiles, 2, null);
  assert.equal(free.length, 2);
});

test('les téléporteurs relient deux cases dans les deux sens', () => {
  const { tiles, links } = parseBoardJSON({
    grid: [[{ type: 'start' }, { type: 'teleporter', direction: 'horizontal' }, { type: 'teleporter', direction: 'horizontal' }, { type: 'command' }]],
  });
  assert.equal(links.length, 1);
  assert.deepEqual(tiles[0].adjacencies.east, { tileId: 1, isLink: true });
  assert.deepEqual(tiles[1].adjacencies.west, { tileId: 0, isLink: true });
});

for (const [name, entry] of Object.entries(boards)) {
  test(`plateau ${name} : un départ, quatre checkpoints, toutes les cases reliées`, () => {
    const { tiles, startTileId } = parseBoardJSON(entry);

    assert.equal(tiles.filter(t => t.type === TileType.START).length, 1);
    assert.equal(tiles[startTileId].type, TileType.START);
    assert.equal(tiles.filter(t => isCheckpoint(t.type)).length, 4);

    const dist = distancesTo(tiles, [startTileId]);
    const unreachable = tiles.filter(t => dist[t.id] === Infinity).map(t => t.id);
    assert.deepEqual(unreachable, []);

    // Les voisinages sont symétriques
    for (const tile of tiles) {
      for (const [dir, adj] of Object.entries(tile.adjacencies)) {
        if (!adj) continue;
        assert.equal(tiles[adj.tileId].adjacencies[OPPOSITE_DIR[dir]]?.tileId, tile.id);
      }
    }
  });
}

test('une main consomme les cartes les plus faibles, ou celles choisies par le joueur', () => {
  const hand = [
    { instanceId: 'a', type: 'attack', value: 7 },
    { instanceId: 'b', type: 'attack', value: 2 },
    { instanceId: 'c', type: 'attack', value: 4 },
    { instanceId: 'd', type: 'magic', value: 2 },
  ];
  const stun = getHandDef(HandType.STUN);
  const navigator = getHandDef(HandType.NAVIGATOR);

  assert.deepEqual(selectCardsForHand(hand, stun).map(c => c.instanceId), ['b']);
  assert.deepEqual(selectCardsForHand(hand, navigator).map(c => c.instanceId), ['b', 'c']);
  assert.deepEqual(selectCardsForHand(hand, stun, ['a']).map(c => c.instanceId), ['a']);
  // Un choix invalide (mauvais type) retombe sur le choix par défaut
  assert.deepEqual(selectCardsForHand(hand, stun, ['d']).map(c => c.instanceId), ['b']);
  assert.equal(selectCardsForHand(hand, getHandDef(HandType.GOLDEN_CHANCE)), null);
});

test('le moteur ne dépend ni du DOM ni des minuteries', () => {
  const dir = fileURLToPath(new URL('js/engine/', root));
  for (const file of readdirSync(dir)) {
    const source = readFileSync(`${dir}/${file}`, 'utf8');
    for (const forbidden of ['document.', 'window.', 'setTimeout', 'requestAnimationFrame', 'Math.random', 'localStorage']) {
      if (file === 'rng.js' && forbidden === 'Math.random') continue; // tirage de la graine d'une nouvelle partie
      assert.ok(!source.includes(forbidden), `${file} utilise ${forbidden}`);
    }
  }
});

test('distance sans demi-tour : dans une boucle, il faut en faire le tour pour ressortir', async () => {
  const { directedDistances } = await import('../js/engine/board.js');
  // Un couloir (0 départ, 1, 2) qui débouche sur un anneau de 8 cases autour d'un trou
  const { tiles, posToId } = parseBoardJSON({
    grid: [
      [{}, {}, { type: 'command' }, { type: 'command' }, { type: 'command' }],
      [{ type: 'start' }, { type: 'command' }, { type: 'command' }, {}, { type: 'command' }],
      [{}, {}, { type: 'command' }, { type: 'command' }, { type: 'command' }],
    ],
  });
  const id = (r, c) => posToId[`${r},${c}`];
  const start = id(1, 0);
  const toStart = directedDistances(tiles, [start]);

  // À l'entrée de l'anneau, tourné vers la sortie : 2 pas
  assert.equal(toStart(id(1, 2), 'west'), 2);
  // Même case, mais en venant du couloir (vers l'est) : il faut faire le tour de l'anneau
  assert.equal(toStart(id(1, 2), 'east'), 10);
  // Sans direction imposée (après une téléportation), on prend le plus court
  assert.equal(toStart(id(1, 2), null), 2);
  // Au fond de l'anneau, quel que soit le sens, il reste la moitié du tour puis le couloir
  assert.equal(toStart(id(1, 4), 'north'), 6);
  assert.equal(toStart(id(1, 4), 'south'), 6);
  assert.equal(toStart(start, 'west'), 0);
});
