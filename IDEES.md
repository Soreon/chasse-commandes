# Idées d'ajouts (à reprendre plus tard)

Liste mise de côté après la revue du 27/11/2026. Rien de tout cela n'est commencé.

## Jeu

- **Plusieurs joueurs humains sur le même écran.** Le moteur accepte déjà `isHuman` par joueur ;
  il reste l'écran de configuration (nom et type de chaque siège) et le passage de main entre joueurs.
- **Niveaux de difficulté pour l'IA** (facile / normal / difficile). Les poids de `js/engine/ai.js`
  sont regroupés en tête de fichier, c'est le point d'entrée.
- **Options de partie** : nombre de tours maximum, objectif libre, argent de départ.
- **Jeu en réseau entre amis.** Le moteur est déterministe (graine + liste de choix) : chaque
  client peut rejouer les mêmes actions.

## Interface

- **Écran de fin avec la courbe de fortune** de chaque joueur au fil des tours.
- **Raccourcis clavier** (Espace pour lancer, flèches pour la direction, Échap pour fermer).
- **Sons** (dé, achat, péage, victoire) avec un réglage de volume.
- **Règles complétées** : rachat forcé, vente forcée, Prize Cube, événements de plateau et
  faillite n'y figurent pas encore.
- **Rejouer une partie** à partir de sa graine et de la liste des choix (le moteur le permet).

## Éditeur de plateaux

- Export / import d'un plateau en fichier JSON.
- Bouton « Tester ce plateau » qui lance une partie directement.
- Conserver le nom des zones à la sauvegarde (elles sont renommées « Zone A », « Zone B »…).
- Plus de 6 zones, grilles non carrées, boutons Annuler / Rétablir visibles (Ctrl+Z / Ctrl+Y existent déjà).

## Identité du jeu

- Le thème actuel (nom, personnages, plateaux, événements) est calqué sur un jeu existant et
  conservé tel quel pour l'instant. À terme : nom, plateaux et thème propres, créés avec l'éditeur.
