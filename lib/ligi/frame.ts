import { HEADER_BYTES, readHeader, type FrameHeader } from "./header";
import { mixSeed, mulberry32 } from "./rng";

export const COLS = 32;
export const ROWS = 16;
export const CELL_PX = 18;
export const CELL_GAP = 4;
export const FINDER_BYTE = 0xa7;

const FINDERS = new Set<number>();
for (const [col, row] of [
  [0, 0],
  [COLS - 2, 0],
  [0, ROWS - 2],
  [COLS - 2, ROWS - 2],
] as const) {
  for (const dc of [0, 1]) {
    for (const dr of [0, 1]) FINDERS.add((row + dr) * COLS + (col + dc));
  }
}

export function dataSlots(): number[] {
  const slots: number[] = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    if (!FINDERS.has(i)) slots.push(i);
  }
  return slots;
}

const STABLE_SLOTS = dataSlots();

function permutedTail(seed: Uint8Array, sequence: number): number[] {
  const tail = STABLE_SLOTS.slice(HEADER_BYTES);
  const rng = mulberry32(mixSeed(seed, sequence ^ 0x51f00d));
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = tail[i];
    tail[i] = tail[j];
    tail[j] = swap;
  }
  return tail;
}

export function byteColor(value: number, index: number): [number, number, number] {
  return [value & 255, (value * 13 + 90 + (index & 15)) & 255, (value * 47 + index + 20) & 255];
}

export type CapturedFrame = FrameHeader & { symbol: Uint8Array };

export function paintCells(header: Uint8Array, symbol: Uint8Array, seed: Uint8Array, sequence: number): Uint8Array {
  const cells = new Uint8Array(COLS * ROWS);
  for (const finder of FINDERS) cells[finder] = FINDER_BYTE;
  const body = new Uint8Array(header.length + symbol.length);
  body.set(header, 0);
  body.set(symbol, header.length);
  let checksum = 0;
  for (const value of body) checksum ^= value;
  for (let i = 0; i < HEADER_BYTES; i++) cells[STABLE_SLOTS[i]] = header[i];
  const tail = permutedTail(seed, sequence);
  for (let i = 0; i < tail.length; i++) {
    if (i < symbol.length) cells[tail[i]] = symbol[i];
    else cells[tail[i]] = (body[i % body.length] ^ checksum ^ (i & 255)) & 255;
  }
  return cells;
}

export function readCells(cells: Uint8Array): { ok: true; frame: CapturedFrame } | { ok: false; reason: string } {
  if (cells.length !== COLS * ROWS) return { ok: false, reason: "The panel is the wrong size." };
  for (const finder of FINDERS) {
    if (cells[finder] !== FINDER_BYTE) return { ok: false, reason: "Finder corners are not a LiGi gate." };
  }
  const headerBytes = new Uint8Array(HEADER_BYTES);
  for (let i = 0; i < HEADER_BYTES; i++) headerBytes[i] = cells[STABLE_SLOTS[i]];
  const header = readHeader(headerBytes);
  if ("error" in header) return { ok: false, reason: header.error };

  const tail = permutedTail(header.sessionId, header.sequence);
  if (header.symbolSize > tail.length) return { ok: false, reason: "Symbol does not fit the panel." };
  const symbol = new Uint8Array(header.symbolSize);
  for (let i = 0; i < symbol.length; i++) symbol[i] = cells[tail[i]];

  const body = new Uint8Array(HEADER_BYTES + symbol.length);
  body.set(headerBytes, 0);
  body.set(symbol, HEADER_BYTES);
  let checksum = 0;
  for (const value of body) checksum ^= value;
  for (let i = symbol.length; i < tail.length; i++) {
    const expected = (body[i % body.length] ^ checksum ^ (i & 255)) & 255;
    if (cells[tail[i]] !== expected) return { ok: false, reason: "A cell failed the frame check. Occlusion or a bad read." };
  }
  return { ok: true, frame: { ...header, symbol } };
}

