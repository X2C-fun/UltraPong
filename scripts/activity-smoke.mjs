// A short, free Devnet match for watching the read-only activity panel.
import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import {
  base,
  er,
  payer,
  ID,
  ix,
  send,
  account,
  sleep,
} from './test-utils.mjs';
import { create, join, activate } from './match-utils.mjs';
const keys = JSON.parse(fs.readFileSync('scripts/.wallets/integration.json'));
const wallet = Keypair.fromSecretKey(Uint8Array.from(keys.wallets[0])),
  session = Keypair.fromSecretKey(Uint8Array.from(keys.sessions[0]));
const a = await create(false);
await join(a, wallet, session, 0);
await send(base, wallet, [
  ix('ready', {}, { payer: wallet.publicKey, room: a.room }),
]);
fs.writeFileSync(
  'test-results/activity-room.json',
  JSON.stringify({ room: a.room.toBase58(), game: a.game.toBase58() }),
);
console.log('Activity room', a.room.toBase58());
await sleep(12000);
await activate(a, session);
console.log('ER clock started');
let m;
for (let i = 0; i < 70; i++) {
  m = await account(er, a.game, 'MatchState');
  if (m.status === 2) break;
  await sleep(500);
}
if (m.status !== 2) throw Error('Abandoned room did not end');
await send(er, session, [
  ix('finalize', {}, { payer: session.publicKey, game: a.game }),
]);
for (let i = 0; i < 100; i++) {
  if ((await base.getAccountInfo(a.game))?.owner.equals(ID)) break;
  await sleep(600);
}
await send(base, payer, [ix('settle', {}, { ...a, winner: payer.publicKey })]);
console.log('Activity room completed and settled');
process.exit(0);
