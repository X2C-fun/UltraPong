# UltraPong

An original survival-Pong browser game inspired by SIDE OUT, with shared Rust physics, Solana Devnet escrow, and real MagicBlock Ephemeral Rollup multiplayer.

## Play

- Warmup: one player and seven bots; no wallet required. Main menu is available above the arena throughout the round.
- Free rooms: up to eight wallet-connected players; bots fill the empty walls.
- Wager rooms: two to eight humans, 0.01 Devnet SOL each, no house fee. The recorded winner receives the entire pot. Network fees, room-account rent, and the 0.002 SOL session funding are separate.
- Desktop: A/D or left/right arrows. Mobile: touch slide. Mouse movement never moves a desktop paddle; eliminated players still use a pointer to aim sabotage.
- Two lives per wall. One remaining life changes the edge to dashes. Eliminations morph the arena and reset it to one faster ball.
- Every match opens with a synchronized three-second countdown; paddles can move while the ball waits. Mobile starts bring the arena into view automatically. Opening serves use 4,200 units per 50 ms tick, increasing by 450 per elimination (serve cap 7,800). Every paddle return adds 6% plus 30 units, capped at 11,500. Later serves have a short half-second warning.
- Center pickups start five seconds into a stage: expand, shrink, or triple ball. Paddle effects last ten seconds; split balls are capped at three. Neutral bumpers/spinners begin at 18 seconds and recur every 20 seconds. Obstacles and sabotage hazards persist until the next elimination clears them, including the final elimination. Sabotage retains its cooldown and placement limits.

## What runs where

1. Solana creates the room and escrow. Creating, entering, funding a gameplay session, and readying the host fit in one wallet approval. Joining and readying another player also use one approval. Launching requires one further host approval for delegation.
2. The match account is delegated to MagicBlock's Asia Devnet ER. Verified randomness seeds the game. An authority-scoped scheduled transaction advances deterministic Rust physics at 20 Hz. Signed session inputs set paddle targets; they never supply ball positions or a winner.
3. Browsers subscribe to the same account, rotate their wall to the bottom, and use the same physics compiled to WebAssembly for short local prediction. The local paddle renders at the display frame rate toward recent input without snapping to delayed snapshots; it reconciles when input stops or updates go stale. Input confirmation runs separately from submission, so a slow confirmation cannot block touch updates. Cached snapshots and capped mobile canvas resolution reduce rendering work. Browser predictions cannot settle a pot.
4. At completion, the result is committed and undelegated back to Solana. The program checks that result and pays the exact recorded winner. Concurrent client finalizers are reconciled against the committed account so a completed payout does not show an ownership error to the loser.

Open **Live network activity** beneath the arena to inspect actual input, scheduled tick, delegation, and settlement signatures. It includes RPC endpoints, account ownership, statuses, slots, and explorer links. It retains the latest 200 observed transactions; multiplayer log subscriptions run while the panel is open. Submission acknowledgement is explicitly distinct from confirmation.

Program: `37DBNkDoLdAgnKrtQfMYSLF7jUZ1HqQsN8fqNKhVYQkh` (Devnet)

Base RPC: `https://rpc.magicblock.app/devnet`  
ER RPC: `https://devnet-as.magicblock.app`

## Recovery and authority

Lobby entrants can withdraw before launch. Lobbies expire after two minutes. Disconnecting leaves the paddle stationary and forfeits it after 20 seconds without a heartbeat. An entirely abandoned match ends as a draw. Matches end within five minutes of simulation time; tied final scores draw. Draws unlock individual stake refunds. A hard 15-minute base-layer deadline enables refunds even if ER cannot return the result. Settlement cannot override refunds after that deadline; repeated payouts/refunds cannot drain the escrow.

Session keys are generated in the browser and stored in sessionStorage for reconnects. They authorize gameplay only for that room and round's participants, expire, and cannot withdraw the wallet's stake. The wallet can replace the session on the ER; the old session then loses authority. Program deployment keys are never sent to the browser.

## Development

### Vercel deployment

Vercel uses the checked-in `vercel.json`: framework Vite, build command `npm run build:vercel`, output directory `dist-vercel`. Set the project Root Directory to the directory containing `package.json` and `vercel.json`, then deploy the latest source. Use Node.js 22.x. No frontend environment secrets are required.

