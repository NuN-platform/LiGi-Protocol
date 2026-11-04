import { lockPanel, readCells, renderPanel, type Geometry, type Panel } from "./frame";

/** How far a camera or a compressed video may drift from the painted cell color. */
export const OPTICAL_COLOR_SLACK = 48;

export function normalizeSeen(
  panel: Panel,
  hint: Geometry,
  colorSlack = OPTICAL_COLOR_SLACK,
): { ok: true; panel: Panel; sequence: number } | { ok: false; reason: string } {
  const locked = lockPanel(panel, hint, colorSlack);
  if (!locked.ok) return locked;
  const read = readCells(locked.cells);
  if (!read.ok) return { ok: false, reason: read.reason };
  return {
    ok: true,
    panel: renderPanel(locked.cells, hint.cellPx, hint.gap),
    sequence: read.frame.sequence,
  };
}
