// Regles chiffrees du jeu, regroupees ici pour l'equilibrage.
// L'outil `npm run simulate` permet de mesurer l'effet d'un changement
// (ex. `npm run simulate -- --set lapBonus=800`).

export const RULES = {
  // --- Joueurs ---
  startingGP: 1000,
  maxHandSize: 5,

  // --- Cases commande ---
  baseTileCost: 100,
  cardValueGP: 50,            // GP ajoutes a la valeur d'une case par point de la carte posee
  maxLevel: 5,
  // Vrai : l'achat coute la valeur de la case (base + carte), donc la fortune ne bouge pas.
  // Faux : l'achat coute `baseTileCost` quelle que soit la carte.
  buyCostIncludesCard: true,
  // Vrai : une amelioration coute la valeur qu'elle ajoute a la case.
  // Faux : elle coute `baseTileCost x upgradeCostMultipliers[niveau]`.
  upgradeCostFollowsValue: true,
  upgradeCostMultipliers: [0, 0, 0.5, 1.5, 2.0, 3.0],
  levelMultipliers: [0, 1.0, 1.5, 2.5, 4.0, 6.0],
  tollRates: [0, 0.40, 0.45, 0.50, 0.55, 0.60],
  chainBonusPerTile: 0.15,    // par case supplementaire possedee dans la zone
  exclusivityBonus: 1.5,      // zone entierement possedee
  buyoutMultiplier: 5,

  // --- Parcours ---
  checkpointBonus: 300,
  lapBonus: 500,
  startPassBonus: 100,
  startStopBonus: 200,

  // --- Cases speciales ---
  damageMin: 100,
  damageSpread: 200,          // degats = damageMin + [0, damageSpread)
  cubeCounter: 7,
  cubeBaseGP: 100,
  cubeGainMin: 50,            // GP accumules par pas sur la piste de degats
  cubeGainSpread: 100,
  bonusMinCardValue: 4,       // valeur minimale de la carte deja posee sur une case Bonus
  boosterStart: 1,
  boosterStep: 3,
  boosterMax: 10,
  eventFallbackGP: 300,

  // --- Mains de cartes ---
  confuseTurns: 3,
  doubleTollTurns: 5,
  gpMagnetPerTile: 50,
  jokerNoTileGP: 500,
  goldenNoZoneGP: 2000,

  // --- Evenements de plateau ---
  captainChance: 0.3,
  captainTurns: 5,
  captainGP: 100,
  justiceBuyChance: 0.3,
  darkBuyChance: 0.25,
  sparkyTurns: 3,
  sparkySteal: 50,
  bibbidiPerPip: 200,
  fantasiaBase: 200,
  fantasiaPerTile: 100,
  honeyPots: 6,
  honeyGoodPots: 4,
  honeyGoodGP: 300,
  honeyBadGP: -200,

  // --- Fin de partie ---
  // Vrai : passer par la case Depart avec l'objectif atteint suffit pour gagner.
  // Faux : il faut s'y arreter pile.
  winOnPass: true,
  // Vrai : un joueur endette qui n'a plus de case a vendre est elimine.
  // Faux : sa dette est effacee et il continue a 0 GP.
  bankruptcy: true,
};
