import { sha3_256, sha3_512 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/**
 * Same signature construction as core/ligi_v5_optical.py in bis3946/melek-core.
 * The phone ALS is not available in the browser, so lux comes from the operator.
 * Python inserts a floating time.time() into the entropy string; this lab uses
 * whole seconds so the result can be recomputed.
 */
export type PhotonicHandshake = {
  vertexId: string;
  timestamp: number;
  hardwareAnchor: string;
  lux: number;
  source: string;
  state: string;
  quantumWeight: number;
  action: string;
  signature: string;
  entropy: string;
};

function pyNumber(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

export function photonicHandshake(lux: number, timestampSec: number): PhotonicHandshake {
  const clamped = Math.max(0, lux);
  const active = clamped > 0;
  const quantumWeight = active ? Math.round((1 + Math.min(clamped, 100000) * 0.00005) * 1e6) / 1e6 : 0.62;
  const state = active ? "ACTIVE_PHOTONIC_HANDSHAKE" : "HARDWARE_DARK_HANDSHAKE";
  const source = active ? "dashboard:operator" : "dashboard:dark";
  const entropy = `${timestampSec}_${pyNumber(clamped)}_${pyNumber(quantumWeight)}_CRYSTALS-Kyber-1024_${source}`;
  const pqc = sha3_512(new TextEncoder().encode(entropy));
  const vertex = sha3_256(pqc);
  return {
    vertexId: bytesToHex(vertex),
    timestamp: timestampSec,
    hardwareAnchor: "DASHBOARD_SENSOR",
    lux: clamped,
    source,
    state,
    quantumWeight,
    action: "NUN_DAG_SYNCHRONIZATION",
    signature: `VSha-3946_LIGI_v5.2_OPTICAL_${bytesToHex(pqc).slice(0, 16)}`,
    entropy,
  };
}
