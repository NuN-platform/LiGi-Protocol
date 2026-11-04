# LiGi Gate

LiGi is a visible-light protocol. A display is the transmitter. A sensor reads geometric cells off that display, rebuilds the payload, and checks it. This repository is a browser gate for that protocol: fountain-coded frames, an optical handshake signature, and a post-quantum rendezvous with ML-KEM-768.

The gate is a lab, not a radio stack. It paints frames on a page. It does not open a camera, bind a UDP port, or run a quantum processor.

## How LiGi works

A session moves through six steps.

1. **Plaintext.** The operator writes up to 3,200 bytes. A text file of the same size can be loaded instead.
2. **Fit the body.** Above 64 bytes the gate gzip-compresses the plaintext when the compressed form is shorter.
3. **Seal, or leave it open.** With no passphrase and with ML-KEM off, the body stays readable to anyone who decodes the panel. A passphrase of at least eight characters seals it with PBKDF2-SHA-256 and AES-256-GCM. ML-KEM-768 seals it with AES-256-GCM under a fresh shared secret. The two seals are not combined.
4. **Fountain layer.** The sealed body is prefixed with a 4-byte preface and split into source blocks of 32 or 48 bytes. The first *k* frames carry those blocks. Later frames are XOR combinations drawn from a robust-soliton degree distribution. A sensor can miss frames and still finish. The schedule length is about 2.1*k*.
5. **Geometric frame.** Each frame has a 24-byte header and one symbol. Header and symbol bytes are painted as colored cells on a 32 by 16 grid. Four 2-by-2 finder corners stay fixed. The remaining symbol cells are permuted from the session id and the sequence number. Spare cells repeat a frame checksum so a glare stripe fails the read instead of corrupting the symbol.
6. **Receive and close.** A sensor locks the grid, reads the cells, and peels the fountain code. It checks the SHA-256 prefix in the header against the recovered plaintext, then returns an HMAC-SHA256 acknowledgement. The transmitter accepts the acknowledgement only when the MAC matches.

### Frame header

| Bytes | Field | Meaning in this gate |
| --- | --- | --- |
| 0–7 | Session id | Permutation seed. Also the salt when a passphrase is used. |
| 8–11 | Sequence | Below *k* the symbol is a source block. At *k* and above it is a repair symbol. |
| 12–13 | Symbol size | 32 or 48 bytes. |
| 14–15 | Block count *k* | Number of source symbols. |
| 16–19 | Payload length | Low 30 bits are the length. Bit 31 marks gzip. Bit 30 marks a sealed payload. |
| 20–23 | SHA-256 prefix | First four bytes of the plaintext hash. |

The preface inside the payload carries the same gzip and seal flags, plus two ML-KEM flags: optical ciphertext, or network ciphertext.

### What the sensor must survive

Frame loss drops a whole frame. The fountain layer is there for that. Occlusion covers a band of cells. Those frames are rejected, not repaired in place. Three sensors on one page use different loss rates, which is the rule-of-three receive pattern: more than one view must be able to finish, and their hashes must agree.

The lock used on the small-cell profiles follows the c12fix2 decoder from the October 2026 optical runs: finder centroids, a line fit on the top and left edges, an aspect check on the fitted pitch, then a short list of pitch factors if the first sample grid misses. Stride 6 reads the center of a cell and pixels a few steps away, still inside that cell. The c8 profile is an 8 px cell, stride 6, 5 frames per second.

On bis3946-pc the newest real optical pass (27 October 2026, 02:49 Europe/Zagreb) carried an ML-KEM ciphertext in one camera frame at cell size 8. This browser grid is 32 by 16 cells, so the same ciphertext takes several fountain frames. The lab records that difference on the SN2 bench tab.

### Design targets and what this page measures

The whitepaper states a full-panel geometry, recovery with roughly 30–40% of frames missing, and 150–400 KB/s on a 60–240 Hz panel. This page paints at 4–16 fps so the cells stay visible. A recovered sensor card reports the kilobytes per second that this browser actually moved. That number is a lab measurement, not the whitepaper target.

