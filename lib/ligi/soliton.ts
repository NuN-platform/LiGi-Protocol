/**
 * Robust soliton degree distribution (Luby, 2002).
 * Returns a CDF indexed by degree. cdf[0] is unused.
 */
export function robustSolitonCdf(k: number, c = 0.08, delta = 0.05): number[] {
  if (k < 1) throw new Error("k must be at least 1");
  if (k === 1) return [0, 1];

  const pdf = new Float64Array(k + 1);
  pdf[1] = 1 / k;
  for (let i = 2; i <= k; i++) pdf[i] = 1 / (i * (i - 1));

  const R = c * Math.log(k / delta) * Math.sqrt(k);
  if (R > delta) {
    const limit = Math.min(k, Math.max(1, Math.floor(k / R)));
    for (let i = 1; i < limit; i++) pdf[i] += R / (i * k);
    pdf[limit] += (R * Math.log(R / delta)) / k;
  }

  let sum = 0;
  for (let i = 1; i <= k; i++) {
    if (pdf[i] < 0) pdf[i] = 0;
    sum += pdf[i];
  }
  if (sum <= 0) return Array.from({ length: k + 1 }, (_, i) => (i === 0 ? 0 : 1));

  const cdf = new Array<number>(k + 1).fill(0);
  let acc = 0;
  for (let i = 1; i <= k; i++) {
    acc += pdf[i] / sum;
    cdf[i] = acc;
  }
  cdf[k] = 1;
  return cdf;
}

export function sampleDegree(cdf: number[], rng: () => number): number {
  const u = rng();
  for (let i = 1; i < cdf.length; i++) {
    if (u <= cdf[i]) return i;
  }
  return Math.max(1, cdf.length - 1);
}
