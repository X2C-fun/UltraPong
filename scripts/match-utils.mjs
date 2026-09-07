import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
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
  sleep,
} from './test-utils.mjs';
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
export { create, join, activate };
