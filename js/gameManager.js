// Gestionnaire principal du jeu - orchestre la boucle de jeu

import { TileType, updateTileValue, updateAllTolls, getBuyoutCost, getUpgradeCost, isCheckpoint, getCheckpointColor, getAvailableMoves, CHECKPOINT_BONUS_GP, LAP_BONUS_GP, START_PASS_BONUS, START_STOP_BONUS, BASE_TILE_COST, countOwnedInZone, countTilesInZone, OPPOSITE_DIR } from './board.js';
import { rollDie, CardType, createCard, drawRandomCards, HandType, HAND_DEFINITIONS, getAvailableHands, selectCardsForHand, canPlaceOnTile } from './cards.js';
import { createPlayer, calculateNetWorth, addGP, transferGP, refillHand, removeCardFromHand, allCheckpointsVisited, resetCheckpoints, PLAYER_COLORS, AI_NAMES } from './player.js';
import { Renderer } from './renderer.js';
import { AI } from './ai.js';

export class GameManager {
  constructor() {
    this.board = [];        // Tableau de cases (tiles) indexe par id
    this.boardData = null;   // Donnees completes du plateau (tiles, links, rows, cols)
    this.startTileId = 0;    // ID de la case depart
    this.players = [];
    this.currentPlayerIndex = 0;
    this.turnNumber = 1;
    this.gpGoal = 7500;
    this.phase = 'idle'; // idle | hand | roll | moving | tileAction | gameOver
    this.renderer = null;
    this.animState = null;

    // Etat de la main jouee ce tour
    this.activeHandEffect = null; // HandType actif pour ce tour (Two Dice, Navigator, etc.)

    // Callbacks UI
    this.onUpdate = null;
    this.onLog = null;
    this.onShowOverlay = null;
    this.onHideOverlay = null;
    this.onDirectionChoice = null;
    this.onVictory = null;

    // Captain Justice/Dark
    this.captainJusticeActive = false;
    this.captainDarkActive = false;

    // Prize Cubes : { id, sourceTileId, tileId, counter, maxCounter, accumulatedGP, riderId }
    this.prizeCubes = [];

    // Hunny Hunt : pots de miel places sur le plateau { tileId, isGood }
    this.honeyPots = [];

    // Gigawatt Jolt : { playerId, turnsLeft } - vol de GP aux adversaires
    this.sparkyEffect = null;
  }