Healing hold pauses the transmitter. While it is on, no new frame is painted. Symbols already collected stay put. The switch follows the sequencing note in `bis3946/Nun-root`: while a heal is open, LiGi transmission stays paused.

## Quantum and post-quantum

Two different mechanisms appear in the papers and in this gate. They answer different questions.

**Optical handshake (the “quantum” label in the signature).** The construction is copied from `core/ligi_v5_optical.py` in `bis3946/melek-core`. Lux and a timestamp go in. SHA3-512 comes out, printed as `VSha-3946_LIGI_v5.2_OPTICAL_…`. A scalar called quantum weight is 0.62 in the dark and `1 + lux × 0.00005` when the sensor is lit, capped for very large lux. The entropy string also contains the text `CRYSTALS-Kyber-1024`. That string is a label inside a classical hash. The gate does not run a quantum computer, a photon source for key distribution, or an entanglement link. This machine has no phone light sensor, so the operator moves a lux slider. The ambient reference from the L0 note is 298.15 K, which replaced an older cryogenic check.

**Post-quantum rendezvous (the cipher that protects the payload).** The gate runs ML-KEM-768, FIPS 203, through `@noble/post-quantum`. The receiver generates a key pair and publishes the 1,184-byte public key. The sender encapsulates and obtains a 1,088-byte ciphertext and a 32-byte shared secret. The ciphertext is either painted inside the optical payload or sent beside the panel. The payload itself is AES-256-GCM under that shared secret. The SN2 logs showed an ML-KEM optical ciphertext and a matching payload hash. They do not publish a key-derivation function, so this gate uses the 32-byte shared secret directly as the AES-256 key. The HMAC acknowledgement is keyed with that same secret. When ML-KEM is off, the acknowledgement is keyed with the hash of the session id.

The dissertation names Kyber-1024. Kyber is the earlier name of the scheme that FIPS 203 standardized as ML-KEM. This gate implements the ML-KEM-768 parameter set because its ciphertext fits the lab schedule. It does not implement an AES-512 wrapper. AES-512 is not a NIST mode.

A session that needs both pieces uses them in order. The handshake signature shows that two parties stamped the same optical conditions. ML-KEM then gives them a shared secret that a later classical or quantum computer is not expected to recover from the public key and the ciphertext. The geometric frames carry the sealed bytes either way.

## Agents, machines, and sensors

Three roles use the gate. The letter in the tables below is the role, not a separate product.

| Letter | Role | Holds | Does not hold |
| --- | --- | --- | --- |
| A | Agent | The decision to open, pause, or stop a session. A public key it has been given. Optionally its own ML-KEM secret, if it is the receiver. | A camera, and usually not the panel hardware. |
| M | Machine | The display that paints cells, or the host that forwards a network ciphertext. The sender’s copy of the shared secret after encapsulation. | The receiver’s ML-KEM secret. |
| S | Sensor | Samples of the panel, the recovered plaintext, and the decapsulation key when it is the ML-KEM receiver. | The ability to invent frames it did not see. |

The optical payload always travels from a machine that can paint to a sensor that can sample. Agents arrange keys and tell a machine to paint. A sensor can later become a sender by opening its own gate on a machine it controls. That is how every combination below stays the same protocol: ML-KEM toward whoever must read the plaintext, frames toward whoever must see the panel, and the VSha-3946 signature as the shared optical stamp.

The dashboard implements one hop of this. `BroadcastChannel` `ligi-gate-v2` reaches other windows on the same browser and the same origin. It does not cross the public network. A second computer runs its own copy of the gate. Public keys can be copied by hand. Painted frames still have to be on a display that the other sensor can see.

### Every A/M/S pair

