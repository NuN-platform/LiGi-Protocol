import { mixSeed, mulberry32 } from "./rng";
import { robustSolitonCdf, sampleDegree } from "./soliton";

export function xorInto(target: Uint8Array, other: Uint8Array) {
  const n = Math.min(target.length, other.length);
  for (let i = 0; i < n; i++) target[i] ^= other[i];
}

export function scheduleLength(k: number): number {
  return Math.max(k + 6, Math.ceil(k * 2.1));
}

export type EncodedSymbol = {
  sequence: number;
  neighbors: number[];
  data: Uint8Array;
};

/** First k sequences are the source blocks. Later sequences are robust-soliton combinations. */
export function neighborsFor(k: number, sequence: number, seed: Uint8Array, cdf = robustSolitonCdf(k)): number[] {
  if (sequence < k) return [sequence];
  const rng = mulberry32(mixSeed(seed, sequence));
  const degree = Math.min(k, Math.max(1, sampleDegree(cdf, rng)));
  const pool = Array.from({ length: k }, (_, i) => i);
  for (let i = 0; i < degree; i++) {
    const j = i + Math.floor(rng() * (k - i));
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool.slice(0, degree).sort((a, b) => a - b);
}

export function encodeSymbol(sources: Uint8Array[], sequence: number, seed: Uint8Array, cdf?: number[]): EncodedSymbol {
  const k = sources.length;
  const neighbors = neighborsFor(k, sequence, seed, cdf);
  const data = new Uint8Array(sources[0]?.length ?? 0);
  for (const index of neighbors) xorInto(data, sources[index]);
  return { sequence, neighbors, data };
}

export function splitSources(payload: Uint8Array, symbolSize: number): Uint8Array[] {
  const k = Math.max(1, Math.ceil(payload.length / symbolSize));
  const sources: Uint8Array[] = [];
  for (let i = 0; i < k; i++) {
    const block = new Uint8Array(symbolSize);
    const slice = payload.subarray(i * symbolSize, (i + 1) * symbolSize);
    block.set(slice);
    sources.push(block);
  }
  return sources;
}

type Row = { coeff: Uint8Array; data: Uint8Array };

function peel(k: number, symbols: EncodedSymbol[], symbolSize: number): Uint8Array[] | null {
  const edges = symbols.map((symbol) => new Set(symbol.neighbors));
  const data = symbols.map((symbol) => symbol.data.slice());
  const recovered: (Uint8Array | null)[] = Array.from({ length: k }, () => null);
  const queue: number[] = [];
  for (let i = 0; i < symbols.length; i++) {
    if (edges[i].size === 1) queue.push(i);
  }
  const used = new Set<number>();
  while (queue.length) {
    const row = queue.pop()!;
    if (used.has(row) || edges[row].size !== 1) continue;
    const src = edges[row].values().next().value as number;
    if (recovered[src]) {
      used.add(row);
      continue;
    }
    recovered[src] = data[row].slice(0, symbolSize);
    used.add(row);
    for (let j = 0; j < symbols.length; j++) {
      if (used.has(j) || !edges[j].has(src)) continue;
      xorInto(data[j], recovered[src]!);
      edges[j].delete(src);
      if (edges[j].size === 1) queue.push(j);
    }
  }
  if (recovered.some((block) => block === null)) return null;
  return recovered as Uint8Array[];
}

function gaussian(k: number, symbols: EncodedSymbol[], symbolSize: number): Uint8Array[] | null {
  const rows: Row[] = symbols.map((symbol) => {
    const coeff = new Uint8Array(k);
    for (const index of symbol.neighbors) {
      if (index >= 0 && index < k) coeff[index] = 1;
    }
    return { coeff, data: symbol.data.slice() };
  });
  const pivotOf = new Array<number>(k).fill(-1);
  let row = 0;
  for (let col = 0; col < k && row < rows.length; col++) {
    let selected = -1;
    for (let i = row; i < rows.length; i++) {
      if (rows[i].coeff[col] === 1) {
        selected = i;
        break;
      }
    }
    if (selected < 0) continue;
    if (selected !== row) {
      const swap = rows[row];
      rows[row] = rows[selected];
      rows[selected] = swap;
    }
    for (let i = row + 1; i < rows.length; i++) {
      if (rows[i].coeff[col] !== 1) continue;
      for (let j = col; j < k; j++) rows[i].coeff[j] ^= rows[row].coeff[j];
      xorInto(rows[i].data, rows[row].data);
    }
    pivotOf[col] = row;
    row++;
  }
  if (pivotOf.some((pivot) => pivot < 0)) return null;

  const sources: Uint8Array[] = Array.from({ length: k }, () => new Uint8Array(symbolSize));
  for (let col = k - 1; col >= 0; col--) {
    const pivot = pivotOf[col];
    const data = rows[pivot].data.slice();
    for (let j = col + 1; j < k; j++) {
      if (rows[pivot].coeff[j] === 1) xorInto(data, sources[j]);
    }
    sources[col] = data.subarray(0, symbolSize);
  }
  return sources;
}

export function decodeSymbols(k: number, symbols: EncodedSymbol[], symbolSize: number): Uint8Array | null {
  if (symbols.length < k) return null;
  const sources = peel(k, symbols, symbolSize) ?? gaussian(k, symbols, symbolSize);
  if (!sources) return null;
  const payload = new Uint8Array(k * symbolSize);
  sources.forEach((block, index) => payload.set(block.subarray(0, symbolSize), index * symbolSize));
  return payload;
}
