// Referentiel de toutes les cartes Commandes
// Systeme fidele au Command Board de KH BBS :
// 4 types de cartes (Attaque, Magie, Divers, Joker)
// 10 combinaisons de mains

export const CardType = {
  ATTACK: 'attack',
  MAGIC: 'magic',
  MISC: 'misc',
  JOKER: 'joker',
};

// Toutes les cartes disponibles dans le jeu
export const CARD_DEFINITIONS = [
  // Cartes Attaque - peuvent etre placees sur les cases
  { id: 'strike', name: 'Frappe', type: CardType.ATTACK, value: 2, description: 'Attaque basique.' },
  { id: 'sliding_dash', name: 'Charge', type: CardType.ATTACK, value: 3, description: 'Charge rapide.' },
  { id: 'blitz', name: 'Blitz', type: CardType.ATTACK, value: 4, description: 'Attaque puissante.' },
  { id: 'sonic_blade', name: 'Lame Sonique', type: CardType.ATTACK, value: 5, description: 'Enchainage rapide.' },
  { id: 'ars_arcanum', name: 'Ars Arcanum', type: CardType.ATTACK, value: 6, description: 'Combo devastateur.' },
  { id: 'zantetsuken', name: 'Zantetsuken', type: CardType.ATTACK, value: 7, description: 'Coup mortel.' },
  { id: 'quick_blitz', name: 'Blitz Eclair', type: CardType.ATTACK, value: 2, description: 'Attaque eclair.' },
  { id: 'fire_dash', name: 'Charge Feu', type: CardType.ATTACK, value: 4, description: 'Charge enflammee.' },
  { id: 'stun_edge', name: 'Lame Stun', type: CardType.ATTACK, value: 3, description: 'Coup etourdissant.' },
  { id: 'meteor_crash', name: 'Meteor', type: CardType.ATTACK, value: 6, description: 'Impact meteorique.' },

  // Cartes Magie - utilisees dans les mains (Two Dice, Three Dice)
  { id: 'thunder', name: 'Foudre', type: CardType.MAGIC, value: 2, description: 'Magie de foudre.' },
  { id: 'fire', name: 'Brasier', type: CardType.MAGIC, value: 2, description: 'Magie de feu.' },
  { id: 'blizzard', name: 'Glacier', type: CardType.MAGIC, value: 2, description: 'Magie de glace.' },
  { id: 'cure', name: 'Soin', type: CardType.MAGIC, value: 3, description: 'Magie de soin.' },
  { id: 'magnet', name: 'Aimant', type: CardType.MAGIC, value: 2, description: 'Magie d\'attraction.' },
  { id: 'aero', name: 'Aero', type: CardType.MAGIC, value: 2, description: 'Magie de vent.' },

  // Cartes Divers (Misc) - action, shotlocks, etc.
  { id: 'block', name: 'Parade', type: CardType.MISC, value: 3, description: 'Technique defensive.' },
  { id: 'dodge_roll', name: 'Roulade', type: CardType.MISC, value: 2, description: 'Esquive rapide.' },
  { id: 'strike_raid', name: 'Raid Keyblade', type: CardType.MISC, value: 4, description: 'Lancer de Keyblade.' },
  { id: 'shotlock', name: 'Shotlock', type: CardType.MISC, value: 5, description: 'Verrouillage de cible.' },

  // Cartes Joker - ne peuvent PAS etre placees sur les cases
  { id: 'joker', name: 'Joker', type: CardType.JOKER, value: 0, description: 'Carte sauvage. Ne peut pas etre placee sur une case.' },
];

// === Systeme de mains (Hand Combinations) ===

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