export type Panel = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
};

export function renderPanel(cells: Uint8Array, cellPx = CELL_PX, gap = CELL_GAP): Panel {
  const width = COLS * cellPx + (COLS - 1) * gap;
  const height = ROWS * cellPx + (ROWS - 1) * gap;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = 12;
    rgba[i * 4 + 1] = 14;
    rgba[i * 4 + 2] = 10;
    rgba[i * 4 + 3] = 255;
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      const [r, g, b] = byteColor(cells[index], index);
      const x0 = col * (cellPx + gap);
      const y0 = row * (cellPx + gap);
      for (let y = 0; y < cellPx; y++) {
        for (let x = 0; x < cellPx; x++) {
          const p = ((y0 + y) * width + (x0 + x)) * 4;
          rgba[p] = r;
          rgba[p + 1] = g;
          rgba[p + 2] = b;
          rgba[p + 3] = 255;
        }
      }
    }
  }
  return { rgba, width, height };
}

export type Geometry = {
  cellPx: number;
  gap: number;
  stride: number;
};

export function gapFor(cellPx: number): number {
  return cellPx >= 16 ? CELL_GAP : 2;
}

export function panelSize(cellPx: number, gap: number): { width: number; height: number } {
  return {
    width: COLS * cellPx + (COLS - 1) * gap,
    height: ROWS * cellPx + (ROWS - 1) * gap,
  };
}

function pixelAt(panel: Panel, x: number, y: number): [number, number, number] | null {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= panel.width || yi >= panel.height) return null;
  const src = (yi * panel.width + xi) * 4;
  return [panel.rgba[src], panel.rgba[src + 1], panel.rgba[src + 2]];
}

function readCellColor(panel: Panel, cx: number, cy: number, cellPx: number, stride: number): [number, number, number] {
  const points: [number, number][] = [[cx, cy]];
  if (stride > 1 && stride < cellPx) {
    const reach = Math.min(stride, (cellPx >> 1) - 1);
    if (reach > 0) points.push([cx - reach, cy], [cx + reach, cy], [cx, cy - reach], [cx, cy + reach]);
  }
  const votes = new Map<string, { n: number; rgb: [number, number, number] }>();
  for (const [x, y] of points) {
    const rgb = pixelAt(panel, x, y);
    if (!rgb) continue;
    const key = rgb.join(",");
    const vote = votes.get(key);
    if (vote) vote.n += 1;
    else votes.set(key, { n: 1, rgb });
  }
  let best: { n: number; rgb: [number, number, number] } | null = null;
  for (const vote of votes.values()) {
    if (!best || vote.n > best.n) best = vote;
  }
  return best ? best.rgb : [1, 2, 3];
}

export function samplePanel(
  panel: Panel,
  cellPx = CELL_PX,
  gap = CELL_GAP,
  originX = 0,
  originY = 0,
  stride = 1,
): Uint8ClampedArray {
  const samples = new Uint8ClampedArray(COLS * ROWS * 4);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx = originX + col * (cellPx + gap) + (cellPx >> 1);
      const cy = originY + row * (cellPx + gap) + (cellPx >> 1);
      const [r, g, b] = readCellColor(panel, cx, cy, cellPx, stride);
      const dst = (row * COLS + col) * 4;
      samples[dst] = r;
      samples[dst + 1] = g;
      samples[dst + 2] = b;
      samples[dst + 3] = 255;
    }
  }
  return samples;
}

const PITCH_FACTORS = [1, 1 / 1.08, 1.08, 0.92, 1 / 0.92];

export function cornerLineFit(
  anchor: { x: number; y: number },
  across: { x: number; y: number },
  down: { x: number; y: number },
  tolerance: number,
): string | null {
  if (Math.abs(anchor.y - across.y) > tolerance) return "Line-fit rejected the top edge.";
  if (Math.abs(anchor.x - down.x) > tolerance) return "Line-fit rejected the left edge.";
  return null;
}

