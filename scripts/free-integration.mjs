import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import {
  base,
  er,
  payer,
  ID,
  BN,
  ix,
  send,
  account,
  sleep,
  expectFailure,
  physics,
} from './test-utils.mjs';
import { create, join, activate } from './match-utils.mjs';
const keys = JSON.parse(fs.readFileSync('scripts/.wallets/integration.json'));
const wallet = Keypair.fromSecretKey(Uint8Array.from(keys.wallets[0]));
const session = Keypair.fromSecretKey(Uint8Array.from(keys.sessions[0]));
const ps = await physics(),
  checks = [];
const pass = (s) => {
  checks.push(s);
  console.log('PASS', s);
};
async function run(abandon) {
  const a = await create(false);
  await join(a, wallet, session, 0);
  await send(base, wallet, [
    ix('ready', {}, { payer: wallet.publicKey, room: a.room }),
  ]);
  await sleep(8500);
  await activate(a, session);
  let m = await account(er, a.game, 'MatchState'),
    s = ps(m.data);
  assert.equal(s.game.players.length, 8);
  assert.equal(s.game.players.filter((p) => p.bot).length, 7);
  assert.equal((await account(base, a.escrow, 'Escrow')).total.toNumber(), 0);
  pass('Free room fills seven bots without a wager');
  await expectFailure('late player cannot join a running round', () =>
    join(a, payer, session, 1),
  );
  let dropped = false;
  const start = Date.now();
  while (m.status === 1 && Date.now() - start < 305000) {
    if (!abandon) {
      try {
        await send(er, session, [
          ix(
            'input',
            { sequence: new BN(Date.now()), target: 1400 },
            { signer: session.publicKey, game: a.game },
          ),
        ]);
      } catch (e) {
        m = await account(er, a.game, 'MatchState');
        s = ps(m.data);
        if (m.status === 2) break;
        throw e;
      }
      if (s.game.players[0].lives === 0 && !dropped) {
        await send(er, session, [
          ix(
            'hazard',
            { sequence: new BN(Date.now()), kind: 0, x: 0, y: 0 },
            { signer: session.publicKey, game: a.game },
          ),
        ]);
        dropped = true;
        pass('Eliminated player places a real ER hazard');
        await expectFailure('hazard cooldown enforced', () =>
          send(er, session, [
            ix(
              'hazard',
              { sequence: new BN(Date.now()), kind: 1, x: 30000, y: 0 },
              { signer: session.publicKey, game: a.game },
            ),
          ]),
        );
      }
    }
    await sleep(700);
    m = await account(er, a.game, 'MatchState');
    s = ps(m.data);
  }
  assert.equal(m.status, 2);
  if (abandon) {
    assert.equal(s.game.winner, -1);
    assert.ok(Date.now() - start < 30000);
    pass(
      'Abandoned free room ends as a draw after the disconnect grace period',
    );
  } else {
    assert.ok(s.game.winner > 0, 'A bot wins the stationary-paddle scenario');
    assert.ok(dropped);
    pass('Free bot match advances to completion');
  }
  await send(er, session, [
    ix('finalize', {}, { payer: session.publicKey, game: a.game }),
  ]);
  for (let i = 0; i < 100; i++) {
    const info = await base.getAccountInfo(a.game);
    if (info?.owner.equals(ID)) break;
    await sleep(600);
  }
  await send(base, payer, [
    ix('settle', {}, { ...a, winner: payer.publicKey }),
  ]);
  assert.equal((await account(base, a.escrow, 'Escrow')).total.toNumber(), 0);
  pass('Free match settles with zero payout, including bot winners');
  return { room: a.room.toBase58(), winner: s.game.winner, ticks: s.game.tick };
}
try {
  const matches = [await run(false), await run(true)];
  fs.writeFileSync(
    'test-results/free-integration.json',
    JSON.stringify({ result: 'PASS', checks, matches }, null, 2),
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode || 0);
}
