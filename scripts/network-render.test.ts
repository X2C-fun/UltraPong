import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer } from '../lib/snapshot-buffer';
import { roomCode, parseRoomCode, ROOM_CODE_SPACE } from '../lib/room-code';
import type { Snapshot } from '../lib/physics';
import { ballVisualPosition } from '../lib/physics';
function state(tick: number, x: number): Snapshot {
  return {
    walls: [],
    game: {
      tick,
      players: [],
      balls: [{ p: { x, y: 0 }, v: { x: 100, y: 0 }, last: -1, wait: 0 }],
      generation: 0,
      hazards: [],
      pause: 0,
      winner: -1,
      finished: false,
      sabotage: true,
      stage_tick: tick,
      effects: [],
      powerups: [],
      event: 0,
      event_tick: 0,
      event_player: -1,
    },
  };
}
await test('warmup interpolation stops at the paddle plane until physics resolves the bounce', () => {
  const position = ballVisualPosition(
    { p: { x: 0, y: 96000 }, v: { x: 0, y: 11500 }, last: -1, wait: 0 },
    [
      {
        a: { x: -100000, y: 100000 },
        b: { x: 100000, y: 100000 },
        n: { x: 0, y: -100000 },
        player: 0,
      },
    ],
    1,
  );
  assert.equal(position.y, 98500);
});
await test('six-character codes preserve leading zeros and round-trip case-insensitively', () => {
  for (const n of [0, 1, 35, 1001, ROOM_CODE_SPACE - 1]) {
    const code = roomCode(n)!;
    assert.match(code, /^[A-Z0-9]{6}$/);
    assert.equal(parseRoomCode(code.toLowerCase()), n);
  }
  assert.equal(roomCode(ROOM_CODE_SPACE), undefined);
  assert.throws(() => parseRoomCode('ABC!12'));
});
await test('network balls interpolate confirmed positions, never extrapolate during a stall', () => {
  const frames = new SnapshotBuffer();
  frames.push(state(1, 0), 100);
  frames.push(state(2, 100), 150);
  assert.equal(frames.sample(205)!.game.balls[0].p.x, 50);
  assert.equal(frames.sample(10000)!.game.balls[0].p.x, 100);
  frames.push(state(1, -500), 160);
  assert.equal(frames.sample(10000)!.game.tick, 2);
});
await test('a bounce or arena collapse cannot interpolate through a wall or reset', () => {
  const frames = new SnapshotBuffer();
  frames.push(state(1, 90), 100);
  const bounced = state(2, 80);
  bounced.game.balls[0].v.x = -100;
  frames.push(bounced, 150);
  assert.equal(frames.sample(205)!.game.balls[0].p.x, 90);
  const collapsed = state(3, 0);
  collapsed.game.generation = 1;
  frames.push(collapsed, 200);
  assert.equal(frames.sample(255)!.game.generation, 0);
  assert.equal(frames.sample(300)!.game.generation, 1);
  frames.clear();
  assert.equal(frames.sample(300), undefined);
});