function colorNear(r: number, g: number, b: number, er: number, eg: number, eb: number, colorSlack: number): boolean {
  const dr = r - er;
  const dg = g - eg;
  const db = b - eb;
  if (colorSlack <= 0) return dr === 0 && dg === 0 && db === 0;
  return dr * dr + dg * dg + db * db <= colorSlack * colorSlack;
}

export function nearestByte(r: number, g: number, b: number, index: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let value = 0; value < 256; value++) {
    const [er, eg, eb] = byteColor(value, index);
    const dr = r - er;
    const dg = g - eg;
    const db = b - eb;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = value;
    }
  }
  return best;
}

function finderCenter(panel: Panel, col: number, row: number, cellPx: number, colorSlack = 0): { x: number; y: number } | null {
  const index = row * COLS + col;
  const [r, g, b] = byteColor(FINDER_BYTE, index);
  const hits: { x: number; y: number }[] = [];
  for (let y = 0; y < panel.height; y++) {
    for (let x = 0; x < panel.width; x++) {
      const p = (y * panel.width + x) * 4;
      if (colorNear(panel.rgba[p], panel.rgba[p + 1], panel.rgba[p + 2], r, g, b, colorSlack)) hits.push({ x, y });
    }
  }
  if (hits.length < 4) return null;
  const xs = hits.map((hit) => hit.x);
  const ys = hits.map((hit) => hit.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  let chosen = hits;
  if (span > cellPx * 3) {
    const preferLeft = col < COLS / 2;
    const preferTop = row < ROWS / 2;
    let seed = hits[0];
    for (const hit of hits) {
      const closerX = preferLeft ? hit.x < seed.x : hit.x > seed.x;
      const closerY = preferTop ? hit.y < seed.y : hit.y > seed.y;
      if (closerX || closerY) {
        const seedScore = (preferLeft ? -seed.x : seed.x) + (preferTop ? -seed.y : seed.y);
        const hitScore = (preferLeft ? -hit.x : hit.x) + (preferTop ? -hit.y : hit.y);
        if (hitScore > seedScore) seed = hit;
      }
    }
    const reach = cellPx * 2;
    chosen = hits.filter((hit) => Math.abs(hit.x - seed.x) <= reach && Math.abs(hit.y - seed.y) <= reach);
  }
  if (chosen.length < 4) return null;
  const x = chosen.reduce((sum, hit) => sum + hit.x, 0) / chosen.length + 0.5;
  const y = chosen.reduce((sum, hit) => sum + hit.y, 0) / chosen.length + 0.5;
  return { x, y };
}

export type LockResult = { ok: true; cells: Uint8Array; factor: number } | { ok: false; reason: string };

function cellsFromSamples(
  samples: Uint8ClampedArray,
  colorSlack: number,
): { ok: true; cells: Uint8Array } | { ok: false; reason: string } {
  if (colorSlack <= 0) return rgbaToCells(samples);
  if (samples.length !== COLS * ROWS * 4) return { ok: false, reason: "Sampled panel has the wrong number of cells." };
  const cells = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < cells.length; i++) cells[i] = nearestByte(samples[i * 4], samples[i * 4 + 1], samples[i * 4 + 2], i);
  return { ok: true, cells };
}

