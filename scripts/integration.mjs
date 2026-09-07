import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import mb from '@magicblock-labs/ephemeral-rollups-sdk';
import {
  base,
  er,
  payer,
  ID,
  BN,
  pda,
  b,
  ix,
  send,
  account,
  decode,
  sleep,
  expectFailure,
  physics,
} from './test-utils.mjs';
const report = { started: new Date().toISOString(), checks: [], matches: [] };
fs.mkdirSync('test-results', { recursive: true });
fs.mkdirSync('scripts/.wallets', { recursive: true });
const pass = (s) => {
  report.checks.push(s);
  console.log('PASS', s);
};
const ps = await physics();
async function create(wager) {
  const nonce = new BN(Date.now());
  const room = pda([
    b('room'),
    payer.publicKey.toBuffer(),
    nonce.toArrayLike(Buffer, 'le', 8),
  ]);
  const game = pda([b('match'), room.toBuffer(), Buffer.alloc(8)]),
    escrow = pda([b('escrow'), room.toBuffer()]);
  await send(base, payer, [
    ix(
      'create_room',
      { nonce, wager, sabotage: true },
      { payer: payer.publicKey, room, game, escrow },
    ),
  ]);
  return { room, game, escrow, nonce };
}
async function join(a, w, s, i) {
  const name = [...Buffer.alloc(16)];
  Buffer.from('RIVAL ' + i).forEach((v, j) => (name[j] = v));
  return send(base, w, [
    ix('join', { name, session: s.publicKey }, { payer: w.publicKey, ...a }),
  ]);
}
async function activate(a, session) {
  await send(base, payer, [
    ix(
      'lock_and_delegate',
      {},
      {
        payer: payer.publicKey,
        ...a,
        buffer_game: mb.delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
          a.game,
          ID,
        ),
        delegation_record_game: mb.delegationRecordPdaFromDelegatedAccount(
          a.game,
        ),
        delegation_metadata_game: mb.delegationMetadataPdaFromDelegatedAccount(
          a.game,
        ),
      },
    ),
  ]);
  for (let i = 0; i < 100; i++) {
    try {
      const m = await account(er, a.game, 'MatchState');
      if (m.humans > 0) break;
    } catch {}
    await sleep(250);
  }
  await send(er, session, [
    ix(
      'request_seed',
      {},
      {
        payer: session.publicKey,
        game: a.game,
        program_identity: pda([b('identity')]),
      },
    ),
  ]);
  let m;
  for (let i = 0; i < 100; i++) {
    m = await account(er, a.game, 'MatchState');
    if (m.status === 1) break;
    await sleep(250);
  }
  assert.equal(m.status, 1, 'VRF fulfilled');
  const crank_signer = PublicKey.findProgramAddressSync(
    [b('crank-executor'), a.game.toBuffer()],
    new PublicKey('Crank11111111111111111111111111111111111111'),
  )[0];
  await send(er, session, [
    ix('start_crank', {}, { game: a.game, crank_signer }),
  ]);
  return m;
}
try {
  assert.equal(
    await base.getGenesisHash(),
    'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  );
  pass('Base RPC is Solana Devnet');
  const ws = Array.from({ length: 8 }, () => Keypair.generate()),
    ss = Array.from({ length: 8 }, () => Keypair.generate());
  fs.writeFileSync(
    'scripts/.wallets/integration.json',
    JSON.stringify({
      wallets: ws.map((w) => [...w.secretKey]),
      sessions: ss.map((s) => [...s.secretKey]),
    }),
  );
  for (let i = 0; i < 8; i += 2)
    await send(
      base,
      payer,
      ws.slice(i, i + 2).flatMap((w, j) => [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: w.publicKey,
          lamports: 40_000_000,
        }),
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: ss[i + j].publicKey,
          lamports: 4_000_000,
        }),
      ]),
    );
  const lobby = await create(true);
  await join(lobby, ws[0], ss[0], 0);
  let e = await account(base, lobby.escrow, 'Escrow');
  assert.equal(e.total.toNumber(), 10_000_000);
  pass('Wager deposit is exactly 0.01 SOL');
  await expectFailure('duplicate join', () => join(lobby, ws[0], ss[0], 0));
  await expectFailure('session cannot withdraw wallet funds', () =>
    send(base, ss[0], [
      ix('withdraw', {}, { payer: ss[0].publicKey, ...lobby }),
    ]),
  );
  await expectFailure('early refund', () =>
    send(base, ws[0], [ix('refund', {}, { payer: ws[0].publicKey, ...lobby })]),
  );
  await send(base, ws[0], [
    ix('withdraw', {}, { payer: ws[0].publicKey, ...lobby }),
  ]);
  e = await account(base, lobby.escrow, 'Escrow');
  assert.equal(e.total.toNumber(), 0);
  assert.equal((await account(base, lobby.room, 'Room')).count, 0);
  pass('Pre-start withdrawal restores stake and removes seat');
  const a = await create(true);
  fs.writeFileSync(
    'test-results/active-match.json',
    JSON.stringify({
      room: a.room.toBase58(),
      game: a.game.toBase58(),
      escrow: a.escrow.toBase58(),
    }),
  );
  for (let i = 0; i < 8; i++) {
    await join(a, ws[i], ss[i], i);
    await send(base, ws[i], [
      ix('ready', {}, { payer: ws[i].publicKey, room: a.room }),
    ]);
  }
  e = await account(base, a.escrow, 'Escrow');
  assert.equal(e.total.toNumber(), 80_000_000);
  pass('Eight distinct wallets fund an exact 0.08 SOL pot');
  await sleep(9000);
  let m = await activate(a, ss[0]);
  pass('Delegation, VRF fulfillment, and authenticated crank start');
  await expectFailure('forged tick', () =>
    send(er, ss[0], [
      ix('tick', {}, { game: a.game, crank_signer: ss[0].publicKey }),
    ]),
  );
  await expectFailure('unauthorized input', () =>
    send(er, payer, [
      ix(
        'input',
        { sequence: new BN(Date.now()), target: 5000 },
        { signer: payer.publicKey, game: a.game },
      ),
    ]),
  );
  await expectFailure('living player sabotage', () =>
    send(er, ss[0], [
      ix(
        'hazard',
        { sequence: new BN(Date.now()), kind: 0, x: 0, y: 0 },
        { signer: ss[0].publicKey, game: a.game },
      ),
    ]),
  );
  const seq = new BN(Date.now());
  await send(er, ss[0], [
    ix(
      'input',
      { sequence: seq, target: 5000 },
      { signer: ss[0].publicKey, game: a.game },
    ),
  ]);
  await expectFailure('replayed input sequence', () =>
    send(er, ss[0], [
      ix(
        'input',
        { sequence: seq, target: 5000 },
        { signer: ss[0].publicKey, game: a.game },
      ),
    ]),
  );
  await expectFailure('stake withdrawal after start', () =>
    send(base, ws[0], [ix('withdraw', {}, { payer: ws[0].publicKey, ...a })]),
  );
  await expectFailure('session cannot renew wallet authority', () =>
    send(er, ss[7], [
      ix(
        'renew_session',
        { session: ss[7].publicKey },
        { signer: ss[7].publicKey, game: a.game },
      ),
    ]),
  );
  await send(er, ws[7], [
    ix(
      'renew_session',
      { session: ws[7].publicKey },
      { signer: ws[7].publicKey, game: a.game },
    ),
  ]);
  await expectFailure('old session revoked after renewal', () =>
    send(er, ss[7], [
      ix(
        'input',
        { sequence: new BN(Date.now()), target: 5000 },
        { signer: ss[7].publicKey, game: a.game },
      ),
    ]),
  );
  ss[7] = ws[7];
  pass('Wallet-authorized ER reconnect revokes the old session');
  let snapshot = ps(m.data),
    snapshots = 0,
    maxTick = 0,
    lastSnapshot = Date.now();
  let logCount = 0;
  const logSub = er.onLogs(
    a.game,
    (result) => {
      if (
        result.signature &&
        result.logs.some(
          (l) =>
            l.includes('Instruction: Tick') || l.includes('Instruction: Input'),
        )
      )
        logCount++;
    },
    'confirmed',
  );
  const sub = er.onAccountChange(
    a.game,
    (info) => {
      m = decode('MatchState', info.data);
      snapshot = ps(m.data);
      maxTick = Math.max(maxTick, snapshot.game.tick);
      snapshots++;
      lastSnapshot = Date.now();
    },
    { commitment: 'confirmed' },
  );
  let hash = (await er.getLatestBlockhash()).blockhash,
    hashTime = Date.now();
  const latencies = [],
    sigs = [];
  let survivor = -1,
    transportErrors = 0;
  const start = Date.now();
  let lastLog = start,
    round = 0;
  while (Date.now() - start < 150000 && m.status === 1) {
    if (Date.now() - hashTime > 5000) {
      try {
        hash = (await er.getLatestBlockhash()).blockhash;
        hashTime = Date.now();
      } catch (e) {
        if (!/fetch failed|ECONNRESET|429|503/.test(String(e))) throw e;
        transportErrors++;
        await sleep(300);
        continue;
      }
    }
    if (Date.now() - lastSnapshot > 2000) {
      try {
        m = await account(er, a.game, 'MatchState');
        snapshot = ps(m.data);
        lastSnapshot = Date.now();
      } catch (e) {
        if (!/fetch failed|ECONNRESET|429|503/.test(String(e))) throw e;
        transportErrors++;
        await sleep(300);
        continue;
      }
    }
    if (Date.now() - start > 15000 && survivor < 0) {
      survivor = snapshot.game.players.findIndex((p) => p.lives > 0);

      console.log('Disconnecting all rivals except', survivor);
    }
    const cycle = Date.now();
    const calls = [];
    for (let i = 0; i < 8; i++) {
      if (survivor >= 0 && i !== survivor) continue;
      const wall = snapshot.walls.find((w) => w.player === i);
      let target = 5000;
      if (wall) {
        const ball = snapshot.game.balls.reduce(
          (a, b) =>
            !a ||
            b.p.x * wall.n.x + b.p.y * wall.n.y <
              a.p.x * wall.n.x + a.p.y * wall.n.y
              ? b
              : a,
          null,
        );
        if (ball) {
          const dx = wall.b.x - wall.a.x,
            dy = wall.b.y - wall.a.y;
          target = Math.round(
            Math.max(
              1400,
              Math.min(
                8600,
                (((ball.p.x + ball.v.x * 3 - wall.a.x) * dx +
                  (ball.p.y + ball.v.y * 3 - wall.a.y) * dy) /
                  (dx * dx + dy * dy)) *
                  10000,
              ),
            ),
          );
        }
      }
      const tx = new Transaction({
        blockhash: hash,
        lastValidBlockHeight: 0,
        feePayer: ss[i].publicKey,
      }).add(
        ix(
          'input',
          { sequence: new BN(Date.now() * 10 + (round % 10)), target },
          { signer: ss[i].publicKey, game: a.game },
        ),
      );
      tx.sign(ss[i]);
      const sent = Date.now();
      calls.push(
        er
          .sendRawTransaction(tx.serialize(), {
            skipPreflight: true,
            maxRetries: 0,
          })
          .then((sig) => {
            latencies.push(Date.now() - sent);
            sigs.push(sig);
          }),
      );
    }
    const outcomes = await Promise.allSettled(calls);
    for (const r of outcomes)
      if (r.status === 'rejected') {
        if (!/fetch failed|ECONNRESET|429|503/.test(String(r.reason)))
          throw r.reason;
        transportErrors++;
      }
    round++;
    if (Date.now() - lastLog > 5000) {
      console.log(
        'Live tick',
        maxTick,
        'snapshots',
        snapshots,
        'submissions',
        sigs.length,
        'transport retries',
        transportErrors,
      );
      lastLog = Date.now();
    }
    await sleep(Math.max(1, 100 - (Date.now() - cycle)));
  }
  await er.removeAccountChangeListener(sub);
  await er.removeOnLogsListener(logSub);
  assert.ok(logCount > 20);
  pass('Live RPC logs expose real input and physics transaction signatures');
  assert.equal(m.status, 2, 'Match reaches terminal state');
  assert.ok(maxTick > 40, 'Crank advanced independently');
  pass('Eight-client input streams, subscriptions, and match completion');
  const status = (await er.getSignatureStatuses(sigs.slice(0, 20))).value;
  assert.ok(
    status.every((s) => s && !s.err),
    'Accepted inputs execute successfully',
  );
  pass('Submitted session inputs execute without transaction errors');
  const finalEr = ps(m.data);
  assert.ok(finalEr.game.finished);
  const winner = finalEr.game.winner;
  const finalizers = await Promise.allSettled(
    ss
      .slice(0, 2)
      .map((s) =>
        send(er, s, [ix('finalize', {}, { payer: s.publicKey, game: a.game })]),
      ),
  );
  const successful = finalizers.find((r) => r.status === 'fulfilled');
  assert.ok(successful);
  const finalizeSig = successful.value;
  for (let i = 0; i < 100; i++) {
    const info = await base.getAccountInfo(a.game);
    if (info?.owner.equals(ID) && decode('MatchState', info.data).status === 2)
      break;
    await sleep(600);
  }
  const finalBase = await account(base, a.game, 'MatchState');
  assert.equal(finalBase.status, 2);
  assert.deepEqual([...finalBase.data], [...m.data]);
  pass('ER final state commits unchanged to Solana');
  pass(
    'Two clients can race finalization without blocking the committed result',
  );
  const before = winner >= 0 ? await base.getBalance(ws[winner].publicKey) : 0;
  const dest = winner >= 0 ? ws[winner].publicKey : payer.publicKey;
  const settlement = await send(base, payer, [
    ix('settle', {}, { ...a, winner: dest }),
  ]);
  if (winner >= 0) {
    const after = await base.getBalance(ws[winner].publicKey);
    assert.equal(after - before, 80_000_000);
    pass('Winner receives exactly 0.08 SOL');
    await send(base, payer, [ix('settle', {}, { ...a, winner: dest })]);
    assert.equal(await base.getBalance(ws[winner].publicKey), after);
    pass('Repeated settlement cannot pay twice');
    await expectFailure('refund after payout', () =>
      send(base, ws[0], [ix('refund', {}, { payer: ws[0].publicKey, ...a })]),
    );
  } else {
    for (let i = 0; i < 8; i++)
      await send(base, ws[i], [
        ix('refund', {}, { payer: ws[i].publicKey, ...a }),
      ]);
    assert.equal((await account(base, a.escrow, 'Escrow')).total.toNumber(), 0);
    pass('Draw returns all stakes');
  }
  latencies.sort((a, b) => a - b);
  report.matches.push({
    room: a.room.toBase58(),
    players: 8,
    submissions: sigs.length,
    snapshots,
    ticks: maxTick,
    winner,
    finalizeSig,
    settlement,
    transportErrors,
    p95SubmissionMs: latencies[Math.floor(latencies.length * 0.95)],
    elapsedMs: Date.now() - start,
  });
  const next = pda([
    b('match'),
    a.room.toBuffer(),
    new BN(1).toArrayLike(Buffer, 'le', 8),
  ]);
  await send(base, payer, [
    ix('next_round', {}, { payer: payer.publicKey, ...a, game: next }),
  ]);
  assert.equal((await account(base, a.room, 'Room')).round.toNumber(), 1);
  pass(
    'Same invite room starts a fresh empty round without recharging players',
  );
  report.finished = new Date().toISOString();
  report.result = 'PASS';
} catch (e) {
  report.result = 'FAIL';
  report.error = e.stack;
  console.error(e);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    'test-results/devnet-integration.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  process.exit(process.exitCode || 0);
}