  // Initialise une nouvelle partie
  init(playerName, opponentCount, gpGoal, boardData, spectator = false, boardName = '') {
    this.gpGoal = gpGoal;
    this.spectator = spectator;
    this.boardName = boardName;
    this.board = boardData.tiles;
    this.boardData = boardData;
    this.startTileId = boardData.startTileId;

    // Creer les joueurs
    this.players = [];
    if (spectator) {
      const totalPlayers = opponentCount + 1;
      for (let i = 0; i < totalPlayers; i++) {
        this.players.push(createPlayer(i, AI_NAMES[i] || `IA ${i + 1}`, false, PLAYER_COLORS[i]));
      }
    } else {
      this.players.push(createPlayer(0, playerName, true, PLAYER_COLORS[0]));
      for (let i = 0; i < opponentCount; i++) {
        this.players.push(createPlayer(i + 1, AI_NAMES[i] || `IA ${i + 1}`, false, PLAYER_COLORS[i + 1]));
      }
    }
    // Positionner tous les joueurs sur la case depart
    for (const p of this.players) {
      p.position = this.startTileId;
    }

    this.currentPlayerIndex = 0;
    this.turnNumber = 1;
    this.phase = 'hand';

    // Initialiser les Prize Cubes a partir des cases damage avec hasDice
    this.prizeCubes = [];
    let cubeId = 0;
    for (const tile of this.board) {
      if (tile.type === TileType.DAMAGE && tile.hasDice) {
        const maxCounter = 7; // Compteur par defaut
        this.prizeCubes.push({
          id: cubeId++,
          sourceTileId: tile.id,
          tileId: tile.id,
          counter: maxCounter,
          maxCounter,
          accumulatedGP: 200, // GP de base initial dans le cube
          riderId: null,
        });
      }
    }

    // Renderer
    const canvas = document.getElementById('board-canvas');
    this.renderer = new Renderer(canvas);
    this.renderer.loadImages();

    this.render();
    this.log(`Partie lancee ! Objectif : ${this.gpGoal} GP de valeur nette.`);
    this.log(`C'est au tour de ${this.currentPlayer.name}.`);

    this.updateUI();

    // Si le premier joueur est une IA, jouer automatiquement
    if (!this.currentPlayer.isHuman) {
      this.playAITurn();
    }
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  // === PHASE 1 : MAIN DE CARTES ===

  // Le joueur humain joue une main de cartes
  playHand(handType, targetPlayerId) {
    const player = this.currentPlayer;
    const handDef = HAND_DEFINITIONS.find(h => h.type === handType);
    if (!handDef) return;

    // Selectionner et consommer les cartes
    const consumed = selectCardsForHand(player.hand, handDef);
    if (!consumed) return;

    for (const card of consumed) {
      removeCardFromHand(player, card.instanceId);
    }

    // Appliquer l'effet de la main
    this.resolveHandEffect(player, handDef, targetPlayerId);

    this.phase = 'roll';
    this.updateUI();
  }

  // Passe la phase main
  skipHand() {
    this.activeHandEffect = null;
    this.phase = 'roll';
    this.updateUI();
  }

  resolveHandEffect(player, handDef, targetId) {
    const target = targetId !== undefined ? this.players.find(p => p.id === targetId) : null;

    switch (handDef.type) {
      case HandType.STUN:
        if (target) {
          target.stunned = true;
          this.log(`${player.name} joue Stun sur ${target.name} ! Tour passe.`, 'important');
          this.showNotif('⚡', `${target.name} est etourdi !`, 'negative');
        }
        break;

      case HandType.TWO_DICE:
        this.activeHandEffect = HandType.TWO_DICE;
        this.log(`${player.name} joue Double De ! 2 des ce tour.`, 'important');
        break;

      case HandType.THREE_DICE:
        this.activeHandEffect = HandType.THREE_DICE;
        this.log(`${player.name} joue Triple De ! 3 des ce tour.`, 'important');
        break;

      case HandType.GP_PROTECTOR:
        player.gpProtector = (player.gpProtector || 0) + 1;
        this.log(`${player.name} joue Protecteur GP ! Prochaine perte bloquee.`, 'important');
        break;

      case HandType.NAVIGATOR:
        this.activeHandEffect = HandType.NAVIGATOR;
        this.log(`${player.name} joue Navigateur ! Peut aller dans toutes les directions.`, 'important');
        break;

      case HandType.CONFUSE:
        for (const p of this.players) {
          if (p.id !== player.id) {
            p.confusedTurns = 3;
          }
        }
        this.log(`${player.name} joue Confusion ! Adversaires confus pour 3 tours.`, 'important');
        break;

      case HandType.DOUBLE_TOLL:
        player.doubleTollTurns = 5;
        this.log(`${player.name} joue Double Peage ! Peages x2 pendant 5 tours.`, 'important');
        break;

      case HandType.GP_MAGNET: {
        let totalEnemyTiles = 0;
        for (const p of this.players) {
          if (p.id !== player.id) {
            totalEnemyTiles += this.board.filter(t => t.owner === p.id).length;
          }
        }
        const gpGain = totalEnemyTiles * 100;
        addGP(player, gpGain);
        this.log(`${player.name} joue Aimant GP ! +${gpGain} GP (${totalEnemyTiles} cases adverses).`, 'important');
        break;
      }

      case HandType.JOKERS_FORTUNE:
        this.resolveJokersFortune(player);
        break;

      case HandType.GOLDEN_CHANCE:
        this.resolveGoldenChance(player);
        break;
    }

    this.render();
  }

  resolveJokersFortune(player) {
    const effects = [
      () => {
        // Stun aleatoire
        const targets = this.players.filter(p => p.id !== player.id);
        if (targets.length > 0) {
          const t = targets[Math.floor(Math.random() * targets.length)];
          t.stunned = true;
          this.log(`Fortune du Joker : Stun ! ${t.name} passe son tour.`, 'important');
          this.showNotif('⚡', `${t.name} est etourdi !`, 'negative');
        }
      },
      () => {
        // Two Dice
        this.activeHandEffect = HandType.TWO_DICE;
        this.log(`Fortune du Joker : Double De !`, 'important');
      },
      () => {
        // GP Protector
        player.gpProtector = (player.gpProtector || 0) + 1;
        this.log(`Fortune du Joker : Protecteur GP !`, 'important');
      },
      () => {
        // GP Magnet
        let totalEnemyTiles = 0;
        for (const p of this.players) {
          if (p.id !== player.id) totalEnemyTiles += this.board.filter(t => t.owner === p.id).length;
        }
        addGP(player, totalEnemyTiles * 100);
        this.log(`Fortune du Joker : Aimant GP ! +${totalEnemyTiles * 100} GP.`, 'important');
      },
      () => {
        // Panel Capture - capturer une case aleatoire
        const unowned = this.board.filter(t => t.type === TileType.NORMAL && t.owner === null);
        if (unowned.length > 0) {
          const target = unowned[Math.floor(Math.random() * unowned.length)];
          target.owner = player.id;
          target.level = 1;
          target.cardPlaced = null;
          updateTileValue(this.board, target.id);
          updateAllTolls(this.board);
          this.log(`Fortune du Joker : Capture de case ! Case ${target.id} capturee !`, 'important');
        } else {
          addGP(player, 500);
          this.log(`Fortune du Joker : Bonus ! +500 GP.`, 'important');
        }
      },
    ];
    effects[Math.floor(Math.random() * effects.length)]();
  }

  resolveGoldenChance(player) {
    const effects = [
      () => {
        // Zone Capture - capturer une zone entiere
        const zones = this.boardData.zones || [];
        const capturableZones = zones.filter(z => {
          const zoneTiles = this.board.filter(t => t.zone === z.id && t.type === TileType.NORMAL);
          return zoneTiles.some(t => t.owner !== player.id);
        });
        if (capturableZones.length > 0) {
          const zone = capturableZones[Math.floor(Math.random() * capturableZones.length)];
          const zoneTiles = this.board.filter(t => t.zone === zone.id && t.type === TileType.NORMAL);
          for (const t of zoneTiles) {
            t.owner = player.id;
            if (t.level === 0) t.level = 1;
            if (!t.cardPlaced) t.cardPlaced = null;
          }
          updateAllTolls(this.board);
          this.log(`Chance Doree : Capture de zone ! Zone ${zone.name} capturee !`, 'important');
        } else {
          addGP(player, 2000);
          this.log(`Chance Doree : Jackpot ! +2000 GP !`, 'important');
        }
      },
      () => {
        this.activeHandEffect = HandType.THREE_DICE;
        this.log(`Chance Doree : Triple De !`, 'important');
      },
      () => {
        player.doubleTollTurns = 5;
        this.log(`Chance Doree : Double Peage pour 5 tours !`, 'important');
      },
      () => {
        for (const p of this.players) {
          if (p.id !== player.id) p.confusedTurns = 3;
        }
        this.log(`Chance Doree : Confusion generale ! 3 tours.`, 'important');
      },
    ];
    effects[Math.floor(Math.random() * effects.length)]();
  }

  // === PRIZE CUBE ===

  // Trouve un Prize Cube sur une case donnee (non chevauche)
  getPrizeCubeAtTile(tileId) {
    return this.prizeCubes.find(c => c.tileId === tileId && c.riderId === null);
  }

  // Trouve le Prize Cube chevauche par un joueur
  getPlayerPrizeCube(playerId) {
    return this.prizeCubes.find(c => c.riderId === playerId);
  }

  // Le joueur monte sur un Prize Cube
  mountPrizeCube(player, cube) {
    cube.riderId = player.id;
    player.prizeCube = { cubeId: cube.id };
    this.log(`${player.name} monte sur le Prize Cube ! (compteur: ${cube.counter})`, 'important');
  }

  // Le joueur descend du cube, le cube reste sur place (sortie de piste damage)
  dismountCubeStay(player, cube) {
    player.prizeCube = null;
    cube.riderId = null;
    this.log(`${player.name} quitte la piste damage et descend du Prize Cube.`);
  }

  // Le compteur du cube atteint 0 : il se brise, le joueur recoit les GP, le cube respawn
  dismountCubeBreak(player, cube) {
    const gp = cube.accumulatedGP;
    addGP(player, gp);
    this.log(`Le Prize Cube se brise ! ${player.name} recoit ${gp} GP accumules !`, 'important');
    this.showNotif('💎', `Prize Cube ! +${gp} GP`, 'positive');
    player.prizeCube = null;

    // Respawn le cube a sa position d'origine
    cube.riderId = null;
    cube.tileId = cube.sourceTileId;
    cube.counter = cube.maxCounter;
    cube.accumulatedGP = 200;
  }

  // Piratage : un autre joueur vole le Prize Cube
  piratePrizeCube(thief, previousRider, cube) {
    // Le cavalier precedent tombe et subit des degats
    previousRider.prizeCube = null;
    this.log(`${thief.name} vole le Prize Cube a ${previousRider.name} !`, 'important');
    this.applyDamagePenalty(previousRider);

    // Le voleur monte sur le cube
    cube.riderId = thief.id;
    thief.prizeCube = { cubeId: cube.id };
    this.log(`${thief.name} chevauche le Prize Cube ! (${cube.accumulatedGP} GP, compteur: ${cube.counter})`, 'important');
  }

  // === PHASE 2 : LANCER DE DES ===

  async roll() {
    const player = this.currentPlayer;

    // Nombre de des determine par la main jouee
    let diceCount = 1;
    if (this.activeHandEffect === HandType.TWO_DICE) diceCount = 2;
    if (this.activeHandEffect === HandType.THREE_DICE) diceCount = 3;

    let total = 0;
    const rolls = [];

    for (let i = 0; i < diceCount; i++) {
      let val = rollDie();
      if (player.frozen) {
        val = Math.min(val, 3);
      }
      rolls.push(val);
      total += val;
    }

    // Reset etats temporaires apres utilisation
    player.frozen = false;

    this.log(`${player.name} lance ${diceCount} de(s) : [${rolls.join(', ')}] = ${total}`);

    // Afficher les des puis commencer le deplacement
    this.phase = 'moving';
    this.showDice(rolls);
    await this.delay(1300);
    this.startMovement(total);
  }

  showDice(rolls) {
    const display = document.getElementById('dice-display');
    display.innerHTML = rolls.map(r => `<div class="dice">${r}</div>`).join('');
    document.getElementById('dice-overlay').classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('dice-overlay').classList.add('hidden');
    }, 1200);
  }

  // Affiche une notification visuelle temporaire (icon + texte)
  // style: 'positive' | 'negative' | 'info' (defaut)
  showNotif(icon, text, style = 'info', duration = 1200) {
    const display = document.getElementById('notif-display');
    display.innerHTML = `<span class="notif-icon">${icon}</span><span class="notif-text ${style}">${text}</span>`;
    const overlay = document.getElementById('notif-overlay');
    overlay.classList.remove('hidden');
    // Reset l'animation
    display.style.animation = 'none';
    display.offsetHeight; // force reflow
    display.style.animation = '';
    setTimeout(() => overlay.classList.add('hidden'), duration);
  }

  // === PHASE 3 : DEPLACEMENT ===

  async startMovement(stepsRemaining) {
    const player = this.currentPlayer;

    if (stepsRemaining <= 0) {
      this.onLand();
      return;
    }

    // Obtenir les deplacements possibles
    // Navigator permet d'ignorer la regle anti-demi-tour
    const lastDir = this.activeHandEffect === HandType.NAVIGATOR ? null : player.lastDirection;
    const moves = getAvailableMoves(this.board, player.position, lastDir);

    if (moves.length === 1) {
      await this.moveToTile(moves[0], stepsRemaining);
    } else {
      // Confusion : direction aleatoire aux intersections
      if (player.confusedTurns > 0) {
        const randomMove = moves[Math.floor(Math.random() * moves.length)];
        this.log(`${player.name} est confus et va au hasard !`);
        await this.moveToTile(randomMove, stepsRemaining);
      } else if (player.isHuman) {
        this.askDirection(moves, stepsRemaining);
      } else {
        const choice = AI.chooseDirection(player, moves, this.board, this.players);
        await this.moveToTile(choice, stepsRemaining);
      }
    }
  }

  askDirection(moves, stepsRemaining) {
    if (this.onDirectionChoice) {
      this.onDirectionChoice(moves, (chosenMove) => {
        this.moveToTile(chosenMove, stepsRemaining);
      });
    }
  }

  async moveToTile(move, stepsRemaining) {
    const player = this.currentPlayer;
    const fromTileId = player.position;
    const fromTile = this.board[fromTileId];

    const toTile = this.board[move.tileId];

    // Si le joueur chevauche un cube et quitte la piste damage, demonter AVANT l'animation
    const riddenCube = this.getPlayerPrizeCube(player.id);
    if (riddenCube && toTile.type !== TileType.DAMAGE) {
      this.dismountCubeStay(player, riddenCube);
    }

    // Animation
    await this.animateMovement(fromTileId, move.tileId, player);

    player.lastDirection = move.direction;
    player.position = move.tileId;

    // === Mecanique du Prize Cube (suite) ===
    if (riddenCube && toTile.type === TileType.DAMAGE) {
      // Le cube suit le joueur sur la piste damage
      riddenCube.tileId = move.tileId;

      // Accumuler les GP des degats evites
      const damage = 100 + Math.floor(Math.random() * 200);
      riddenCube.accumulatedGP += damage;
      riddenCube.counter--;

      if (riddenCube.counter <= 0) {
        // Le cube se brise, respawn a la source, joueur recoit les GP
        this.dismountCubeBreak(player, riddenCube);
      }
    } else if (!riddenCube && toTile.type === TileType.DAMAGE) {
      // Joueur sans cube passe sur une case damage : monter sur un cube libre ou pirater
      const cubeHere = this.getPrizeCubeAtTile(move.tileId);
      if (cubeHere) {
        this.mountPrizeCube(player, cubeHere);
      } else {
        // Verifier si un autre joueur chevauche un cube sur cette case (piratage au passage)
        for (const other of this.players) {
          if (other.id !== player.id && other.prizeCube) {
            const otherCube = this.getPlayerPrizeCube(other.id);
            if (otherCube && otherCube.tileId === move.tileId) {
              this.piratePrizeCube(player, other, otherCube);
              break;
            }
          }
        }
      }
    }

    // Effets de passage seulement si on ne s'arrete PAS ici (pas la derniere case)
    if (stepsRemaining > 1) {
      this.onPass(move.tileId);
    }

    // Verifier Captain Dark/Justice transmission
    this.checkCaptainTransfer(player);

    this.render();

    // Continuer le deplacement
    await this.startMovement(stepsRemaining - 1);
  }

  animateMovement(fromTileId, toTileId, player) {
    return new Promise(resolve => {
      const duration = 200; // ms
      const start = performance.now();

      const animate = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);

        this.animState = {
          active: true,
          playerId: player.id,
          fromTileId,
          toTileId,
          progress,
          color: player.color,
          name: player.name,
          hasPrizeCube: !!player.prizeCube,
        };
        this.render();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          this.animState = null;
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  // Effets en passant par une case (sans s'arreter)
  onPass(tileId) {
    const tile = this.board[tileId];
    const player = this.currentPlayer;

    // Checkpoint
    if (isCheckpoint(tile.type)) {
      const color = getCheckpointColor(tile.type);
      if (color && !player.checkpoints[color]) {
        player.checkpoints[color] = true;
        addGP(player, CHECKPOINT_BONUS_GP);
        // +1 carte au passage d'un checkpoint
        if (player.hand.length < 5) {
          const newCards = drawRandomCards(1);
          player.hand.push(newCards[0]);
          this.log(`${player.name} active le checkpoint ${color} ! +${CHECKPOINT_BONUS_GP} GP +1 carte`);
        } else {
          this.log(`${player.name} active le checkpoint ${color} ! +${CHECKPOINT_BONUS_GP} GP`);
        }
        this.showNotif('🚩', `Checkpoint ${color} ! +${CHECKPOINT_BONUS_GP} GP`, 'positive');
      }
    }

    // Case depart (en passant)
    if (tile.type === TileType.START) {
      this.onPassStart(player);
    }

    // GP Booster (en passant) - augmente le pourcentage
    if (tile.type === TileType.BOOSTER) {
      player.boosterPercent = Math.min((player.boosterPercent || 1) + 3, 10);
      this.log(`${player.name} passe par le Booster ! Multiplicateur: ${player.boosterPercent}%`);
    }

    // Pots de miel (Hunny Hunt) - collecte en passant
    const pot = this.honeyPots.find(p => p.tileId === tileId);
    if (pot) {
      this.collectHoneyPot(player, pot);
    }
  }

  onPassStart(player) {
    addGP(player, START_PASS_BONUS);
    this.log(`${player.name} passe par le Depart ! +${START_PASS_BONUS} GP.`);

    // Lap bonus + recharge main SEULEMENT si tous les checkpoints sont actives
    if (allCheckpointsVisited(player)) {
      addGP(player, LAP_BONUS_GP);
      refillHand(player);
      resetCheckpoints(player);
      this.log(`BONUS DE TOUR ! ${player.name} gagne ${LAP_BONUS_GP} GP ! Main restauree.`, 'important');
      this.showNotif('⭐', `Bonus de tour ! +${LAP_BONUS_GP} GP`, 'positive');
    }
  }

  // === PHASE 4 : ACTION DE CASE (atterrissage) ===

  onLand() {
    const player = this.currentPlayer;
    const tile = this.board[player.position];

    this.phase = 'tileAction';

    // Pots de miel (Hunny Hunt) - collecte a l'atterrissage
    const pot = this.honeyPots.find(p => p.tileId === tile.id);
    if (pot) {
      this.collectHoneyPot(player, pot);
    }

    // Checkpoint (si on s'arrete dessus aussi)
    if (isCheckpoint(tile.type)) {
      const color = getCheckpointColor(tile.type);
      if (color && !player.checkpoints[color]) {
        player.checkpoints[color] = true;
        addGP(player, CHECKPOINT_BONUS_GP);
        if (player.hand.length < 5) {
          const newCards = drawRandomCards(1);
          player.hand.push(newCards[0]);
          this.log(`${player.name} active le checkpoint ${color} ! +${CHECKPOINT_BONUS_GP} GP +1 carte`);
        } else {
          this.log(`${player.name} active le checkpoint ${color} ! +${CHECKPOINT_BONUS_GP} GP`);
        }
        this.showNotif('🚩', `Checkpoint ${color} ! +${CHECKPOINT_BONUS_GP} GP`, 'positive');
      }
    }

    // Case depart - arret
    if (tile.type === TileType.START) {
      this.handleStartTile(player);
      return;
    }

    // Case normale
    if (tile.type === TileType.NORMAL) {
      if (tile.owner === null) {
        this.handleEmptyTile(player, tile);
        return;
      } else if (tile.owner === player.id) {
        this.handleOwnTile(player, tile);
        return;
      } else {
        this.handleEnemyTile(player, tile);
        return;
      }
    }

    // Cases speciales
    if (tile.type === TileType.BONUS) {
      this.handleBonusTile(player);
      return;
    }
    if (tile.type === TileType.DAMAGE) {
      // Verifier Prize Cube sur cette case
      const cubeHere = this.getPrizeCubeAtTile(tile.id);
      const riddenCube = this.getPlayerPrizeCube(player.id);

      if (riddenCube) {
        // Le joueur chevauche deja un cube - il est en securite
        this.log(`${player.name} est en securite sur le Prize Cube !`);
        this.render();
        this.endTurn();
      } else if (cubeHere) {
        // Prize Cube libre : monter dessus
        this.mountPrizeCube(player, cubeHere);
        this.render();
        this.endTurn();
      } else {
        // Verifier si un autre joueur chevauche un cube ICI (piratage)
        let pirated = false;
        for (const other of this.players) {
          if (other.id !== player.id && other.prizeCube) {
            const otherCube = this.getPlayerPrizeCube(other.id);
            if (otherCube && otherCube.tileId === tile.id) {
              this.piratePrizeCube(player, other, otherCube);
              pirated = true;
              break;
            }
          }
        }
        if (pirated) {
          this.render();
          this.endTurn();
        } else {
          this.handleDamageTile(player);
        }
      }
      return;
    }
    if (tile.type === TileType.JOKER) {
      this.handleJokerTile(player);
      return;
    }
    if (tile.type === TileType.EVENT) {
      this.handleEventTile(player);
      return;
    }
    if (tile.type === TileType.BOOSTER) {
      this.handleBoosterTile(player);
      return;
    }

    // Checkpoints et autres - fin de tour directe
    this.endTurn();
  }

  handleStartTile(player) {
    // Enregistrer GP avant les bonus pour la condition de victoire
    const gpBeforeBonus = calculateNetWorth(player, this.board);

    addGP(player, START_STOP_BONUS);
    this.log(`${player.name} s'arrete sur le Depart ! +${START_STOP_BONUS} GP.`, 'important');

    if (allCheckpointsVisited(player)) {
      addGP(player, LAP_BONUS_GP);
      refillHand(player);
      resetCheckpoints(player);
      this.log(`BONUS DE TOUR ! +${LAP_BONUS_GP} GP ! Main restauree.`, 'important');
    }

    // Verifier victoire : le joueur devait avoir atteint le seuil AVANT les bonus
    // Si le seuil est atteint grace aux bonus eux-memes, il doit revenir
    if (gpBeforeBonus >= this.gpGoal) {
      this.victory(player);
      return;
    }

    const gpAfterBonus = calculateNetWorth(player, this.board);
    if (gpAfterBonus >= this.gpGoal) {
      this.log(`${player.name} atteint l'objectif grace aux bonus, mais doit revenir au depart !`, 'important');
    }

    this.endTurn();
  }

  handleEmptyTile(player, tile) {
    const cost = tile.baseValue;

    if (player.isHuman) {
      const placeableCards = player.hand.filter(c => canPlaceOnTile(c));
      if (player.gp >= cost && placeableCards.length > 0) {
        this.showTileAction('buy', tile, player);
      } else {
        if (player.gp < cost) this.log(`Pas assez de GP pour acheter cette case (${cost} GP).`);
        if (placeableCards.length === 0) this.log(`Pas de carte a placer sur cette case.`);
        this.endTurn();
      }
    } else {
      // IA decide
      if (AI.shouldBuyTile(player, tile, this.board)) {
        const card = AI.chooseCardToPlace(player);
        if (card) this.buyTile(player, tile, card);
      }
      this.endTurn();
    }
  }

  handleOwnTile(player, tile) {
    const cost = getUpgradeCost(tile);

    if (player.isHuman) {
      if (player.gp >= cost && tile.level < 5) {
        this.showTileAction('upgrade', tile, player);
      } else {
        this.endTurn();
      }
    } else {
      if (AI.shouldUpgradeTile(player, tile)) {
        this.upgradeTile(player, tile);
      }
      this.endTurn();
    }
  }

  handleEnemyTile(player, tile) {
    const owner = this.players.find(p => p.id === tile.owner);
    let tollAmount = tile.tollValue;

    // Double Toll actif sur le proprietaire
    if (owner.doubleTollTurns > 0) {
      tollAmount *= 2;
    }

    // GP Protector bloque la perte
    if (player.gpProtector > 0) {
      player.gpProtector--;
      this.log(`Protecteur GP actif ! Peage bloque.`, 'important');
      this.endTurn();
      return;
    }

    if (player.isHuman) {
      this.showTileAction('toll', tile, player);
    } else {
      // IA paye le peage ou rachete
      if (AI.shouldBuyout(player, tile)) {
        this.buyoutTile(player, tile, owner);
      } else {
        const actual = transferGP(player, owner, tollAmount);
        this.log(`${player.name} paye ${actual} GP de peage a ${owner.name}.`, 'negative');
        this.showNotif('💰', `${player.name} paye ${actual} GP a ${owner.name}`, 'negative');
      }
      this.endTurn();
    }
  }

  // Acheter une case
  buyTile(player, tile, card) {
    addGP(player, -tile.baseValue);
    if (card) removeCardFromHand(player, card.instanceId);
    tile.owner = player.id;
    tile.cardPlaced = card;
    tile.level = 1;
    updateTileValue(this.board, tile.id);
    updateAllTolls(this.board);
    this.log(`${player.name} achete la case ${tile.id} pour ${tile.baseValue} GP !${card ? ` (${card.name} placee)` : ''}`, 'important');
    this.showNotif('🏠', `Case achetee ! -${tile.baseValue} GP`, 'info');
    this.render();
  }

  // Ameliorer une case
  upgradeTile(player, tile) {
    const cost = getUpgradeCost(tile);
    addGP(player, -cost);
    tile.level++;
    updateTileValue(this.board, tile.id);
    updateAllTolls(this.board);
    this.log(`${player.name} ameliore la case ${tile.id} au niveau ${tile.level} pour ${cost} GP !`);
    this.showNotif('⬆️', `Niveau ${tile.level} ! -${cost} GP`, 'info');
    this.render();
  }

  // Rachat force
  buyoutTile(player, tile, previousOwner) {
    const cost = getBuyoutCost(tile);
    transferGP(player, previousOwner, cost);
    tile.owner = player.id;
    tile.level = 1;
    updateTileValue(this.board, tile.id);
    updateAllTolls(this.board);
    this.log(`${player.name} rachete de force la case ${tile.id} pour ${cost} GP !`, 'important');
    this.showNotif('⚔️', `Rachat force ! -${cost} GP`, 'negative');
    this.render();
  }

  // === CASES SPECIALES ===

  handleBonusTile(player) {
    // Case bonus : propose une commande predeterminee a acheter (sans carte de la main)
    const bonusCost = 200 + Math.floor(Math.random() * 200);
    const bonusCard = drawRandomCards(1)[0];

    if (player.isHuman) {
      if (player.gp >= bonusCost) {
        this.showTileAction('bonus', { bonusCost, bonusCard }, player);
      } else {
        this.log(`Case Bonus : ${bonusCard.name} disponible pour ${bonusCost} GP, mais pas assez de GP.`);
        this.endTurn();
      }
    } else {
      // IA achete si elle a les moyens
      if (player.gp >= bonusCost && player.gp > bonusCost * 1.5) {
        addGP(player, -bonusCost);
        player.hand.push(bonusCard);
        if (player.hand.length > 5) player.hand.pop();
        this.log(`${player.name} achete ${bonusCard.name} pour ${bonusCost} GP sur la case Bonus !`, 'important');
      }
      this.endTurn();
    }
  }

  handleDamageTile(player) {
    const damage = 100 + Math.floor(Math.random() * 200);

    // GP Protector bloque les degats
    if (player.gpProtector > 0) {
      player.gpProtector--;
      this.log(`Protecteur GP actif ! Degats bloques.`, 'important');
      this.showNotif('🛡️', 'Protecteur GP ! Degats bloques !', 'positive');
      if (player.isHuman) {
        this.showEventResult('Protecteur GP ! Degats bloques !', () => this.endTurn());
      } else {
        this.endTurn();
      }
      return;
    }

    addGP(player, -damage);
    this.log(`Case Degats ! ${player.name} perd ${damage} GP !`, 'negative');
    this.showNotif('💥', `${player.name} -${damage} GP`, 'negative');

    if (player.isHuman) {
      this.showEventResult(`Degats ! -${damage} GP`, () => this.endTurn());
    } else {
      this.endTurn();
    }
  }

  handleJokerTile(player) {
    const events = [
      () => {
        addGP(player, 500);
        this.log(`Joker ! Tresor trouve ! +500 GP !`, 'important');
        return 'Tresor ! +500 GP';
      },
      () => {
        addGP(player, -300);
        this.log(`Joker ! Piege ! -300 GP !`, 'negative');
        return 'Piege ! -300 GP';
      },
      () => {
        player.position = this.startTileId;
        this.log(`Joker ! Teleportation au depart !`, 'important');
        return 'Teleportation au depart !';
      },
      () => {
        const target = this.players.find(p => p.id !== player.id && p.gp > 0);
        if (target) {
          const stolen = Math.min(200, target.gp);
          transferGP(target, player, stolen);
          this.log(`Joker ! ${player.name} vole ${stolen} GP a ${target.name} !`, 'important');
          return `Vol ! +${stolen} GP de ${target.name}`;
        }
        return 'Rien ne se passe...';
      },
      () => {
        if (!this.captainJusticeActive) {
          player.justiceTurns = 5;
          this.captainJusticeActive = true;
          this.log(`Captain Justice rejoint ${player.name} pour 5 tours !`, 'important');
          this.showNotif('🦸', `Captain Justice rejoint ${player.name} !`, 'positive');
          return 'Captain Justice vous rejoint !';
        }
        addGP(player, 200);
        return 'Bonus ! +200 GP';
      },
      () => {
        if (!this.captainDarkActive) {
          player.darkTurns = 5;
          this.captainDarkActive = true;
          this.log(`Captain Dark s'attache a ${player.name} pour 5 tours !`, 'negative');
          this.showNotif('🦹', `Captain Dark s'attache a ${player.name} !`, 'negative');
          return 'Captain Dark vous hante !';
        }
        addGP(player, -150);
        return 'Malchance ! -150 GP';
      },
    ];

    const event = events[Math.floor(Math.random() * events.length)];
    const message = event();

    if (player.isHuman) {
      this.showEventResult(message, () => this.endTurn());
    } else {
      this.endTurn();
    }
  }

  handleEventTile(player) {
    // 30% de chance de declencher Captain Justice/Dark au lieu de l'evenement
    // (sauf sur Toon Board ou Pete est deja adversaire)
    if (this.boardName !== 'Toon' && Math.random() < 0.3) {
      const isCaptainJustice = Math.random() < 0.5;
      if (isCaptainJustice && !this.captainJusticeActive) {
        this.captainJusticeActive = true;
        player.justiceTurns = 5;
        this.log(`Captain Justice rejoint ${player.name} pour 5 tours !`, 'important');
        this.showNotif('🦸', `Captain Justice rejoint ${player.name} !`, 'positive');
        this.showEventAndEndTurn(player, 'Captain Justice vous rejoint !');
        return;
      } else if (!isCaptainJustice && !this.captainDarkActive) {
        this.captainDarkActive = true;
        player.darkTurns = 5;
        this.log(`Captain Dark s'attache a ${player.name} pour 5 tours !`, 'negative');
        this.showNotif('🦹', `Captain Dark s'attache a ${player.name} !`, 'negative');
        this.showEventAndEndTurn(player, 'Captain Dark vous hante !');
        return;
      }
    }

    // Evenement specifique au plateau
    switch (this.boardName) {
      case 'Keyblade':
      case 'Secret':
        this.eventKeybladeGlider(player);
        break;
      case 'Royal':
        this.eventBibbidiBoo(player);
        break;
      case 'Spaceship':
        this.eventGigawattJolt(player);
        break;
      case 'Toon':
        this.eventFantasia(player);
        break;
      case 'Skull':
        this.eventPixieDust(player);
        break;
      case 'Honeypot':
        this.eventHunnyHunt(player);
        break;
      default:
        // Fallback generique
        addGP(player, 300);
        this.log(`Evenement special ! +300 GP.`, 'important');
        this.showEventAndEndTurn(player, 'Evenement special : +300 GP');
    }
  }

  showEventAndEndTurn(player, message) {
    if (player.isHuman) {
      this.showEventResult(message, () => this.endTurn());
    } else {
      this.endTurn();
    }
  }

  // --- Keyblade Glider (Keyblade & Secret Board) ---
  // Teleportation vers n'importe quelle case du plateau
  eventKeybladeGlider(player) {
    this.log(`Keyblade Glider ! ${player.name} peut se teleporter !`, 'important');

    if (player.isHuman) {
      // Montrer l'overlay de choix de case
      if (this.onShowOverlay) {
        this.onShowOverlay('teleportChoice', { tiles: this.board }, player, this.board, (tileId) => {
          player.position = tileId;
          this.log(`${player.name} se teleporte a la case ${tileId} !`, 'important');
          this.render();
          this.endTurn();
        });
      }
    } else {
      // IA : se teleporter sur un checkpoint non visite, ou une case vide interessante
      const target = this.aiChooseTeleportTarget(player);
      player.position = target;
      this.log(`${player.name} se teleporte a la case ${target} !`, 'important');
      this.render();
      this.endTurn();
    }
  }

  aiChooseTeleportTarget(player) {
    // Priorite : checkpoint non visite > case libre dans une zone partiellement possedee > depart
    for (const tile of this.board) {
      if (isCheckpoint(tile.type)) {
        const color = getCheckpointColor(tile.type);
        if (color && !player.checkpoints[color]) return tile.id;
      }
    }
    // Case libre dans une zone ou on a deja des cases
    for (const tile of this.board) {
      if (tile.type === TileType.NORMAL && tile.owner === null && tile.zone) {
        const owned = this.board.filter(t => t.zone === tile.zone && t.owner === player.id).length;
        if (owned > 0) return tile.id;
      }
    }
    return this.startTileId;
  }

  // --- Bibbidi-Bobbidi-Boo (Royal Board) ---
  // La Fee Marraine : lance un de x 200 GP
  eventBibbidiBoo(player) {
    const roll = rollDie();
    const gp = roll * 200;
    addGP(player, gp);
    this.log(`Bibbidi-Bobbidi-Boo ! De: ${roll} x 200 = +${gp} GP !`, 'important');
    this.showEventAndEndTurn(player, `Bibbidi-Bobbidi-Boo ! De ${roll} x 200 = +${gp} GP !`);
  }

  // --- Gigawatt Jolt (Spaceship Board) ---
  // Sparky protege le joueur et vole des GP aux adversaires pendant 3 tours
  eventGigawattJolt(player) {
    this.sparkyEffect = { playerId: player.id, turnsLeft: 3 };
    this.log(`Gigawatt Jolt ! Sparky protege ${player.name} et vole des GP aux adversaires pendant 3 tours !`, 'important');
    this.showEventAndEndTurn(player, 'Gigawatt Jolt ! Sparky vole des GP aux adversaires pendant 3 tours !');
  }

  // --- Fantasia (Toon Board) ---
  // Chip et Dale : 300 GP + 300 GP par case possedee
  eventFantasia(player) {
    const ownedCount = this.board.filter(t => t.owner === player.id).length;
    const bonus = 300 + ownedCount * 300;
    addGP(player, bonus);
    this.log(`Fantasia ! +300 GP + ${ownedCount} cases x 300 GP = +${bonus} GP !`, 'important');
    this.showEventAndEndTurn(player, `Fantasia ! +${bonus} GP (300 + ${ownedCount} x 300) !`);
  }

  // --- Pixie Dust (Skull Board) ---
  // Deplacer un adversaire choisi sur n'importe quelle case
  eventPixieDust(player) {
    this.log(`Pixie Dust ! ${player.name} peut deplacer un adversaire !`, 'important');

    if (player.isHuman) {
      if (this.onShowOverlay) {
        this.onShowOverlay('pixieDust', { players: this.players, tiles: this.board }, player, this.board, (targetId, tileId) => {
          const target = this.players.find(p => p.id === targetId);
          target.position = tileId;
          this.log(`${player.name} envoie ${target.name} sur la case ${tileId} !`, 'important');
          this.render();
          this.endTurn();
        });
      }
    } else {
      // IA : envoyer le leader sur une case de degats ou sur sa propre case la plus chere
      const targets = this.players.filter(p => p.id !== player.id).sort((a, b) => b.gp - a.gp);
      const target = targets[0];
      // Chercher une case de degats ou une case avec gros peage du joueur
      let bestTile = null;
      let bestScore = -Infinity;
      for (const tile of this.board) {
        let score = 0;
        if (tile.type === TileType.DAMAGE) score = 30;
        if (tile.owner === player.id && tile.tollValue > 0) score = tile.tollValue / 10;
        if (score > bestScore) { bestScore = score; bestTile = tile; }
      }
      target.position = bestTile.id;
      this.log(`${player.name} envoie ${target.name} sur la case ${bestTile.id} !`, 'important');
      this.render();
      this.endTurn();
    }
  }

  // --- Hunny Hunt (Honeypot Board) ---
  // 6 pots de miel places aleatoirement (4 bons: +500 GP, 2 mauvais: -200 GP)
  eventHunnyHunt(player) {
    // Placer les pots sur des cases aleatoires (pas de depart, pas deja un pot)
    const currentTileId = this.board[player.position].id;
    const candidates = this.board.filter(t =>
      t.type !== TileType.START && !this.honeyPots.some(p => p.tileId === t.id)
    );

    // Melanger et prendre 6 cases (ou 5 + la case actuelle)
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    const potTiles = shuffled.slice(0, 5);

    // Un pot garanti sur la case speciale elle-meme
    const pots = [];
    // 4 bons, 2 mauvais - melanger
    const types = [true, true, true, true, false, false].sort(() => Math.random() - 0.5);

    // Ajouter la case actuelle en premier
    pots.push({ tileId: currentTileId, isGood: types[0] });
    for (let i = 0; i < potTiles.length; i++) {
      pots.push({ tileId: potTiles[i].id, isGood: types[i + 1] });
    }

    this.honeyPots = pots;

    // Le joueur collecte immediatement le pot sur sa case
    const myPot = this.honeyPots.find(p => p.tileId === currentTileId);
    if (myPot) {
      this.collectHoneyPot(player, myPot);
    }

    this.log(`Hunny Hunt ! 6 pots de miel sont apparus sur le plateau !`, 'important');
    const remaining = this.honeyPots.length;
    this.showEventAndEndTurn(player, `Hunny Hunt ! ${remaining} pots de miel sur le plateau !`);
  }

  collectHoneyPot(player, pot) {
    const idx = this.honeyPots.indexOf(pot);
    if (idx !== -1) this.honeyPots.splice(idx, 1);

    if (pot.isGood) {
      addGP(player, 500);
      this.log(`${player.name} trouve du miel ! +500 GP !`, 'important');
    } else {
      addGP(player, -200);
      this.log(`${player.name} derange les abeilles ! -200 GP !`, 'negative');
    }
  }

  applyDamagePenalty(player) {
    const damage = 100 + Math.floor(Math.random() * 200);
    if (player.gpProtector > 0) {
      player.gpProtector--;
      this.log(`Protecteur GP bloque les degats pour ${player.name} !`, 'important');
    } else {
      addGP(player, -damage);
      this.log(`${player.name} subit ${damage} degats sur la piste de danger !`, 'negative');
    }
  }

  handleBoosterTile(player) {
    // Atterrir sur le Booster : active le multiplicateur accumule, puis reset
    const percent = player.boosterPercent || 1;
    const bonus = Math.floor(player.gp * percent / 100);
    addGP(player, bonus);
    this.log(`Case Booster ! Multiplicateur ${percent}% active ! +${bonus} GP.`, 'important');
    this.showNotif('🚀', `Booster ${percent}% ! +${bonus} GP`, 'positive');
    player.boosterPercent = 1; // Reset

    if (player.isHuman) {
      this.showEventResult(`Booster ${percent}% : +${bonus} GP`, () => this.endTurn());
    } else {
      this.endTurn();
    }
  }

  // === CAPTAIN JUSTICE / DARK ===

  // Transfert au passage a travers un autre joueur (meme case ou cases adjacentes)
  checkCaptainTransfer(player) {
    if (player.darkTurns > 0) {
      for (const other of this.players) {
        if (other.id !== player.id && other.position === player.position) {
          const turns = player.darkTurns;
          player.darkTurns = 0;
          other.darkTurns = turns;
          this.log(`Captain Dark passe de ${player.name} a ${other.name} !`, 'important');
          break;
        }
      }
    }
    if (player.justiceTurns > 0) {
      for (const other of this.players) {
        if (other.id !== player.id && other.position === player.position) {
          const turns = player.justiceTurns;
          player.justiceTurns = 0;
          other.justiceTurns = turns;
          this.log(`Captain Justice passe de ${player.name} a ${other.name} !`, 'important');
          break;
        }
      }
    }
  }

  applyCaptainEffects(player) {
    // Captain Justice : donne des GP et peut acheter une case pour le joueur
    if (player.justiceTurns > 0) {
      addGP(player, 100);
      this.log(`Captain Justice donne 100 GP a ${player.name}.`);
      this.showNotif('🦸', `Captain Justice : +100 GP`, 'positive');

      // 30% de chance d'acheter une case libre adjacente pour le joueur
      if (Math.random() < 0.3) {
        const tile = this.board[player.position];
        for (const [, adj] of Object.entries(tile.adjacencies)) {
          if (!adj) continue;
          const adjTile = this.board[adj.tileId];
          if (adjTile.type === TileType.NORMAL && adjTile.owner === null && player.gp >= adjTile.baseValue) {
            adjTile.owner = player.id;
            adjTile.level = 1;
            addGP(player, -adjTile.baseValue);
            updateTileValue(this.board, adjTile.id);
            updateAllTolls(this.board);
            this.log(`Captain Justice achete la case ${adjTile.id} pour ${player.name} !`, 'important');
            this.showNotif('🦸', `Justice achete la case ${adjTile.id} !`, 'positive');
            break;
          }
        }
      }

      player.justiceTurns--;
      if (player.justiceTurns === 0) {
        this.captainJusticeActive = false;
        this.log(`Captain Justice quitte ${player.name}.`);
      }
    }

    // Captain Dark : vole des GP et peut acheter une case chere avec les GP du joueur
    if (player.darkTurns > 0) {
      addGP(player, -100);
      this.log(`Captain Dark vole 100 GP a ${player.name} !`, 'negative');
      this.showNotif('🦹', `Captain Dark : -100 GP`, 'negative');

      // 25% de chance d'acheter la case la plus chere disponible avec les GP du joueur
      if (Math.random() < 0.25) {
        const expensiveFree = this.board
          .filter(t => t.type === TileType.NORMAL && t.owner === null && player.gp >= t.baseValue)
          .sort((a, b) => b.baseValue - a.baseValue);
        if (expensiveFree.length > 0) {
          const t = expensiveFree[0];
          t.owner = player.id;
          t.level = 1;
          addGP(player, -t.baseValue);
          updateTileValue(this.board, t.id);
          updateAllTolls(this.board);
          this.log(`Captain Dark force l'achat de la case ${t.id} (${t.baseValue} GP) !`, 'negative');
          this.showNotif('🦹', `Dark force l'achat case ${t.id} !`, 'negative');
        }
      }

      player.darkTurns--;
      if (player.darkTurns === 0) {
        this.captainDarkActive = false;
        this.log(`Captain Dark quitte ${player.name}.`);
      }
    }

    // Gigawatt Jolt : vol de GP aux adversaires
    if (this.sparkyEffect && this.sparkyEffect.playerId === player.id) {
      const stolen = 50;
      for (const other of this.players) {
        if (other.id !== player.id) {
          const actual = Math.min(other.gp, stolen);
          addGP(other, -actual);
          addGP(player, actual);
        }
      }
      this.log(`Sparky vole des GP aux adversaires pour ${player.name} !`, 'important');
      this.sparkyEffect.turnsLeft--;
      if (this.sparkyEffect.turnsLeft <= 0) {
        this.sparkyEffect = null;
        this.log(`L'effet de Sparky se dissipe.`);
      }
    }
  }

  // === VENTE FORCEE ===

  // Vend une case possedee : le joueur recupere sa valeur en GP courants
  sellTile(player, tile) {
    const value = tile.currentValue;
    player.gp += value;
    this.log(`${player.name} vend la case ${tile.id} pour ${value} GP.`, 'negative');
    tile.owner = null;
    tile.cardPlaced = null;
    tile.level = 0;
    updateTileValue(this.board, tile.id);
    updateAllTolls(this.board);
    this.render();
  }

  // Verifie si un joueur doit vendre des cases (GP < 0) et lance le processus
  // Retourne true si une vente forcee est en cours (async pour humain)
  checkForcedSale(player, callback) {
    if (player.gp >= 0) {
      callback();
      return;
    }

    const ownedTiles = this.board.filter(t => t.owner === player.id && t.level > 0);

    // Plus de cases a vendre : GP reste negatif, on cap a 0
    if (ownedTiles.length === 0) {
      player.gp = 0;
      this.log(`${player.name} n'a plus de cases a vendre.`);
      callback();
      return;
    }

    if (player.isHuman) {
      // Afficher l'overlay de vente forcee
      this.showForcedSaleOverlay(player, callback);
    } else {
      // IA : vendre la case la moins chere jusqu'a GP >= 0
      this.autoForcedSale(player);
      callback();
    }
  }

  autoForcedSale(player) {
    while (player.gp < 0) {
      const ownedTiles = this.board
        .filter(t => t.owner === player.id && t.level > 0)
        .sort((a, b) => a.currentValue - b.currentValue);
      if (ownedTiles.length === 0) {
        player.gp = 0;
        break;
      }
      this.sellTile(player, ownedTiles[0]);
    }
  }

  showForcedSaleOverlay(player, callback) {
    if (this.onShowOverlay) {
      this.onShowOverlay('forcedSale', { player, board: this.board }, player, this.board, () => {
        // Apres une vente, re-verifier si encore en negatif
        this.checkForcedSale(player, callback);
      });
    }
  }

  // === FIN DE TOUR ===

  endTurn() {
    // Appliquer les effets Captain
    this.applyCaptainEffects(this.currentPlayer);

    // Decrementer les compteurs temporaires
    const player = this.currentPlayer;
    if (player.doubleTollTurns > 0) player.doubleTollTurns--;
    if (player.confusedTurns > 0) player.confusedTurns--;

    // Reset l'effet de main actif
    this.activeHandEffect = null;

    // Verifier vente forcee si GP negatifs, puis continuer
    this.checkForcedSale(player, () => {
      // Verifier victoire (le joueur doit etre sur le depart)
      const netWorth = calculateNetWorth(player, this.board);
      if (netWorth >= this.gpGoal && player.position === this.startTileId) {
        this.victory(player);
        return;
      }

      // Joueur suivant
      this.nextPlayer();
    });
  }

  nextPlayer() {
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;

    // Nouveau tour si on revient au premier joueur
    if (this.currentPlayerIndex === 0) {
      this.turnNumber++;
    }

    const player = this.currentPlayer;

    // Verifier si le joueur est etourdi
    if (player.stunned) {
      player.stunned = false;
      this.log(`${player.name} est etourdi et passe son tour.`);
      this.nextPlayer();
      return;
    }

    this.phase = 'hand';
    this.activeHandEffect = null;
    this.log(`--- Tour de ${player.name} ---`);
    this.render();
    this.updateUI();

    // IA joue automatiquement
    if (!player.isHuman) {
      setTimeout(() => this.playAITurn(), 800);
    }
  }

  // === TOUR IA ===

  async playAITurn() {
    const player = this.currentPlayer;

    // Phase main : l'IA choisit une main a jouer
    const handChoice = AI.chooseHand(player, this.players, this.board);
    if (handChoice) {
      const consumed = selectCardsForHand(player.hand, handChoice.handDef);
      if (consumed) {
        for (const card of consumed) {
          removeCardFromHand(player, card.instanceId);
        }
        this.resolveHandEffect(player, handChoice.handDef, handChoice.targetId);
      }
    }

    await this.delay(500);

    // Phase lancer
    this.phase = 'roll';
    this.roll();
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // === VICTOIRE ===

  victory(player) {
    this.phase = 'gameOver';
    this.log(`${player.name} a gagne la partie !`, 'important');

    if (this.onVictory) {
      const scores = this.players
        .map(p => ({ name: p.name, netWorth: calculateNetWorth(p, this.board), gp: p.gp }))
        .sort((a, b) => b.netWorth - a.netWorth);
      this.onVictory(player, scores);
    }
  }

  // === UI HELPERS ===

  showTileAction(actionType, tile, player) {
    if (this.onShowOverlay) {
      this.onShowOverlay(actionType, tile, player, this.board);
    }
  }

  showEventResult(message, callback) {
    if (this.onShowOverlay) {
      this.onShowOverlay('event', { message }, this.currentPlayer, this.board, callback);
    }
  }

  render() {
    if (this.renderer) {
      this.renderer.render(this.boardData, this.players, this.currentPlayer?.id, this.animState, this.prizeCubes, this.honeyPots);
    }
  }

  updateUI() {
    if (this.onUpdate) {
      this.onUpdate(this);
    }
  }

  log(message, type = '') {
    if (this.onLog) {
      this.onLog(message, type);
    }
  }
}