/** Lock a gate inside a larger frame: finder centroids, edge line-fit, aspect, then pitch factors. */
export function lockPanel(panel: Panel, hint: Geometry, colorSlack = 0): LockResult {
  const size = panelSize(hint.cellPx, hint.gap);
  if (panel.width === size.width && panel.height === size.height) {
    const sampled = samplePanel(panel, hint.cellPx, hint.gap, 0, 0, hint.stride);
    const cells = cellsFromSamples(sampled, colorSlack);
    if (!cells.ok) return cells;
    return { ok: true, cells: cells.cells, factor: 1 };
  }

  const anchor = finderCenter(panel, 0, 0, hint.cellPx, colorSlack);
  const across = finderCenter(panel, COLS - 2, 0, hint.cellPx, colorSlack);
  const down = finderCenter(panel, 0, ROWS - 2, hint.cellPx, colorSlack);
  if (!anchor || !across || !down) return { ok: false, reason: "No lock. Finder corners were not in the frame." };

  const tolerance = Math.max(2, hint.cellPx * 0.35);
  const line = cornerLineFit(anchor, across, down, tolerance);
  if (line) return { ok: false, reason: line };

  const pitchX = (across.x - anchor.x) / (COLS - 2);
  const pitchY = (down.y - anchor.y) / (ROWS - 2);
  if (pitchX < 4 || pitchY < 4) return { ok: false, reason: "No lock. Finder spacing is too small." };
  const aspect = pitchX / pitchY;
  if (aspect < 0.92 || aspect > 1.08) return { ok: false, reason: "Aspect check failed. The fitted gate is stretched." };

  let last = "No lock. Border search did not find a LiGi gate.";
  for (const factor of PITCH_FACTORS) {
    const pitch = ((pitchX + pitchY) / 2) * factor;
    const gap = Math.max(1, Math.round((hint.gap / (hint.cellPx + hint.gap)) * pitch));
    const cellPx = Math.max(2, Math.round(pitch - gap));
    const originX = anchor.x - cellPx / 2;
    const originY = anchor.y - cellPx / 2;
    for (const dx of [0, -1, 1, -2, 2]) {
      for (const dy of [0, -1, 1, -2, 2]) {
        const sampled = samplePanel(panel, cellPx, gap, originX + dx, originY + dy, hint.stride);
        const cells = cellsFromSamples(sampled, colorSlack);
        if (!cells.ok) {
          last = cells.reason;
          continue;
        }
        const read = readCells(cells.cells);
        if (read.ok) return { ok: true, cells: cells.cells, factor };
        last = read.reason;
      }
    }
  }
  return { ok: false, reason: last };
}

export function rgbaToCells(samples: Uint8ClampedArray): { ok: true; cells: Uint8Array } | { ok: false; reason: string } {
  if (samples.length !== COLS * ROWS * 4) return { ok: false, reason: "Sampled panel has the wrong number of cells." };
  const cells = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < cells.length; i++) {
    const r = samples[i * 4];
    const g = samples[i * 4 + 1];
    const b = samples[i * 4 + 2];
    const [er, eg, eb] = byteColor(r, i);
    if (g !== eg || b !== eb || r !== er) return { ok: false, reason: "A cell color failed its check." };
    cells[i] = r;
  }
  return { ok: true, cells };
}

/** Cover a horizontal band, the way a finger or a glare stripe hides rows. */
export function occludePanel(panel: Panel, fraction: number, rng: () => number): Panel {
  if (fraction <= 0) return panel;
  const rgba = new Uint8ClampedArray(panel.rgba);
  const band = Math.max(1, Math.round(panel.height * Math.min(1, fraction)));
  const start = Math.floor(rng() * Math.max(1, panel.height - band + 1));
  for (let y = start; y < start + band && y < panel.height; y++) {
    for (let x = 0; x < panel.width; x++) {
      const p = (y * panel.width + x) * 4;
      rgba[p] = 0;
      rgba[p + 1] = 0;
      rgba[p + 2] = 0;
      rgba[p + 3] = 255;
    }
  }
  return { rgba, width: panel.width, height: panel.height };
}

export function restCells(tick: number): Uint8Array {
  const cells = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < cells.length; i++) {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const wave = Math.sin(tick / 18 + col * 0.35 + row * 0.2);
    cells[i] = wave > 0.72 ? 0xe6 : 0x10;
  }
  return cells;
}
