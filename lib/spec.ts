export const sources = [
  {
    kind: "Drive",
    title: "LiGi Protocol Whitepaper v2",
    detail: "Ambient photonic gates, Luby transform outer layer, 24-byte frame header, and the 150–400 KB/s design target. Edited 4 Aug 2026, 13:22 Europe/Zagreb.",
    href: "https://docs.google.com/document/d/14-tI5DBEOf-gKf8oSp9fwk5bHj4ABvGG-BTp3b4Q0OI/edit",
  },
  {
    kind: "Drive",
    title: "Doctoral dissertation, LiGi protocol",
    detail: "Geometric modulation, triadic state language, and Kyber-1024 as the named payload cipher. Edited 4 Nov 2026, 16:50 Europe/Zagreb.",
    href: "https://docs.google.com/document/d/1jSl03Ss84tQBWo6pg3uvYFQMoizIM2DXlde2skfpwSE/edit",
  },
  {
    kind: "Drive",
    title: "Geometric optical key exchange",
    detail: "Five frequency rows the author stored as the exchange table, from 430 THz through 700 THz.",
    href: "https://docs.google.com/document/d/17xz7gB9hKOmCmZtEYy3auFQ6BykKDMWpmRjx5zRoC88/edit",
  },
  {
    kind: "Drive",
    title: "L0 sync script",
    detail: "Replaces the old 77 K cryogenic check with ambient operation at 298.15 K on the author's phone node.",
    href: "https://docs.google.com/document/d/1DWDa4L-eVvN7gjhVXGS_jjsCI5PrYF2epCC8A0IcmcY/edit",
  },
  {
    kind: "GitHub",
    title: "bis3946/melek-core",
    detail: "Optical handshake in core/ligi_v5_optical.py. Lux in, SHA3-512 signature out, labeled VSha-3946.",
    href: "https://github.com/bis3946/melek-core",
  },
  {
    kind: "GitHub",
    title: "bis3946/Nun-root",
    detail: "Healing-hold policy in docs/LIGI_PLANETARY_HEALING.md. While a heal is open, LiGi transmission stays paused.",
    href: "https://github.com/bis3946/Nun-root",
  },
  {
    kind: "GitHub",
    title: "bis3946/nun-sovereign-test-v8.0.3",
    detail: "UDP gateway sketch on port 3946 with a 30 ms prune window. This dashboard does not bind that port.",
    href: "https://github.com/bis3946/nun-sovereign-test-v8.0.3",
  },
  {
    kind: "Web",
    title: "Public search, 4 Nov 2026",
    detail: "No independent LiGi standard turned up. Public hits were an unrelated token, a fitness app, and other people named Ligi.",
  },
  {
    kind: "SN2",
    title: "bis3946-pc test ladder, 27 Oct 2026",
    detail:
      "Newest files on the lab machine, read 4 Nov 2026 Europe/Zagreb. Optical c8 passed with ML-KEM, stride 6, and an HMAC ACK. Staging suite 95/95. Nothing newer than 27 Oct was on disk.",
  },
] as const;

export const keyExchange = [
  { frequencyThz: 430, hex: "0x0A", ising: 1 },
  { frequencyThz: 480, hex: "0x0B", ising: 1 },
  { frequencyThz: 550, hex: "0x0C", ising: 2 },
  { frequencyThz: 600, hex: "0x0D", ising: 3 },
  { frequencyThz: 700, hex: "0x0E", ising: 5 },
] as const;

export const specDocument = {
  name: "LiGi Protocol",
  version: "2.1 lab gate",
  author: "Bojan Petar Milanovic",
  account: "bis3946",
  summary:
    "LiGi v2 treats a display as a transmitter. Payload bytes become geometric cells, Luby symbols let a sensor miss frames, and a SHA-256 prefix closes the frame. The lab also runs the ML-KEM rendezvous that passed on bis3946-pc.",
  header: [
    { bytes: "0–7", field: "Session id", note: "Also the permutation seed and the passphrase salt." },
    { bytes: "8–11", field: "Sequence", note: "Below k the symbol is systematic. At k and above it is a fountain symbol." },
    { bytes: "12–13", field: "Symbol size", note: "Lab choices are 32 or 48 bytes." },
    { bytes: "14–15", field: "Block count k", note: "Source symbols in the payload." },
    { bytes: "16–19", field: "Payload length", note: "Low 30 bits. Bit 31 marks gzip. Bit 30 marks AES-256-GCM. Those two bits are lab flags." },
    { bytes: "20–23", field: "SHA-256 prefix", note: "First four bytes of the plaintext hash." },
  ],
  targets: {
    density: "Full-panel geometry rather than a QR-sized code.",
    loss: "Recovery with roughly 30–40% of frames missing.",
    throughput: "Whitepaper design target 150–400 KB/s at a 60–240 Hz panel. A browser gate is slower, and the lab shows the rate it actually measured.",
    payload: "This gate accepts 3,200 bytes so the decoder stays interactive.",
  },
  running: [
    "Systematic Luby transform over XOR, robust-soliton degrees after the first k frames.",
    "Session-and-sequence permutation of the symbol cells, with four fixed finder corners.",
    "Finder lock with an aspect check, a line fit on the top and left edges, and a pitch-factor fallback. That is the c12fix2 behavior from the 26 Oct optical runs.",
    "Stride sampling inside each cell. The c8 pass used stride 6 at 5 fps.",
    "SHA-256 of the plaintext, prefix in the header, then an HMAC-SHA256 ACK.",
    "Optional gzip when it shrinks the payload.",
    "Optional passphrase sealed with PBKDF2-SHA-256 and AES-256-GCM.",
    "ML-KEM-768 rendezvous. The ciphertext can ride in the optical payload, or fall back onto the local channel while the payload stays on the panel.",
    "Three sensors with independent loss, matching the rule-of-three receive pattern.",
    "Healing hold pauses the transmitter, following the Nun-root sequencing note.",
  ],
  recorded: [
    "The whitepaper names an AES-512 wrapper. AES-512 is not a NIST mode, and this gate does not implement it. Secrecy here is AES-256-GCM.",
    "SN2 logs confirm an ML-KEM optical ciphertext and a matching payload hash. They do not publish a KDF, so this gate uses the 32-byte ML-KEM-768 shared secret directly as the AES-256 key.",
    "The real c8 frame covered a camera-sized grid in one shot. This browser gate is 32 by 16 cells, so the same ciphertext takes several fountain frames.",
    "VSha-3946 in the GitHub handshake is SHA3-512, printed with that label. The lab uses that construction for the lux signature.",
    "The dissertation's infrared and tactical passages are not implemented.",
  ],
  sources,
  keyExchange,
};
