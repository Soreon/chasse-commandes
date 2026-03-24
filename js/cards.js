// Referentiel de toutes les cartes Commandes

export const CardType = {
  ATTACK: 'attack',
  MAGIC: 'magic',
  DEFENSE: 'defense',
};

// Toutes les cartes disponibles dans le jeu
export const CARD_DEFINITIONS = [
  // Cartes Attaque - servent de "des" et peuvent etre placees sur les cases
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

  // Cartes Magie - effets speciaux jouables avant le deplacement
  { id: 'thunder', name: 'Foudre', type: CardType.MAGIC, value: 1, magicEffect: 'stun', description: 'Etourdit un adversaire (passe son tour).' },
  { id: 'magnet', name: 'Aimant', type: CardType.MAGIC, value: 1, magicEffect: 'magnet', description: 'Attire un adversaire sur votre case.' },
  { id: 'cure', name: 'Soin', type: CardType.MAGIC, value: 2, magicEffect: 'heal', gpEffect: 300, description: 'Recupere 300 GP.' },
  { id: 'fire', name: 'Brasier', type: CardType.MAGIC, value: 2, magicEffect: 'damage', gpEffect: -200, description: 'Inflige 200 GP de degats a un adversaire.' },
  { id: 'blizzard', name: 'Glacier', type: CardType.MAGIC, value: 2, magicEffect: 'freeze', description: 'Gele un adversaire (de force 1-3 au prochain tour).' },
  { id: 'confuse', name: 'Confusion', type: CardType.MAGIC, value: 1, magicEffect: 'confuse', description: 'Inverse les controles d\'un adversaire au prochain tour.' },
  { id: 'stop', name: 'Stop', type: CardType.MAGIC, value: 3, magicEffect: 'stun', description: 'Arrete le temps pour un adversaire (passe son tour).' },
  { id: 'zero_gravity', name: 'Zero Gravite', type: CardType.MAGIC, value: 2, magicEffect: 'scramble', description: 'Melange aleatoirement la position des joueurs.' },

  // Cartes Defense - protection et bonus
  { id: 'block', name: 'Parade', type: CardType.DEFENSE, value: 3, description: 'Reduit le prochain peage de 50%.' },
  { id: 'reflect', name: 'Reflet', type: CardType.DEFENSE, value: 4, description: 'Renvoie le prochain peage a l\'adversaire.' },
];

// Cree une instance de carte a partir de sa definition
export function createCard(cardId) {
  const def = CARD_DEFINITIONS.find(c => c.id === cardId);
  if (!def) return null;
  return { ...def, instanceId: crypto.randomUUID() };
}

// Cree une main de depart pour un joueur
export function createStartingHand() {
  const handDefs = ['strike', 'sliding_dash', 'blitz', 'thunder', 'cure'];
  return handDefs.map(id => createCard(id));
}

// Pioche des cartes aleatoires depuis le deck
export function drawRandomCards(count = 1) {
  const cards = [];
  const attackAndDefense = CARD_DEFINITIONS.filter(c => c.type !== CardType.MAGIC);
  const allCards = CARD_DEFINITIONS;
  for (let i = 0; i < count; i++) {
    // 70% attaque/defense, 30% magie
    const pool = Math.random() < 0.7 ? attackAndDefense : allCards;
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
