import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  base,
  er,
  payer,
  ID,
  ix,
  send,
  account,
  sleep,
  physics,
} from './test-utils.mjs';
const a = Object.fromEntries(
  Object.entries(
    JSON.parse(fs.readFileSync('test-results/active-match.json')),
  ).map(([k, v]) => [k, new PublicKey(v)]),
);
const keys = JSON.parse(fs.readFileSync('scripts/.wallets/integration.json'));
const wallets = keys.wallets.map((k) =>
    Keypair.fromSecretKey(Uint8Array.from(k)),
  ),
  sessions = keys.sessions.map((k) =>
    Keypair.fromSecretKey(Uint8Array.from(k)),
  );
const report = { room: a.room.toBase58(), checks: [], receipts: [] };
const e = await account(base, a.escrow, 'Escrow');
if (e.state === 1) {
  console.log('Already paid');
  process.exit(0);
}
if (Date.now() / 1000 >= e.deadline.toNumber() || e.state === 2) {
  for (let i = 0; i < wallets.length; i++) {
    if (e.refunded[i]) continue;
    const before = await base.getBalance(wallets[i].publicKey);
    report.receipts.push(
      await send(base, wallets[i], [
        ix('refund', {}, { payer: wallets[i].publicKey, ...a }),
      ]),
    );
    assert.equal(
      (await base.getBalance(wallets[i].publicKey)) - before,
      9_995_000,
    );
  }
  assert.equal((await account(base, a.escrow, 'Escrow')).total.toNumber(), 0);
  report.checks.push(
    'Expired match returns every stake (less each wallet transaction fee)',
  );
} else {
  let info = await base.getAccountInfo(a.game);
  if (!info.owner.equals(ID)) {
    const m = await account(er, a.game, 'MatchState');
    assert.equal(m.status, 2);
    report.receipts.push(
      await send(er, sessions[0], [
        ix('finalize', {}, { payer: sessions[0].publicKey, game: a.game }),
      ]),
    );
    for (let i = 0; i < 100; i++) {
      info = await base.getAccountInfo(a.game);
      if (info.owner.equals(ID)) break;
      await sleep(600);
    }
  }
  const m = await account(base, a.game, 'MatchState');
  const s = (await physics())(m.data);
  const winner = s.game.winner;
  const destination = winner < 0 ? payer.publicKey : wallets[winner].publicKey;
  const before = await base.getBalance(destination);
  report.receipts.push(
    await send(base, payer, [ix('settle', {}, { ...a, winner: destination })]),
  );
  if (winner >= 0) {
    assert.equal(
      (await base.getBalance(destination)) - before,
      e.total.toNumber(),
    );
    report.checks.push('Entire pot paid to winner');
  } else {
    for (const w of wallets)
      report.receipts.push(
        await send(base, w, [ix('refund', {}, { payer: w.publicKey, ...a })]),
      );
    report.checks.push('Draw refunds every stake');
  }
}
fs.writeFileSync('test-results/recovery.json', JSON.stringify(report, null, 2));
console.log(report);
process.exit(0);
