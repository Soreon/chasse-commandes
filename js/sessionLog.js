// Versant technique du journal de partie, dans le navigateur.
//
// Le moteur note déjà tout le déroulé du jeu dans `game.journal`. Ici on y ajoute ce qui permet
// de comprendre un problème technique après coup :
//   env         navigateur, écran, carte graphique, réglages
//   ui          actions sur l'interface (pause, vitesse, caméra, retour au menu…)
//   perf        fluidité relevée toutes les 10 secondes (images par seconde, pire image, charge 3D)
//   slowFrame   image anormalement longue (l'affichage s'est figé)
//   visibility  onglet masqué ou revenu au premier plan (explique les pauses)
//   error       erreur JavaScript, promesse rejetée, contexte 3D perdu, erreur de la boucle de jeu
//   save        sauvegarde du journal (taille), ou impossibilité de le sauvegarder
// Le journal est horodaté, conservé dans le navigateur à chaque tour, et téléchargeable.

const STORAGE_KEY = 'chasseCommandes.journal';
const PERF_INTERVAL_MS = 10000;
const SLOW_FRAME_MS = 400;
const MAX_SLOW_FRAMES = 200;

function describeGraphics() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return 'WebGL indisponible';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return 'inconnu';
  }
}

export class SessionLog {
  // getRenderInfo : fonction facultative donnant la charge de la vue 3D ({ calls, triangles })
  constructor(game, { settings = {}, getRenderInfo = null } = {}) {
    this.journal = game.journal;
    this.getRenderInfo = getRenderInfo;
    this.storageBroken = false;
    this.slowFrames = 0;
    this._disposed = false;

    const origin = performance.now();
    this.journal.clock = () => Math.round(performance.now() - origin);
    this.journal.meta.startedAt = new Date().toISOString();

    this.journal.add('env', {
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
      screen: { width: window.screen.width, height: window.screen.height },
      graphics: describeGraphics(),
      cores: navigator.hardwareConcurrency || null,
      settings,
      url: `${window.location.origin}${window.location.pathname}`,
    });

    // Écouteurs globaux, retirés à la fin de la partie
    this._listeners = new AbortController();
    const signal = this._listeners.signal;
    window.addEventListener('error', (e) => {
      this.error('javascript', e.message, { file: e.filename, line: e.lineno, column: e.colno, stack: e.error?.stack });
    }, { signal });
    window.addEventListener('unhandledrejection', (e) => {
      this.error('promesse', e.reason?.message || String(e.reason), { stack: e.reason?.stack });
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      this.journal.add('visibility', { state: document.visibilityState });
    }, { signal });
    window.addEventListener('resize', () => {
      this.journal.add('ui', { action: 'fenêtre redimensionnée', width: window.innerWidth, height: window.innerHeight });
    }, { signal });

    this._startPerfSampling();
  }

  // Action du joueur sur l'interface
  ui(action, data = {}) {
    if (this._disposed) return;
    this.journal.add('ui', { action, ...data });
  }

  error(kind, message, details = {}) {
    // Après la fin de la partie, on ne note plus rien (la fermeture de la vue 3D, par exemple,
    // fait perdre son contexte graphique : ce n'est pas une erreur)
    if (this._disposed) return;
    this.journal.add('error', { kind, message, ...details });
    this.persist();
  }

  // Compte les images affichées et relève régulièrement la fluidité
  _startPerfSampling() {
    let frames = 0;
    let worst = 0;
    let last = performance.now();
    let windowStart = last;

    const frame = (now) => {
      if (this._disposed) return;
      const gap = now - last;
      last = now;
      frames++;
      if (gap > worst) worst = gap;
      // Une image très longue alors que l'onglet est visible : l'affichage s'est figé
      if (gap > SLOW_FRAME_MS && document.visibilityState === 'visible' && this.slowFrames < MAX_SLOW_FRAMES) {
        this.slowFrames++;
        this.journal.add('slowFrame', { ms: Math.round(gap) });
      }
      if (now - windowStart >= PERF_INTERVAL_MS) {
        const seconds = (now - windowStart) / 1000;
        const render = this.getRenderInfo ? this.getRenderInfo() : null;
        this.journal.add('perf', {
          fps: Math.round((frames / seconds) * 10) / 10,
          worstFrameMs: Math.round(worst),
          visible: document.visibilityState === 'visible',
          ...(render || {}),
          memoryMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        });
        frames = 0;
        worst = 0;
        windowStart = now;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Conserve le journal dans le navigateur (appelé à chaque début de tour et à chaque erreur)
  persist() {
    if (this.storageBroken) return;
    try {
      const text = JSON.stringify(this.journal);
      localStorage.setItem(STORAGE_KEY, text);
      this.lastSavedBytes = text.length;
    } catch (e) {
      // Stockage plein ou indisponible : le journal reste en mémoire et téléchargeable
      this.storageBroken = true;
      this.journal.add('save', { ok: false, message: e.message });
    }
  }

  fileName() {
    const setup = this.journal.meta.setup || {};
    const stamp = (this.journal.meta.startedAt || new Date().toISOString()).slice(0, 19).replace(/[:T]/g, '-');
    return `journal-${(setup.boardName || 'partie').toLowerCase()}-${stamp}.json`;
  }

  download() {
    this.ui('journal téléchargé');
    downloadText(JSON.stringify(this.journal, null, 1), this.fileName());
  }

  dispose() {
    this.persist();
    this._disposed = true;
    this._listeners.abort();
  }
}

function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Journal de la dernière partie conservé dans le navigateur
export function hasStoredJournal() {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

export function downloadStoredJournal() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return false;
    const data = JSON.parse(text);
    const stamp = (data.meta?.startedAt || '').slice(0, 19).replace(/[:T]/g, '-') || 'derniere-partie';
    downloadText(JSON.stringify(data, null, 1), `journal-${(data.meta?.setup?.boardName || 'partie').toLowerCase()}-${stamp}.json`);
    return true;
  } catch {
    return false;
  }
}
