export type CellProfile = {
  id: string;
  label: string;
  cellPx: number;
  fps: number;
  stride: number;
  note: string;
};

export const cellProfiles: CellProfile[] = [
  {
    id: "lab",
    label: "Lab 18",
    cellPx: 18,
    fps: 8,
    stride: 1,
    note: "Browser default. One sample at the center of each cell.",
  },
  {
    id: "c24",
    label: "c24",
    cellPx: 24,
    fps: 5,
    stride: 6,
    note: "SN2 ladder, 26 Oct 2026. The first c24 attempt aborted on TCP/ufw before any frame.",
  },
  {
    id: "c12",
    label: "c12",
    cellPx: 12,
    fps: 5,
    stride: 6,
    note: "Failed twice on the old decoder. c12k passed 26 Oct 2026 at 22:55 after c12fix2.",
  },
  {
    id: "c10",
    label: "c10",
    cellPx: 10,
    fps: 5,
    stride: 6,
    note: "Passed 27 Oct 2026 at 02:42 Europe/Zagreb.",
  },
  {
    id: "c8",
    label: "c8",
    cellPx: 8,
    fps: 5,
    stride: 6,
    note: "Newest real optical pass. 27 Oct 2026 at 02:49 Europe/Zagreb. ML-KEM, HMAC ACK, 40.8 s.",
  },
];

export type BenchRun = {
  when: string;
  name: string;
  result: string;
  detail: string;
};

export const benchRuns: BenchRun[] = [
  {
    when: "27 Oct 2026, 05:17",
    name: "Staging suite",
    result: "95 pass",
    detail: "STEP6_STAGING_TESTS.md. Fixed dev decoder, 283.4 s. The flaky heavy-loss ACK test passed that run.",
  },
  {
    when: "27 Oct 2026, 04:40",
    name: "test_pipeline.py",
    result: "70 pass",
    detail: "step5_pytest.log, 246.19 s. The no-pqcrypto error now expects the word virtualenv.",
  },
  {
    when: "27 Oct 2026, 02:49",
    name: "Optical c8",
    result: "Pass",
    detail: "net-send_KEM_REAL_c8_0249.log. Cell 8, 5 fps, stride 6, one frame, HMAC ACK, SHA-256 match, 40.8 s.",
  },
  {
    when: "27 Oct 2026, 02:42",
    name: "Optical c10",
    result: "Pass",
    detail: "Same night, before c8. ML-KEM optical ciphertext.",
  },
  {
    when: "26 Oct 2026, 22:55",
    name: "Optical c12k",
    result: "Pass",
    detail: "Decoder c12fix2: border-search factor fallback, aspect check, line-fit corners, stride 6.",
  },
  {
    when: "26 Oct 2026, 22:48",
    name: "pytest c12fix2",
    result: "95 pass",
    detail: "Up from 91 on 24 Oct. Adds KEM rendezvous without a preshared key, and a network ciphertext fallback.",
  },
  {
    when: "26 Oct 2026, 20:35",
    name: "ML-KEM self-test",
    result: "100/100",
    detail: "mlkem/selftest.py. SN2 and SN0 matched, and the cross-device shared-secret hash was equal.",
  },
  {
    when: "23 Oct 2026, 17:20",
    name: "Video harness",
    result: "Simulated",
    detail: "ligi_harness_video-full. Loopback only. Not re-run after the real cell ladder.",
  },
];
