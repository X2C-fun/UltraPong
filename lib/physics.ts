import { SnapshotBuffer } from './snapshot-buffer';
export type Vec = { x: number; y: number };
export type Player = {
  lives: number;
  pos: number;
  target: number;
  bot: boolean;
  hits: number;
  cooldown: number;
  shield: number;
};
export type Ball = { p: Vec; v: Vec; last: number; wait: number };
export type Hazard = {
  p: Vec;
  kind: number;
  owner: number;
  expires: number;
  phase: number;
};
export type Powerup = { p: Vec; kind: number; expires: number };
export type PaddleEffect = { half: number; expires: number };
export type Game = {
  tick: number;
  players: Player[];
  balls: Ball[];
  hazards: Hazard[];
  pause: number;
  winner: number;
  finished: boolean;
  sabotage: boolean;
  generation: number;
  stage_tick: number;
  effects: PaddleEffect[];
  powerups: Powerup[];
  event: number;
  event_player: number;
  event_tick: number;
};
export type Wall = { a: Vec; b: Vec; n: Vec; player: number };
export type Snapshot = { game: Game; walls: Wall[] };
export function ballVisualPosition(
  ball: Ball,
  walls: Wall[],
  fraction: number,
): Vec {
  let travel = Math.max(0, Math.min(1, fraction));
  for (const wall of walls) {
    const distance =
      ((ball.p.x - wall.a.x) * wall.n.x + (ball.p.y - wall.a.y) * wall.n.y) /
      100000;
    const speed = (ball.v.x * wall.n.x + ball.v.y * wall.n.y) / 100000;
    if (speed < 0)
      travel = Math.min(travel, Math.max(0, (distance - 1500) / -speed));
  }
  return { x: ball.p.x + ball.v.x * travel, y: ball.p.y + ball.v.y * travel };
}
// A wall's coordinate can run right-to-left after the camera rotates it to the bottom.
export function keyboardTarget(
  wall: Wall,
  rotation: number,
  target: number,
  direction: number,
  elapsedMs: number,
) {
  const screenTangentX =
    (wall.b.x - wall.a.x) * Math.cos(rotation) -
    (wall.b.y - wall.a.y) * Math.sin(rotation);
  return Math.max(
    1400,
    Math.min(
      8600,
      target +
        direction * Math.sign(screenTangentX) * Math.min(elapsedMs, 100) * 18,
    ),
  );
}
export function acceptsPaddlePointer(pointerType: string) {
  return (
    pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen'
  );
}
export function paddleHalf(game: Game, player: number) {
  const effect = game.effects?.[player];
  return effect && effect.expires > game.tick ? effect.half : 1400;
}
// Presentation only. Match collisions and payouts always use authoritative physics.
export function visualPaddlePosition(
  position: number,
  target: number,
  half: number,
  elapsedMs: number,
) {
  const goal = Math.max(half, Math.min(10000 - half, target));
  const step = 14 * Math.max(0, Math.min(elapsedMs, 100));
  return Math.max(
    half,
    Math.min(
      10000 - half,
      position + Math.max(-step, Math.min(step, goal - position)),
    ),
  );
}
type Exports = {
  memory: WebAssembly.Memory;
  game_init: (n: number, s: number, b: number, h: number) => void;
  game_step: () => void;
  game_input: (p: number, t: number) => void;
  game_place: (p: number, k: number, x: number, y: number) => number;
  game_placement: (p: number, k: number, x: number, y: number) => number;
  game_snapshot: () => number;
  game_snapshot_len: () => number;
  game_load_buffer: (n: number) => number;
  game_load: () => number;
};
let modulePromise: Promise<WebAssembly.Module> | undefined;
export class Physics {
  readonly networkFrames = new SnapshotBuffer();
  private e: Exports;
  private cached?: Snapshot;
  private constructor(instance: WebAssembly.Instance) {
    this.e = instance.exports as unknown as Exports;
  }
  static async create() {
    modulePromise ??= fetch('/physics.wasm')
      .then((r) => {
        if (!r.ok)
          throw Error('The game engine could not load. Refresh to retry.');
        return r.arrayBuffer();
      })
      .then((b) => WebAssembly.compile(b));
    return new Physics(await WebAssembly.instantiate(await modulePromise));
  }
  init(
    count = 8,
    seed = crypto.getRandomValues(new Uint32Array(1))[0],
    bots = 254,
    sabotage = true,
  ) {
    this.networkFrames.clear();
    this.cached = undefined;
    this.e.game_init(count, seed, bots, +sabotage);
    return this.snapshot();
  }
  step() {
    this.cached = undefined;
    this.e.game_step();
  }
  input(player: number, target: number) {
    this.cached = undefined;
    this.e.game_input(player, Math.round(target));
  }
  placement(player: number, kind: number, p: Vec) {
    return this.e.game_placement(
      player,
      kind,
      Math.round(p.x),
      Math.round(p.y),
    );
  }
  place(player: number, kind: number, p: Vec) {
    this.cached = undefined;
    return !!this.e.game_place(player, kind, Math.round(p.x), Math.round(p.y));
  }
  load(bytes: Uint8Array) {
    this.cached = undefined;
    const ptr = this.e.game_load_buffer(bytes.length);
    new Uint8Array(this.e.memory.buffer, ptr, bytes.length).set(bytes);
    if (!this.e.game_load()) throw Error('Invalid match snapshot');
  }
  snapshot(): Snapshot {
    if (this.cached) return this.cached;
    const ptr = this.e.game_snapshot();
    const bytes = new Uint8Array(
      this.e.memory.buffer,
      ptr,
      this.e.game_snapshot_len(),
    );
    return (this.cached = JSON.parse(new TextDecoder().decode(bytes)));
  }
}
export const COLORS = [
  '#c8ff57',
  '#6ce3ff',
  '#b7a0ff',
  '#ff8bcb',
  '#ff8564',
  '#ffe181',
  '#6af0ba',
  '#8ea8ff',
];
