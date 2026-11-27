// Journal détaillé d'une partie, pour l'analyser après coup. Module pur.
//
// Le moteur y inscrit tout ce qui se passe : chaque arrêt (décision demandée ou effet à montrer),
// chaque choix reçu, chaque mouvement de GP avec son origine, chaque ligne du journal de jeu, et
// un instantané complet de l'état au début de chaque tour. L'interface y ajoute le versant
// technique (erreurs, fluidité, actions du joueur, environnement).
//
// Chaque entrée porte : n (numéro d'ordre), t (millisecondes depuis le début, 0 hors navigateur),
// turn (numéro du tour), type, puis ses données.
//
// Types écrits par le moteur :
//   turn     instantané de l'état en début de tour (joueurs, cases possédées, cubes, hasard)
//   request  le moteur s'arrête : décision demandée à un joueur, ou effet à montrer
//   choice   réponse à une décision (avec l'état du hasard à cet instant, pour pouvoir rejouer)
//   log      ligne du journal de jeu
//   gp       mouvement de GP : qui, combien, pourquoi, solde après
//   notif    notification affichée
//   announce annonce d'une main ou d'une capture, avec son effet visuel
//   end      fin de partie : vainqueur, raison, scores, état final
// Types écrits par l'interface : env, ui, perf, error, visibility, save (voir js/sessionLog.js).

export const JOURNAL_FORMAT = 'chasse-commandes-journal';
export const JOURNAL_VERSION = 1;

export class Journal {
  constructor() {
    this.enabled = true;       // la simulation en masse le coupe pour aller plus vite
    this.meta = {};            // paramètres de la partie : de quoi la recréer à l'identique
    this.entries = [];
    this.clock = () => 0;      // fourni par l'interface ; le moteur lui-même ne lit pas l'heure
    this.turnOf = () => 0;
    this._next = 0;
  }

  add(type, data = {}) {
    if (!this.enabled) return;
    // Copie : les données décrivent l'état à cet instant, pas ce qu'il deviendra
    const copy = JSON.parse(JSON.stringify(data));
    this.entries.push({ n: this._next++, t: this.clock(), turn: this.turnOf(), type, ...copy });
  }

  toJSON() {
    return { format: JOURNAL_FORMAT, version: JOURNAL_VERSION, meta: this.meta, entries: this.entries };
  }
}
