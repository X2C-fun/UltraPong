import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  keyboardTarget,
  acceptsPaddlePointer,
  visualPaddlePosition,
  type Snapshot,
} from '../lib/physics';
async function fixture(count: number) {
  const wasmModule = await WebAssembly.compile(
    new Uint8Array(fs.readFileSync('public/physics.wasm')),
  );
  const instance = await WebAssembly.instantiate(wasmModule);
  const e = instance.exports as unknown as {
    memory: WebAssembly.Memory;
    game_init: (n: number, s: number, b: number, h: number) => void;
    game_snapshot: () => number;
    game_snapshot_len: () => number;
    game_input: (p: number, t: number) => void;
    game_step: () => void;
  };
  e.game_init(count, 12, 0, 1);
  const snapshot = () => {
    const p = e.game_snapshot();
    return JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(e.memory.buffer, p, e.game_snapshot_len()),
      ),
    ) as Snapshot;
  };
  return { e, snapshot };
}
await test('left and right move in screen direction for every player and every arena size', async () => {
  for (let n = 2; n <= 8; n++) {
    for (let player = 0; player < n; player++) {
      for (const direction of [-1, 1]) {
        const { e, snapshot } = await fixture(n);
        const before = snapshot();
        const wall = before.walls.find((w) => w.player === player)!;
        const rotation =
          Math.PI / 2 -
          Math.atan2((wall.a.y + wall.b.y) / 2, (wall.a.x + wall.b.x) / 2);
        const screenX = (position: number) => {
          const x = wall.a.x + ((wall.b.x - wall.a.x) * position) / 10000,
            y = wall.a.y + ((wall.b.y - wall.a.y) * position) / 10000;
          return x * Math.cos(rotation) - y * Math.sin(rotation);
        };
        const target = keyboardTarget(wall, rotation, 5000, direction, 50);
        e.game_input(player, target);
        e.game_step();
        const after = snapshot();
        assert.equal(
          Math.sign(
            screenX(after.game.players[player].pos) -
              screenX(before.game.players[player].pos),
          ),
          direction,
          JSON.stringify({ n, player, direction }),
        );
      }
    }
  }
});
await test('keyboard holds stop at the paddle boundary', async () => {
  const { e, snapshot } = await fixture(2);
  const wall = snapshot().walls.find((w) => w.player === 0)!;
  let target = 5000;
  for (let i = 0; i < 50; i++) {
    target = keyboardTarget(wall, 0, target, 1, 50);
    e.game_input(0, target);
    e.game_step();
  }
  assert.equal(snapshot().game.players[0].pos, 1400);
});
await test('mouse, touch and pen can move a paddle', () => {
  assert.equal(acceptsPaddlePointer('mouse'), true);
  assert.equal(acceptsPaddlePointer('touch'), true);
  assert.equal(acceptsPaddlePointer('pen'), true);
  assert.equal(acceptsPaddlePointer(''), false);
});
await test('local paddle progresses smoothly at 60 Hz despite delayed server positions', () => {
  let position = 5000;
  for (let frame = 0; frame < 12; frame++) {
    const next = visualPaddlePosition(position, 8000, 1400, 1000 / 60);
    assert.ok(next >= position && next - position <= 234);
    position = next;
  }
  assert.ok(position > 7700);
  assert.equal(visualPaddlePosition(8500, 9000, 2100, 16), 7900);
  assert.ok(visualPaddlePosition(position, 5000, 1400, 16) > position - 225);
});