The default `npm run build` creates a Cloudflare Worker for Sites and must not be used as Vercel's static output. The separate Vercel build serves the same game directly in the browser, including `physics.wasm` and `idl.json`; it still uses the same deployed Solana program and MagicBlock ER. Invite query strings such as `/?room=...` are preserved. To inspect this build locally, run `npm run build:vercel` and `npx vite preview --config vite.vercel.config.ts --port 4174`.

If an older Vercel deployment shows `404: NOT_FOUND`, redeploy after including these files and verify the project root. A deployment URL remains on its original build until a new deployment is created.

Requires Node 22.13+, Rust, Solana CLI and Anchor 1.0.2. Solana builds and the LiteSVM tests run in Linux/WSL or macOS. No frontend environment secrets are required.

```sh
npm ci
npm run dev
npm run check
npm run build
```

Build the shared engine and program in Linux/WSL:

```sh
cargo test -p ultrapong-physics
cargo build -p ultrapong-physics --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/ultrapong_physics.wasm public/physics.wasm
anchor build
cp target/idl/ultrapong.json public/idl.json
```

On a Windows-mounted WSL checkout, set `CARGO_TARGET_DIR` to a Linux directory if SBF tool permissions fail. Copy the resulting WASM from that directory. Deploy with a local signing key only, then update the declared program address and IDL together if deploying a different program. The current deployment supports reading earlier match-state bytes.

## Verification

- 13 Rust tests cover deterministic simulation, bounds, collapsing shapes, speed increases, stage ball reset, pickup effects and expiry, split limits, periodic obstacles, persistent hazards, synchronized countdown and legacy-state compatibility.
- Eight browser-logic regression tests cover both directions for all 35 player/arena combinations, paddle boundaries, mouse/touch separation, smooth paddle motion and competing finalization.
- 13 compiled-program LiteSVM checks cover exact pot payment, wrong recipients, unfinished games, duplicate payout/refunds, draw refunds, the exact timeout boundary, single-approval setup, and the maximum three-ball/twelve-hazard tick (189,683 compute units in the tested fixture). The scheduler-only fixture disables signature verification locally; forged scheduler signatures are separately rejected on Devnet.
- The live eight-wallet suite verified delegation, randomness, scheduled ticks, scoped inputs, session replacement, replay rejection, ER transaction logs, disconnects, concurrent finalization, unchanged committed state, an exact 0.08 SOL payout, duplicate settlement protection, and room reuse. The latest completed run submitted 1,330 inputs, observed 2,009 snapshots, and measured 78 ms p95 RPC submission acknowledgement. This is one Devnet run, not a latency guarantee.
- Live free-room tests verified seven bots, eliminated-player sabotage, cooldown rejection, late-join rejection, a bot winner's zero-value settlement, and abandoned-room cleanup.

Run local program tests after building:

```sh
cd tests/svm
npm ci
ULTRAPONG_PROGRAM=../../target/deploy/ultrapong.so npm test
```

Live tests read a funded Devnet signer from `~/.config/solana/id.json` and spend test SOL. They save disposable test wallets and reports only in ignored directories:

```sh
node scripts/integration.mjs
node scripts/free-integration.mjs
```

The preview browser has no wallet extension; actual Phantom/Solflare signing and device-specific wallet behavior require a wallet-enabled browser. The production build, fresh HTTP loads, WebAssembly loading, warmup/menu navigation, responsive layout and wallet discovery fallback are checked separately. Lint covers the application and tests; unmodified, unused starter UI templates are excluded.

## Secret handling

`npm run security` checks tracked and non-ignored source for common credential formats and verifies Git exclusions. `.env*`, deployment keypairs, generated target files, and `scripts/.wallets/` are ignored. The frontend contains public RPC addresses and a public program ID; these are not secrets. The scan found no embedded credentials in the current source. It is a pattern scan, not a comprehensive security audit.

Useful references: [MagicBlock ER integration](https://docs.magicblock.gg/pages/get-started/how-integrate-your-program/quickstart), [LiteSVM](https://github.com/LiteSVM/litesvm).
