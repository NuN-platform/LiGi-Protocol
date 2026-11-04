/** Deterministic PRNG shared by the encoder and every sensor. */
export function mixSeed(seed: Uint8Array, seq: number): number {
  let h = seq >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed[i];
    h = Math.imul(h, 0x9e3779b1);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
