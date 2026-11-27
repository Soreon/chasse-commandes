// Chef d'orchestre d'une partie dans le navigateur : fait avancer le moteur, joue les
// animations au bon rythme, interroge l'humain ou l'IA, et sauvegarde à chaque début de tour.
//
// L'interface est fournie sous la forme d'un objet `ui` :
//   sync(game)                      rafraîchit l'affichage à partir de l'état du moteur
//   log(message, style)             ajoute une ligne au journal
//   notif(icon, text, style)        affiche une notification brève
//   showDice(rolls, ms)             montre le résultat des dés
//   animateMove(effect, ms)         -> Promise, déplacement d'une case à la suivante
//   animateTeleport(effect, ms)     -> Promise, saut d'une case à une autre
//   animateCubeBreak(effect, ms)    -> Promise, un Prize Cube se brise et paie son cavalier
//   announce(event, ms, tileMs)     -> Promise, annonce une main ou une capture, puis montre les cases gagnées
//   ask(request, game)              -> Promise<choix>, décision d'un joueur humain
//   showMessage(text)               -> Promise, message à valider
//   showVictory(game)               écran de fin
//   persistJournal()                conserve le journal détaillé (appelé à chaque début de tour)

import { decide } from './engine/ai.js';
import { Game, SAVE_VERSION } from './engine/game.js';

const SAVE_KEY = 'chasseCommandes.partie';

// Durées de base en millisecondes (divisées par la vitesse choisie)
export const TIMING = {
  step: 400,
  dice: 1300,
  betweenTurns: 800,
  aiThink: 500,
  teleport: 700,
  cubeBreak: 900,
  announce: 2200,     // annonce d'une main et son effet visuel
  roulette: 3200,     // roulette du Joker ou machine à sous, puis l'effet obtenu
  spotlight: 1700,    // arrivée d'un propriétaire sur une case gagnée à distance
};

export function hasSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return !!raw && JSON.parse(raw).version === SAVE_VERSION;
  } catch {
    return false;
  }
}

export function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? Game.restore(JSON.parse(raw)) : null;
  } catch (e) {
    console.warn('Sauvegarde illisible, ignorée :', e);
    return null;
  }
}

export function clearSavedGame() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch { /* stockage indisponible */ }
}

export class GameController {
  constructor(game, ui, { speed = 1 } = {}) {
    this.game = game;
    this.ui = ui;
    this.speed = speed;
    this.paused = false;
    this.aborted = false;
    this._resumeWaiters = [];
    this._firstTurn = true;
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  setPaused(paused) {
    this.paused = paused;
    if (!paused) this._releaseWaiters();
  }

  // Arrête la partie en cours (retour au menu) : plus rien ne sera joué ni affiché
  abort() {
    this.aborted = true;
    this._releaseWaiters();
  }

  _releaseWaiters() {
    const waiters = this._resumeWaiters;
    this._resumeWaiters = [];
    for (const resolve of waiters) resolve();
  }

  ms(base) {
    return base / this.speed;
  }

  // Attend `base` ms (à la vitesse courante), puis tant que la partie est en pause
  async wait(base) {
    if (base > 0) await new Promise(resolve => setTimeout(resolve, this.ms(base)));
    while (this.paused && !this.aborted) {
      await new Promise(resolve => this._resumeWaiters.push(resolve));
    }
  }

  // Transmet journal et notifications ; retourne les annonces à jouer à l'écran, dans l'ordre
  _flushEvents() {
    const announcements = [];
    for (const event of this.game.takeEvents()) {
      if (event.type === 'log') this.ui.log(event.message, event.style);
      else if (event.type === 'notif') this.ui.notif(event.icon, event.text, event.style);
      else if (event.type === 'announce') announcements.push(event);
    }
    return announcements;
  }

  _save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.game.serialize()));
    } catch (e) {
      console.warn('Sauvegarde impossible :', e);
    }
  }

  async run() {
    const { game, ui } = this;
    if (!game.pending) game.start();

    while (!this.aborted) {
      const announcements = this._flushEvents();
      ui.sync(game);
      // Mains jouées, captures : annonce et effet visuel, pour comprendre ce qui se passe
      for (const announcement of announcements) {
        const duration = announcement.fx?.type === 'roulette' ? TIMING.roulette : TIMING.announce;
        await ui.announce(announcement, this.ms(duration), this.ms(TIMING.spotlight));
        await this.wait(0);
        if (this.aborted) return;
      }

      const request = game.pending;
      if (!request) break;

      let choice;
      if (request.kind === 'effect') {
        await this._playEffect(request);
        if (request.type === 'gameOver') return;
      } else {
        const player = game.players[request.playerId];
        if (player.isHuman) {
          choice = await ui.ask(request, game);
        } else {
          if (request.type === 'turn') await this.wait(TIMING.aiThink);
          choice = decide(game, request);
        }
      }

      await this.wait(0);
      if (this.aborted) return;
      game.resume(choice);
    }
  }

  async _playEffect(effect) {
    const { game, ui } = this;
    switch (effect.type) {
      case 'turnStart':
        // Seul moment où tout l'état tient dans les données : on sauvegarde ici
        this._save();
        ui.persistJournal();
        if (!this._firstTurn) await this.wait(TIMING.betweenTurns);
        this._firstTurn = false;
        break;
      case 'dice':
        ui.showDice(effect.rolls, this.ms(TIMING.dice - 100));
        await this.wait(TIMING.dice);
        break;
      case 'move':
        await ui.animateMove(effect, this.ms(TIMING.step));
        break;
      case 'teleport':
        await ui.animateTeleport(effect, this.ms(TIMING.teleport));
        break;
      case 'cubeBreak':
        await ui.animateCubeBreak(effect, this.ms(TIMING.cubeBreak));
        break;
      case 'message':
        if (game.players[effect.playerId].isHuman) await ui.showMessage(effect.text);
        break;
      case 'gameOver':
        clearSavedGame();
        ui.persistJournal();
        ui.showVictory(game);
        break;
    }
  }
}