| Path | Who starts | Who can read the plaintext | Post-quantum step | Optical handshake | On this gate |
| --- | --- | --- | --- | --- | --- |
| A2A | Agent A has a payload for agent B. | Agent B. | B generates ML-KEM-768 and gives A the public key. A encapsulates. B decapsulates and checks the HMAC. | Both agents stamp lux and compare the VSha-3946 signature if they share a light reading. | Paste B’s public key, choose **Sensor window**, open the gate. B uses **Open a sensor window** or a second copy of the app and keeps the secret there. |
| A2M | Agent A asks machine M to carry bytes for storage or relay. | Machine M. | M publishes its public key. A encapsulates to M. The shared secret never returns to A in the clear. | M can stamp the panel it is about to paint. | Run the gate on M with **Key on this page**. A is the operator who presses **Open the gate**. |
| A2S | Agent A addresses a sensor directly. | Sensor S. | S holds the secret. A encapsulates to S’s public key. | S is the party whose lux reading matches the signature. | **Sensor window**, or paste the key shown in the sensor window. Leave sharing on. |
| M2A | Machine M already has a payload and an agent is the reader. | Agent A. | A generates the key pair. M encapsulates and paints. A decapsulates. | M paints. A checks the signature against the lux it was told. | M runs the transmitter. A’s browser is the sensor window and holds the secret. |
| M2M | Machine M1 paints for machine M2. | Machine M2. | M2’s public key is installed on M1. M1 encapsulates. M2 samples the panel and decapsulates. | Each machine can record lux. The signatures match when the stamped lux and time match. | This is the SN2 optical ladder: one host paints, the other locks cells. Two browser windows on one host demonstrate it. Two hosts need a real display between them. |
| M2S | A machine paints for a sensor. This is the normal LiGi hop. | Sensor S. | S holds the secret. The ciphertext is optical, or the network fallback when the ciphertext is not placed in the cells. | S is looking at the panel, so its lux stamp is the one that belongs on the session. | Open the gate. The three on-page sensors are S. Choose **Optical CT** or **Network fallback**. |
| S2A | A sensor has recovered a payload and must hand it to an agent. | Agent A. | The sensor’s machine opens a new session toward A’s public key. | The new session gets a new stamp. The old session’s hash is inside the new plaintext, so A can see what was recovered. | Copy the recovered text, paste A’s public key, open a new gate. |
| S2M | A sensor reports a result to a machine. | Machine M. | M publishes a public key. The sensor’s host encapsulates to it. | Optional. The report can include the previous signature string as text. | Same as S2A, with M’s key in the paste field. **Network fallback** keeps a large ciphertext off the panel if M and the sensor share the local channel. |
| S2S | Sensor S1 confirms a reading with sensor S2. | Sensor S2, if the bytes are sealed for S2. If both sensors only compare a broadcast, both already have the plaintext. | For a private confirmation, S2 holds the key and S1 encapsulates. For the rule of three, no new key is required: both sensors must recover the same SHA-256. | Both sensors stamp lux. Equal signatures mean they claim the same light and time. | The three cards on one page are S2S comparison. Hashes must be identical. A private S1-to-S2 message uses a second session and S2’s public key. |

Mixed paths are the same rules stacked. An agent tells a machine to paint for a sensor (A → M → S). The agent never sees the sensor’s secret. The machine sees the shared secret only because it encapsulated. The sensor recomputes that secret by decapsulation. The HMAC is the sensor’s proof back to the machine. A further hop (S → M or S → A) is a new session with a new public key, not a rewrite of the frames already on the panel.

### What each party stores

| Party | Store | Do not store in a log or a screenshot |
| --- | --- | --- |
| Sender | Public key it encapsulated to, ciphertext, shared-secret hash (first 8 bytes of SHA-256, shown on the page), session id, payload hash. | The raw shared secret and the receiver’s secret key. |
| Receiver | Its secret key, the recovered plaintext, the HMAC it sent. | Someone else’s secret key. |
| Any observer of the panel | Ciphertext and sealed frames, if they can read the cells. | A plaintext, unless the session was left unsealed. |

The page shows the shared-secret hash so two parties can confirm they derived the same secret, which is the check recorded in the SN2 ML-KEM self-test. It does not print the secret itself.

## Run the gate