// Definition des 10 mains possibles
export const HAND_DEFINITIONS = [
  {
    type: HandType.STUN,
    name: 'Stun',
    description: 'Force un adversaire a passer son prochain tour.',
    requiredCards: [{ type: CardType.ATTACK, count: 1 }],
    needsTarget: true,
  },
  {
    type: HandType.TWO_DICE,
    name: 'Double De',
    description: 'Lance 2 des (deplacement 2-12).',
    requiredCards: [{ type: CardType.MAGIC, count: 1 }],
    needsTarget: false,
  },
  {
    type: HandType.GP_PROTECTOR,
    name: 'Protecteur GP',
    description: 'Bloque la prochaine perte de GP (taxe, degats, etc.). Cumulable.',
    requiredCards: [{ type: CardType.MISC, count: 1 }],
    needsTarget: false,
  },
  {
    type: HandType.NAVIGATOR,
    name: 'Navigateur',
    description: 'Permet de se deplacer dans n\'importe quelle direction, y compris en arriere.',
    requiredCards: [{ type: CardType.ATTACK, count: 2 }],
    needsTarget: false,
  },
  {
    type: HandType.THREE_DICE,
    name: 'Triple De',
    description: 'Lance 3 des (deplacement 3-18).',
    requiredCards: [{ type: CardType.MAGIC, count: 2 }],
    needsTarget: false,
  },
  {
    type: HandType.CONFUSE,
    name: 'Confusion',
    description: 'Tous les adversaires se deplacent dans des directions aleatoires pendant 3 tours.',
    requiredCards: [{ type: CardType.MISC, count: 2 }],
    needsTarget: false,
  },
  {
    type: HandType.DOUBLE_TOLL,
    name: 'Double Peage',
    description: 'Les taxes de vos cases sont doublees pendant 5 tours.',
    requiredCards: [{ type: CardType.ATTACK, count: 3 }],
    needsTarget: false,
  },
  {
    type: HandType.GP_MAGNET,
    name: 'Aimant GP',
    description: 'Gagne des GP proportionnels au nombre total de cases possedees par les adversaires.',
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
    description: 'Roulette aleatoire : peut donner n\'importe quel effet ou une capture de case.',
    requiredCards: [{ type: CardType.JOKER, count: 1 }],
    needsTarget: false,
  },
  {
    type: HandType.GOLDEN_CHANCE,
    name: 'Chance Doree',
    description: 'Machine a sous : peut donner n\'importe quel effet ou une capture de zone entiere.',
    requiredCards: [{ type: CardType.JOKER, count: 3 }],
    needsTarget: false,
  },
];

// Verifie quelles mains un joueur peut former avec sa main actuelle
export function getAvailableHands(hand) {
  const available = [];

  for (const handDef of HAND_DEFINITIONS) {
    if (canFormHand(hand, handDef)) {
      available.push(handDef);
    }
  }

  return available;
}

// Verifie si une main specifique peut etre formee
export function canFormHand(hand, handDef) {
  const typeCounts = {};
  for (const card of hand) {
    typeCounts[card.type] = (typeCounts[card.type] || 0) + 1;
  }

  for (const req of handDef.requiredCards) {
    if ((typeCounts[req.type] || 0) < req.count) return false;
  }
  return true;
}

// Selectionne les cartes a consommer pour jouer une main
export function selectCardsForHand(hand, handDef) {
  const selected = [];
  const remaining = [...hand];

  for (const req of handDef.requiredCards) {
    let needed = req.count;
    for (let i = remaining.length - 1; i >= 0 && needed > 0; i--) {
      if (remaining[i].type === req.type) {
        selected.push(remaining.splice(i, 1)[0]);
        needed--;
      }
    }
    if (needed > 0) return null; // Pas assez de cartes
  }

  return selected;
}

// Verifie si une carte peut etre placee sur une case (Joker ne peut pas)
export function canPlaceOnTile(card) {
  return card.type !== CardType.JOKER;
}

// === Fonctions de creation et pioche ===

// Cree une instance de carte a partir de sa definition
export function createCard(cardId) {
  const def = CARD_DEFINITIONS.find(c => c.id === cardId);
  if (!def) return null;
  return { ...def, instanceId: crypto.randomUUID() };
}

// Cree une main de depart pour un joueur (2 attaque, 1 magie, 1 divers, 1 joker)
export function createStartingHand() {
  return [
    createCard('strike'),
    createCard('sliding_dash'),
    createCard('thunder'),
    createCard('block'),
    createCard('joker'),
  ];
}

// Pioche des cartes aleatoires depuis le deck
export function drawRandomCards(count = 1) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    let pool;
    if (roll < 0.4) {
      // 40% attaque
      pool = CARD_DEFINITIONS.filter(c => c.type === CardType.ATTACK);
    } else if (roll < 0.65) {
      // 25% magie
      pool = CARD_DEFINITIONS.filter(c => c.type === CardType.MAGIC);
    } else if (roll < 0.85) {
      // 20% divers
      pool = CARD_DEFINITIONS.filter(c => c.type === CardType.MISC);
    } else {
      // 15% joker
      pool = CARD_DEFINITIONS.filter(c => c.type === CardType.JOKER);
    }
    const def = pool[Math.floor(Math.random() * pool.length)];
    cards.push({ ...def, instanceId: crypto.randomUUID() });
  }
  return cards;
}

// Valeur max de carte pour le calcul de de
export const MAX_DICE_VALUE = 6;

// Lance un de (1-6)
export function rollDie() {
  return Math.floor(Math.random() * MAX_DICE_VALUE) + 1;
}
