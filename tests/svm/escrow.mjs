// Run in Linux/macOS after building the SBF program. Fixtures model the final
// state returned by ER; the live suite separately verifies that commit path.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import { getTransactionDecoder } from '@solana/kit';
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { createRequire } from 'node:module';
const anchor = createRequire(import.meta.url)('@coral-xyz/anchor');
import { serialize } from 'borsh';
const { BN } = anchor;
const idl = JSON.parse(fs.readFileSync('../../public/idl.json'));
const program = new PublicKey(idl.address),
  ac = new anchor.BorshAccountsCoder(idl),
  ic = new anchor.BorshInstructionCoder(idl);
const binary = fs.readFileSync(
  process.env.ULTRAPONG_PROGRAM || '../../target/deploy/ultrapong.so',
);
const arr = (type) => ({ array: { type } }),
  vec = { struct: { x: 'i64', y: 'i64' } };
const gameSchema = {
  struct: {
    tick: 'u32',
    players: arr({
      struct: {
        lives: 'u8',
        pos: 'i64',
        target: 'i64',
        bot: 'bool',
        hits: 'u32',
        cooldown: 'u32',
        shield: 'u32',
      },
    }),
    balls: arr({ struct: { p: vec, v: vec, last: 'i8', wait: 'u32' } }),
    hazards: arr({
      struct: { p: vec, kind: 'u8', owner: 'u8', expires: 'u32', phase: 'u32' },
    }),
    rng: 'u64',
    pause: 'u32',
    winner: 'i8',
    finished: 'bool',
    sabotage: 'bool',
    generation: 'u32',
  },
};
const key = (p) => p.toBase58();
const pda = (s) => PublicKey.findProgramAddressSync(s, program)[0];
let passed = 0;
function pass(label) {
  passed++;
  console.log('PASS', label);
}
function instruction(name, args, a) {
  const def = idl.instructions.find((i) => i.name === name);
  return new TransactionInstruction({
    programId: program,
    data: ic.encode(name, args),
    keys: def.accounts.map((k) => ({
      pubkey: a[k.name] ?? new PublicKey(k.address),
      isSigner: !!k.signer,
      isWritable: !!k.writable,
    })),
  });
}
async function fixture({ winner = 0, finished = true } = {}) {
  const svm = new LiteSVM().withTransactionHistory(0n);
  svm.addProgram(key(program), binary);
  const payer = Keypair.generate(),
    wallets = Array.from({ length: 8 }, () => Keypair.generate());
  for (const w of [payer, ...wallets])
    svm.airdrop(key(w.publicKey), 1_000_000_000n);
  const nonce = new BN(1);
  const room = pda([
    Buffer.from('room'),
    payer.publicKey.toBuffer(),
    nonce.toArrayLike(Buffer, 'le', 8),
  ]);
  const game = pda([Buffer.from('match'), room.toBuffer(), Buffer.alloc(8)]),
    escrow = pda([Buffer.from('escrow'), room.toBuffer()]);
  const a = { room, game, escrow };
  function send(signer, name, args = {}, extra = {}, error) {
    const tx = new Transaction({
      blockhash: svm.latestBlockhash(),
      lastValidBlockHeight: 0,
      feePayer: signer.publicKey,
    }).add(
      instruction(name, args, { ...a, payer: signer.publicKey, ...extra }),
    );
    tx.sign(signer);
    const result = svm.sendTransaction(
      getTransactionDecoder().decode(tx.serialize()),
    );
    if (error) {
      assert.ok(
        result instanceof FailedTransactionMetadata,
        'Expected rejection ' + name,
      );
      assert.match(
        result.meta().logs().join('\n'),
        new RegExp('Error Code: ' + error),
      );
    } else
      assert.ok(
        !(result instanceof FailedTransactionMetadata),
        result instanceof FailedTransactionMetadata
          ? result.meta().logs().join('\n')
          : '',
      );
    return result;
  }
  const read = (name, p) =>
    ac.decode(name, Buffer.from(svm.getAccount(key(p)).data));
  function write(name, p, data) {
    const account = svm.getAccount(key(p));
    const layout = ac.accountLayouts.get(name);
    const bytes = Buffer.alloc(Number(account.space));
    Buffer.from(layout.discriminator).copy(bytes);
    layout.layout.encode(data, bytes, 8);
    svm.setAccount({ ...account, data: bytes });
  }
  send(payer, 'create_room', { nonce, wager: true, sabotage: true });
  for (const w of wallets)
    send(w, 'join', { name: [...Buffer.alloc(16)], session: w.publicKey });
  const r = read('Room', room);
  r.state = 1;
  write('Room', room, r);
  const e = read('Escrow', escrow);
  e.deadline = new BN(1000);
  write('Escrow', escrow, e);
  const m = read('MatchState', game);
  m.humans = 8;
  m.players = r.players;
  m.sessions = r.sessions;
  m.status = finished ? 2 : 1;
  m.expiry = new BN(2000);
  m.data = Buffer.from(
    serialize(gameSchema, {
      tick: 100,
      players: wallets.map((_, i) => ({
        lives: i === winner ? 1 : 0,
        pos: 5000,
        target: 5000,
        bot: false,
        hits: 0,
        cooldown: 0,
        shield: 0,
      })),
      balls: [],
      hazards: [],
      rng: 1,
      pause: 0,
      winner,
      finished,
      sabotage: true,
      generation: 7,
    }),
  );
  write('MatchState', game, m);
  const time = (n) => {
    const c = svm.getClock();
    c.unixTimestamp = BigInt(n);
    svm.setClock(c);
  };
  time(999);
  return {
    svm,
    payer,
    wallets,
    a,
    send,
    read,
    write,
    time,
    balance: (w) => svm.getBalance(key(w.publicKey)),
  };
}
{
  const f = await fixture();
  const { payer, wallets, send, read, a, balance, svm } = f;
  send(payer, 'settle', {}, { winner: wallets[1].publicKey }, 'Unauthorized');
  pass('Wrong recipient cannot redirect the pot');
  const before = balance(wallets[0]),
    rent = svm.getBalance(key(a.escrow)) - 80_000_000n;
  send(payer, 'settle', {}, { winner: wallets[0].publicKey });
  assert.equal(balance(wallets[0]) - before, 80_000_000n);
  assert.equal(svm.getBalance(key(a.escrow)), rent);
  pass(
    'Winner receives the exact eight-player pot; account rent remains intact',
  );
  send(payer, 'settle', {}, { winner: wallets[0].publicKey });
  assert.equal(balance(wallets[0]) - before, 80_000_000n);
  pass('Duplicate payout is idempotent');
  send(wallets[0], 'refund', {}, {}, 'NotRefundable');
  assert.equal(read('Escrow', a.escrow).total.toNumber(), 0);
  pass('Refund cannot race a completed payout');
}
{
  const { send, payer, wallets } = await fixture({ finished: false });
  send(payer, 'settle', {}, { winner: wallets[0].publicKey }, 'WrongPhase');
  pass('An unfinished match cannot pay out');
}
{
  const { send, payer, wallets, time, balance, read, a } = await fixture();
  send(wallets[0], 'refund', {}, {}, 'NotRefundable');
  pass('Refund rejected one second before deadline');
  time(1000);
  send(payer, 'settle', {}, { winner: wallets[0].publicKey }, 'Expired');
  pass('Payout rejected at the exact refund deadline');
  for (const w of wallets) {
    const before = balance(w);
    send(w, 'refund');
    assert.equal(balance(w) - before, 9_995_000n);
  }
  assert.equal(read('Escrow', a.escrow).total.toNumber(), 0);
  pass('Every participant recovers exactly their stake less transaction fee');
  const before = balance(wallets[0]);
  send(wallets[0], 'refund');
  assert.equal(balance(wallets[0]) - before, -5000n);
  pass('Repeated refunds cannot drain other deposits or account rent');
  send(payer, 'settle', {}, { winner: wallets[0].publicKey }, 'Expired');
  pass('Late ER result cannot override completed refunds');
}
{
  const { send, payer, wallets, read, a } = await fixture({ winner: -1 });
  send(payer, 'settle', {}, { winner: payer.publicKey });
  assert.equal(read('Escrow', a.escrow).state, 2);
  for (const w of wallets) send(w, 'refund');
  assert.equal(read('Escrow', a.escrow).total.toNumber(), 0);
  pass('Draw enables immediate refunds for every participant');
}
{
  const svm = new LiteSVM();
  svm.addProgram(key(program), binary);
  const host = Keypair.generate(),
    session = Keypair.generate();
  svm.airdrop(key(host.publicKey), 1_000_000_000n);
  const nonce = new BN(2),
    room = pda([
      Buffer.from('room'),
      host.publicKey.toBuffer(),
      nonce.toArrayLike(Buffer, 'le', 8),
    ]),
    escrow = pda([Buffer.from('escrow'), room.toBuffer()]),
    game = pda([Buffer.from('match'), room.toBuffer(), Buffer.alloc(8)]);
  const a = { payer: host.publicKey, room, escrow, game };
  const tx = new Transaction({
    blockhash: svm.latestBlockhash(),
    lastValidBlockHeight: 0,
    feePayer: host.publicKey,
  }).add(
    instruction('create_room', { nonce, wager: true, sabotage: true }, a),
    SystemProgram.transfer({
      fromPubkey: host.publicKey,
      toPubkey: session.publicKey,
      lamports: 2_000_000,
    }),
    instruction(
      'join',
      { name: [...Buffer.alloc(16)], session: session.publicKey },
      a,
    ),
    instruction('ready', {}, a),
  );
  tx.sign(host);
  assert.ok(tx.serialize().length <= 1232);
  const result = svm.sendTransaction(
    getTransactionDecoder().decode(tx.serialize()),
  );
  assert.ok(
    !(result instanceof FailedTransactionMetadata),
    result instanceof FailedTransactionMetadata
      ? result.meta().logs().join('\n')
      : '',
  );
  const r = ac.decode('Room', Buffer.from(svm.getAccount(key(room)).data));
  assert.equal(r.count, 1);
  assert.ok(r.ready[0]);
  assert.equal(svm.getBalance(key(session.publicKey)), 2_000_000n);
  pass('Create, fund session, deposit and ready fit in one signed transaction');
}
console.log(`${passed} compiled-program escrow checks passed`);
{
  const { svm, payer, a, read, write } = await fixture({ finished: false });
  const m = read('MatchState', a.game);
  m.heartbeat = Array.from({ length: 8 }, () => new BN(999));
  m.data = Buffer.from(
    serialize(gameSchema, {
      tick: 500,
      players: Array.from({ length: 8 }, () => ({
        lives: 2,
        pos: 5000,
        target: 5000,
        bot: false,
        hits: 0,
        cooldown: 0,
        shield: 0,
      })),
      balls: [-1, 0, 1].map((i) => ({
        p: { x: i * 3000, y: 0 },
        v: { x: 0, y: 10000 },
        last: 0,
        wait: 0,
      })),
      hazards: Array.from({ length: 12 }, (_, i) => ({
        p: { x: (i % 4) * 23000 - 34500, y: Math.floor(i / 4) * 23000 - 23000 },
        kind: i % 3,
        owner: 255,
        expires: 740,
        phase: 400,
      })),
      rng: 1,
      pause: 0,
      winner: -1,
      finished: false,
      sabotage: true,
      generation: 0,
    }),
  );
  write('MatchState', a.game, m);
  // Only this local fixture bypasses signature verification to exercise the
  // scheduler-only entrypoint. Forged scheduler signatures are tested on Devnet.
  svm.withSigverify(false);
  svm.warpToSlot(2n);
  const crank_signer = PublicKey.findProgramAddressSync(
    [Buffer.from('crank-executor'), a.game.toBuffer()],
    new PublicKey('Crank11111111111111111111111111111111111111'),
  )[0];
  const tx = new Transaction({
    blockhash: svm.latestBlockhash(),
    lastValidBlockHeight: 0,
    feePayer: payer.publicKey,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    instruction('tick', {}, { ...a, crank_signer }),
  );
  tx.partialSign(payer);
  const result = svm.sendTransaction(
    getTransactionDecoder().decode(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ),
  );
  assert.ok(
    !(result instanceof FailedTransactionMetadata),
    result instanceof FailedTransactionMetadata
      ? result.meta().logs().join('\n')
      : '',
  );
  assert.ok(result.computeUnitsConsumed() < 900_000n);
  assert.ok(read('MatchState', a.game).data.length < 8192 - 800);
  pass(
    'Maximum three-ball/twelve-hazard tick fits compute and account limits (' +
      result.computeUnitsConsumed() +
      ' CU)',
  );
}
