// Cartes Commandes et mains (combinaisons de cartes). Module pur.
// 4 types de cartes (Attaque, Magie, Divers, Joker), 10 mains.

export const CardType = {
  ATTACK: 'attack',
  MAGIC: 'magic',
  MISC: 'misc',
  JOKER: 'joker',
};

export const CARD_TYPE_LABELS = {
  [CardType.ATTACK]: 'Attaque',
  [CardType.MAGIC]: 'Magie',
  [CardType.MISC]: 'Divers',
  [CardType.JOKER]: 'Joker',
};

export const CARD_DEFINITIONS = [
  // Attaque
  { id: 'strike', name: 'Frappe', type: CardType.ATTACK, value: 2, description: 'Attaque basique.' },
  { id: 'sliding_dash', name: 'Charge', type: CardType.ATTACK, value: 3, description: 'Charge rapide.' },
  { id: 'blitz', name: 'Blitz', type: CardType.ATTACK, value: 4, description: 'Attaque puissante.' },
  { id: 'sonic_blade', name: 'Lame Sonique', type: CardType.ATTACK, value: 5, description: 'Enchaînement rapide.' },
  { id: 'ars_arcanum', name: 'Ars Arcanum', type: CardType.ATTACK, value: 6, description: 'Combo dévastateur.' },
  { id: 'zantetsuken', name: 'Zantetsuken', type: CardType.ATTACK, value: 7, description: 'Coup mortel.' },
  { id: 'quick_blitz', name: 'Blitz Éclair', type: CardType.ATTACK, value: 2, description: 'Attaque éclair.' },
  { id: 'fire_dash', name: 'Charge Feu', type: CardType.ATTACK, value: 4, description: 'Charge enflammée.' },
  { id: 'stun_edge', name: 'Lame Stun', type: CardType.ATTACK, value: 3, description: 'Coup étourdissant.' },
  { id: 'meteor_crash', name: 'Meteor', type: CardType.ATTACK, value: 6, description: 'Impact météorique.' },

  // Magie
  { id: 'thunder', name: 'Foudre', type: CardType.MAGIC, value: 2, description: 'Magie de foudre.' },
  { id: 'fire', name: 'Brasier', type: CardType.MAGIC, value: 2, description: 'Magie de feu.' },
  { id: 'blizzard', name: 'Glacier', type: CardType.MAGIC, value: 2, description: 'Magie de glace.' },
  { id: 'cure', name: 'Soin', type: CardType.MAGIC, value: 3, description: 'Magie de soin.' },
  { id: 'magnet', name: 'Aimant', type: CardType.MAGIC, value: 2, description: 'Magie d\'attraction.' },
  { id: 'aero', name: 'Aero', type: CardType.MAGIC, value: 2, description: 'Magie de vent.' },

  // Divers
  { id: 'block', name: 'Parade', type: CardType.MISC, value: 3, description: 'Technique défensive.' },
  { id: 'dodge_roll', name: 'Roulade', type: CardType.MISC, value: 2, description: 'Esquive rapide.' },
  { id: 'strike_raid', name: 'Raid Keyblade', type: CardType.MISC, value: 4, description: 'Lancer de Keyblade.' },
  { id: 'shotlock', name: 'Shotlock', type: CardType.MISC, value: 5, description: 'Verrouillage de cible.' },

  // Joker : ne peut pas être posé sur une case
  { id: 'joker', name: 'Joker', type: CardType.JOKER, value: 0, description: 'Carte sauvage. Ne peut pas être posée sur une case.' },
];

// === Mains ===

export const HandType = {
  STUN: 'stun',
  TWO_DICE: 'two_dice',
  GP_PROTECTOR: 'gp_protector',
  NAVIGATOR: 'navigator',
  THREE_DICE: 'three_dice',
  CONFUSE: 'confuse',
  DOUBLE_TOLL: 'double_toll',
  GP_MAGNET: 'gp_magnet',
  JOKERS_FORTUNE: 'jokers_fortune',
  GOLDEN_CHANCE: 'golden_chance',
};

