// Generateur pseudo-aleatoire a graine (mulberry32).
// Tout le hasard du moteur passe par lui : une meme graine et les memes choix
// redonnent exactement la meme partie (tests, simulation, sauvegarde, replays).

export function createRng(seed = 1) {
  let s = seed >>> 0;

  const rng = {
    // Nombre dans [0, 1)
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    // Entier dans [0, n)
    int(n) {
      return Math.floor(rng.next() * n);
    },
    // Vrai avec une probabilite p
    chance(p) {
      return rng.next() < p;
    },
    pick(arr) {
      return arr[rng.int(arr.length)];
    },
    // Copie melangee (Fisher-Yates)
    shuffle(arr) {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    getState() {
      return s;
    },
    setState(v) {
      s = v >>> 0;
    },
  };
  return rng;
}

// Graine tiree au hasard pour une nouvelle partie
export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}
