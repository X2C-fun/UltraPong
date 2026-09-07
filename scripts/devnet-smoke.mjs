import fs from 'node:fs';
import os from 'node:os';
import { Buffer } from 'node:buffer';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { createRequire } from 'node:module';
const anchor = createRequire(import.meta.url)('@coral-xyz/anchor');
import mb from '@magicblock-labs/ephemeral-rollups-sdk';
const { BorshAccountsCoder, BorshInstructionCoder, BN } = anchor;
const IDL = JSON.parse(fs.readFileSync('public/idl.json', 'utf8')),
  ID = new PublicKey(IDL.address);
const base = new Connection('https://api.devnet.solana.com', 'confirmed'),
  er = new Connection('https://devnet-as.magicblock.app', 'confirmed');
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      fs.readFileSync(os.homedir() + '/.config/solana/id.json', 'utf8'),
    ),
  ),
);
const ac = new BorshAccountsCoder(IDL),
  ic = new BorshInstructionCoder(IDL);
const pda = (s) => PublicKey.findProgramAddressSync(s, ID)[0];
const b = (s) => Buffer.from(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ix(name, args, a) {
  const def = IDL.instructions.find((i) => i.name === name);
  return new TransactionInstruction({
    programId: ID,
    data: ic.encode(name, args),
    keys: def.accounts.map((k) => ({
      pubkey: a[k.name] ?? new PublicKey(k.address),
      isSigner: !!k.signer,
      isWritable: !!k.writable,
    })),
  });
}
async function send(connection, signer, instructions) {
  const latest = await connection.getLatestBlockhash();
  const tx = new Transaction({ ...latest, feePayer: signer.publicKey }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ...instructions,
  );
  tx.sign(signer);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: connection === er,
    maxRetries: 3,
  });
  for (let i = 0; i < 100; i++) {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s?.err) {
      const tx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      throw Error(
        JSON.stringify({
          signature,
          error: s.err,
          logs: tx?.meta?.logMessages,
        }),
      );
    }
    if (
      s?.confirmationStatus === 'confirmed' ||
      s?.confirmationStatus === 'finalized'
    )
      return signature;
    await sleep(100);
  }
  throw Error('Confirmation timeout ' + signature);
}
async function account(c, key, name) {
  const data = await c.getAccountInfo(key);
  if (!data) throw Error('Missing ' + key);
  return ac.decode(name, data.data);
}
const dir = 'scripts/.wallets';
fs.mkdirSync(dir, { recursive: true });
let saved;
const resume = process.argv.includes('--resume');
if (resume) saved = JSON.parse(fs.readFileSync(dir + '/match.json', 'utf8'));
const nonce = new BN(saved?.nonce ?? Date.now());
const room = pda([
    b('room'),
    payer.publicKey.toBuffer(),
    nonce.toArrayLike(Buffer, 'le', 8),
  ]),
  game = pda([b('match'), room.toBuffer(), Buffer.alloc(8)]),
  escrow = pda([b('escrow'), room.toBuffer()]);
const wallets = saved
  ? saved.wallets.map((w) => Keypair.fromSecretKey(Uint8Array.from(w)))
  : [Keypair.generate(), Keypair.generate()];
