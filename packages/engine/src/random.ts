/**
 * Seeded pseudo-random numbers (mulberry32). The engine never uses Math.random, so every
 * relaxation is reproducible for a given seed.
 */

/** Returns a function yielding floats in [0, 1), fully determined by `seed`. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