export const HAND_DEFINITIONS = [
  {
    type: HandType.STUN,
    name: 'Stun',
    description: 'Force un adversaire à passer son prochain tour.',
    requiredCards: [{ type: CardType.ATTACK, count: 1 }],
    needsTarget: true,
  },
  {
    type: HandType.TWO_DICE,
    name: 'Double Dé',
    description: 'Lance 2 dés (déplacement de 2 à 12).',
    requiredCards: [{ type: CardType.MAGIC, count: 1 }],
    needsTarget: false,
  },
  {
    type: HandType.GP_PROTECTOR,
    name: 'Protecteur GP',
    description: 'Bloque la prochaine perte de GP (péage, dégâts…). Cumulable.',
    requiredCards: [{ type: CardType.MISC, count: 1 }],
    needsTarget: false,
  },
  {
    type: HandType.NAVIGATOR,
    name: 'Navigateur',
    description: 'Permet d\'aller dans n\'importe quelle direction ce tour, y compris en arrière.',
    requiredCards: [{ type: CardType.ATTACK, count: 2 }],
    needsTarget: false,
  },
  {
    type: HandType.THREE_DICE,
    name: 'Triple Dé',
    description: 'Lance 3 dés (déplacement de 3 à 18).',
    requiredCards: [{ type: CardType.MAGIC, count: 2 }],
    needsTarget: false,
  },
  {
    type: HandType.CONFUSE,
    name: 'Confusion',
    description: 'Les adversaires partent au hasard aux intersections pendant 3 tours.',
    requiredCards: [{ type: CardType.MISC, count: 2 }],
    needsTarget: false,
  },
  {
    type: HandType.DOUBLE_TOLL,
    name: 'Double Péage',
    description: 'Les péages de vos cases sont doublés pendant 5 tours.',
    requiredCards: [{ type: CardType.ATTACK, count: 3 }],
    needsTarget: false,
  },
  {
    type: HandType.GP_MAGNET,
    name: 'Aimant GP',
    description: 'Rapporte des GP pour chaque case possédée par les adversaires.',
    requiredCards: [
      { type: CardType.ATTACK, count: 1 },
      { type: CardType.MAGIC, count: 1 },
      { type: CardType.MISC, count: 1 },
    ],
    needsTarget: false,
  },
  {
    type: HandType.JOKERS_FORTUNE,
    name: 'Fortune du Joker',
    description: 'Roulette : un effet au hasard, ou la capture d\'une case libre.',
    requiredCards: [{ type: CardType.JOKER, count: 1 }],
    needsTarget: false,
  },
  {
    type: HandType.GOLDEN_CHANCE,
    name: 'Chance Dorée',
    description: 'Machine à sous : un effet puissant au hasard, ou la capture d\'une zone entière.',
    requiredCards: [{ type: CardType.JOKER, count: 3 }],
    needsTarget: false,
  },
];

export function getHandDef(handType) {
  return HAND_DEFINITIONS.find(h => h.type === handType) || null;
}

export function canFormHand(hand, handDef) {
  const typeCounts = {};
  for (const card of hand) {
    typeCounts[card.type] = (typeCounts[card.type] || 0) + 1;
  }
  return handDef.requiredCards.every(req => (typeCounts[req.type] || 0) >= req.count);
}

export function getAvailableHands(hand) {
  return HAND_DEFINITIONS.filter(handDef => canFormHand(hand, handDef));
}

// Vérifie qu'une liste d'identifiants de cartes correspond exactement à ce qu'exige la main
function matchesRequirement(cards, handDef) {
  const total = handDef.requiredCards.reduce((n, req) => n + req.count, 0);
  if (cards.length !== total) return false;
  return handDef.requiredCards.every(req => cards.filter(c => c.type === req.type).length === req.count);
}

// Cartes consommées pour jouer une main.
// `preferredIds` : cartes choisies par le joueur ; si elles ne conviennent pas (ou sont absentes),
// on prend les cartes de plus faible valeur, pour garder les meilleures à poser sur les cases.
export function selectCardsForHand(hand, handDef, preferredIds = null) {
  if (preferredIds && preferredIds.length > 0) {
    const chosen = hand.filter(c => preferredIds.includes(c.instanceId));
    if (matchesRequirement(chosen, handDef)) return chosen;
  }

  const selected = [];
  for (const req of handDef.requiredCards) {
    const candidates = hand
      .filter(c => c.type === req.type)
      .sort((a, b) => a.value - b.value);
    if (candidates.length < req.count) return null;
    selected.push(...candidates.slice(0, req.count));
  }
  return selected;
}

export function canPlaceOnTile(card) {
  return card.type !== CardType.JOKER;
}

// === Création et pioche ===
// `nextId` : fonction qui fournit un identifiant d'instance unique dans la partie.

export function createCard(cardId, nextId) {
  const def = CARD_DEFINITIONS.find(c => c.id === cardId);
  if (!def) return null;
  return { ...def, instanceId: nextId() };
}

// Main de départ : 2 Attaque, 1 Magie, 1 Divers, 1 Joker
export function createStartingHand(nextId) {
  return ['strike', 'sliding_dash', 'thunder', 'block', 'joker'].map(id => createCard(id, nextId));
}

const DRAW_WEIGHTS = [
  [CardType.ATTACK, 0.40],
  [CardType.MAGIC, 0.25],
  [CardType.MISC, 0.20],
  [CardType.JOKER, 0.15],
];

export function drawRandomCards(count, rng, nextId) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    let roll = rng.next();
    let type = DRAW_WEIGHTS[DRAW_WEIGHTS.length - 1][0];
    for (const [t, weight] of DRAW_WEIGHTS) {
      if (roll < weight) { type = t; break; }
      roll -= weight;
    }
    const def = rng.pick(CARD_DEFINITIONS.filter(c => c.type === type));
    cards.push({ ...def, instanceId: nextId() });
  }
  return cards;
}

export const DIE_FACES = 6;

export function rollDie(rng) {
  return rng.int(DIE_FACES) + 1;
}