fs.writeFileSync(
  dir + '/match.json',
  JSON.stringify({
    nonce: nonce.toString(),
    wallets: wallets.map((w) => [...w.secretKey]),
    room: room.toBase58(),
    game: game.toBase58(),
  }),
);
console.log('Room', room.toBase58());
if (!resume) {
  await send(base, payer, [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wallets[0].publicKey,
      lamports: 40_000_000,
    }),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wallets[1].publicKey,
      lamports: 40_000_000,
    }),
  ]);
  await send(base, payer, [
    ix(
      'create_room',
      { nonce, wager: true, sabotage: true },
      { payer: payer.publicKey, room, escrow, game },
    ),
  ]);
  for (let i = 0; i < 2; i++) {
    const name = [...Buffer.alloc(16)];
    Buffer.from('TEST ' + i).forEach((v, j) => (name[j] = v));
    await send(base, wallets[i], [
      ix(
        'join',
        { name, session: wallets[i].publicKey },
        { payer: wallets[i].publicKey, room, escrow },
      ),
      ix('ready', {}, { payer: wallets[i].publicKey, room }),
    ]);
  }
  console.log('Deposited 0.02 Devnet SOL. Countdown.');
  await sleep(9500);
}
const r = await account(base, room, 'Room');
if (r.state === 0) {
  await send(base, payer, [
    ix(
      'lock_and_delegate',
      {},
      {
        payer: payer.publicKey,
        room,
        escrow,
        game,
        buffer_game: mb.delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
          game,
          ID,
        ),
        delegation_record_game:
          mb.delegationRecordPdaFromDelegatedAccount(game),
        delegation_metadata_game:
          mb.delegationMetadataPdaFromDelegatedAccount(game),
      },
    ),
  ]);
  console.log('Delegated');
}
let m;
for (let i = 0; i < 100; i++) {
  try {
    m = await account(er, game, 'MatchState');
    if (m.humans === 2) break;
  } catch {}
  await sleep(200);
}
if (m.status === 0) {
  await send(er, wallets[0], [
    ix(
      'request_seed',
      {},
      {
        payer: wallets[0].publicKey,
        game,
        program_identity: pda([b('identity')]),
      },
    ),
  ]);
  console.log('Randomness requested');
  for (let i = 0; i < 150; i++) {
    m = await account(er, game, 'MatchState');
    if (m.status === 1) break;
    await sleep(200);
  }
}
if (m.status !== 1 && m.status !== 2) throw Error('VRF did not fulfill');
const crankSigner = PublicKey.findProgramAddressSync(
  [b('crank-executor'), game.toBuffer()],
  new PublicKey('Crank11111111111111111111111111111111111111'),
)[0];
if (!m.scheduled) {
  console.log('Starting crank', crankSigner.toBase58());
  await send(er, wallets[0], [
    ix('start_crank', {}, { game, crank_signer: crankSigner }),
  ]);
}
const instance = await WebAssembly.instantiate(
  fs.readFileSync('public/physics.wasm'),
);
const wasm = instance.instance.exports;
function snapshot(bytes) {
  const ptr = wasm.game_load_buffer(bytes.length);
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
  if (!wasm.game_load()) throw Error('Invalid state');
  const p = wasm.game_snapshot();
  return JSON.parse(
    new TextDecoder().decode(
      new Uint8Array(wasm.memory.buffer, p, wasm.game_snapshot_len()),
    ),
  );
}
const timings = [];
let lastTick = 0,
  lastLog = Date.now();
const end = Date.now() + 90000;
while (Date.now() < end) {
  m = await account(er, game, 'MatchState');
  const snap = snapshot(m.data);
  if (m.status === 2) {
    console.log('Finished', snap.game);
    break;
  }
  if (snap.game.tick > lastTick) lastTick = snap.game.tick;
  for (let i = 0; i < 2; i++) {
    // Keep player zero connected; player one forfeits, exercising recovery and settlement.
    if (i === 1) continue;
    const start = Date.now();
    await send(er, wallets[i], [
      ix(
        'input',
        { sequence: new BN(Date.now()), target: 5000 },
        { signer: wallets[i].publicKey, game },
      ),
    ]);
    timings.push(Date.now() - start);
  }
  if (Date.now() - lastLog > 3000) {
    console.log('Tick', lastTick, 'status', m.status);
    lastLog = Date.now();
  }
  await sleep(300);
}
if (m.status !== 2)
  throw Error('Crank did not finish match; last tick ' + lastTick);
console.log(
  'Finalizing',
  await send(er, wallets[0], [
    ix('finalize', {}, { payer: wallets[0].publicKey, game }),
  ]),
);
for (let i = 0; i < 150; i++) {
  const a = await base.getAccountInfo(game);
  if (a?.owner.equals(ID)) {
    const state = ac.decode('MatchState', a.data);
    if (state.status === 2) break;
  }
  await sleep(500);
}
const final = await account(base, game, 'MatchState'),
  snap = snapshot(final.data);
if (final.status !== 2) throw Error('Final state not committed');
const winner = snap.game.winner;
if (winner < 0) throw Error('Unexpected draw');
const before = await base.getBalance(wallets[winner].publicKey);
const signature = await send(base, payer, [
  ix('settle', {}, { room, escrow, game, winner: wallets[winner].publicKey }),
]);
const after = await base.getBalance(wallets[winner].publicKey);
if (after - before !== 20_000_000)
  throw Error('Incorrect payout ' + (after - before));
await send(base, payer, [
  ix('settle', {}, { room, escrow, game, winner: wallets[winner].publicKey }),
]);
if ((await base.getBalance(wallets[winner].publicKey)) !== after)
  throw Error('Duplicate payout');
timings.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      result: 'PASS',
      room: room.toBase58(),
      signature,
      payoutLamports: after - before,
      tick: lastTick,
      p95InputMs: timings[Math.floor(timings.length * 0.95)],
    },
    null,
    2,
  ),
);