Requirements: Node.js 20 or newer, and npm 10 or newer. No account, camera, or API key.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:41731](http://127.0.0.1:41731) on the machine that is running the dev server. Another computer cannot open that address.

```bash
npm test
npm run lint
npm run build
npm start
```

`npm test` covers the header, the fountain codec, occlusion, the passphrase, the c8 stride lock, ML-KEM encapsulation, the optical ciphertext, the network fallback, and the HMAC acknowledgement. `GET /api/spec` returns the specification summary as JSON.

### Operate a session

1. On the Gate tab, write a payload or load a `.txt`, `.md`, or `.json` file. The limit is 3,200 bytes.
2. Choose a cell profile. **Lab 18** samples the center of an 18 px cell at 8 fps. **c24**, **c12**, **c10**, and **c8** use stride 6 at 5 fps. **c8** also turns on optical ML-KEM with the key on this page, matching the newest pass on bis3946-pc.
3. Press **Open the gate**. Three sensors collect symbols at 8%, 20%, and 35% frame loss.
4. A card marked **recovered** shows the text, the SHA-256, and an HMAC prefix. The hash must match the seal printed above the panel. **HMAC ACK complete** means the acknowledgement checked out.
5. **Stop** ends the schedule and leaves recovered text on the cards. **Healing hold** pauses painting and keeps symbols already collected.

| Control | Effect |
| --- | --- |
| Symbol size | 32 or 48 bytes. Smaller symbols produce more frames. |
| Panel rate | 4 to 16 fps. |
| Stride | 1 to 8. The October optical passes used 6. |
| Occlusion | Rejects frames whose cells are covered. Distinct from loss, which drops a whole frame. |
| Share with other windows | Publishes pixels on `BroadcastChannel` `ligi-gate-v2`. |
| Passphrase | AES-256-GCM. Empty means the payload is unsealed. Disabled while ML-KEM is on. |
| Optical CT | ML-KEM ciphertext is inside the painted payload. |
| Network fallback | Ciphertext travels on the local channel. The payload stays on the panel. |
| Key on this page | This page holds the secret, so the three local sensors can open the payload. |
| Sensor window | The other window holds the secret. Paste a key or wait for the fingerprint. |
| Lux, Stamp now | Recompute the VSha-3946 signature. |

**Open a sensor window** opens `/?role=sensor`. That window shows its public-key fingerprint. Copy the key if the transmitter is not sharing the channel automatically. Loss and occlusion in that window apply only there.

The SN2 bench lists the runs found on bis3946-pc on 4 November 2026. Nothing on that disk was newer than 27 October 2026. The Specification tab is the header and the running feature list. Sources links the Drive documents and the public repositories the gate was checked against.

## Where the behavior came from

The 24-byte header, the Luby outer layer, the geometric panel, and the rule of three come from the LiGi Protocol Whitepaper v2 in the author’s Google Drive. The handshake comes from `bis3946/melek-core`. The hold comes from `bis3946/Nun-root`. The optical cell ladder and the ML-KEM rendezvous come from the test logs on bis3946-pc, read on 4 November 2026. A public web search that day did not find a separate LiGi standard. The stored optical key-exchange table (430 THz through 700 THz) is shown on the Sources tab and is not transmitted.

No fountain codec was in those public GitHub repositories. This dashboard is that frame layer, sized for a browser.

## What is left out of the gate

The dissertation’s infrared and tactical passages are not implemented. The UDP sketch on port 3946 is not bound. The gate does not drive a camera or a physical panel. AES-512 is not implemented.

## Files omitted from Git

`.gitignore` keeps generated and local files out of a GitHub push. The commit contains source, tests, `package.json`, and `package-lock.json`. It does not contain:

- `node_modules/` and package-manager caches
- `.next/`, `out/`, `build/`, and `dist/`
- `*.tsbuildinfo` and `next-env.d.ts`
- `.env`, `.env.*`, and key or certificate files
- logs, Cloudflare tunnel binaries, and `.cloudflared/`
- coverage and browser-test output
- `.cursor/`, editor folders, and OS junk

No secret is required to run the lab. Do not add key files to override the ignore list.

## License

Apache License 2.0. The full text is in `LICENSE`.
