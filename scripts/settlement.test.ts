import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureCommitted, isTerminalRace } from '../lib/settlement';
await test('losing client tolerates owner-change error once winner commits', async () => {
  let committed = false;
  let attempts = 0;
  await ensureCommitted({
    isCommitted: async () => committed,
    finalize: async () => {
      attempts++;
      throw Error(
        'Game transaction failed: {"InstructionError":[1,{"Custom":3007}]}',
      );
    },
    wait: async () => {
      committed = true;
    },
  });
  assert.equal(attempts, 1);
  assert.ok(committed);
});
await test('already committed result does not send another finalize', async () => {
  let calls = 0;
  await ensureCommitted({
    isCommitted: async () => true,
    finalize: async () => {
      calls++;
    },
    wait: async () => {},
  });
  assert.equal(calls, 0);
});
await test('real finalization failure is not hidden', async () => {
  await assert.rejects(
    ensureCommitted({
      isCommitted: async () => false,
      finalize: async () => {
        throw Error('Unauthorized');
      },
      wait: async () => {},
    }),
    /Unauthorized/,
  );
});
await test('terminal transaction races are distinct from an invalid session', () => {
  assert.ok(isTerminalRace(Error('{"Custom":3007}')));
  assert.ok(isTerminalRace(Error('{"Custom":6006}')));
  assert.equal(isTerminalRace(Error('{"Custom":6003}')), false);
});
