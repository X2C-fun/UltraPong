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
  return pointerType === 'touch' || pointerType === 'pen';
}
export function paddleHalf(game: Game, player: number) {
  const effect = game.effects?.[player];
  return effect && effect.expires > game.tick ? effect.half : 1400;
}
type Exports = {
  memory: WebAssembly.Memory;
  game_init: (n: number, s: number, b: number, h: number) => void;
  game_step: () => void;
  game_input: (p: number, t: number) => void;
  game_place: (p: number, k: number, x: number, y: number) => number;
  game_snapshot: () => number;
  game_snapshot_len: () => number;
  game_load_buffer: (n: number) => number;
  game_load: () => number;
};
let modulePromise: Promise<WebAssembly.Module> | undefined;
export class Physics {
  private e: Exports;
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
    this.e.game_init(count, seed, bots, +sabotage);
    return this.snapshot();
  }
  step() {
    this.e.game_step();
  }
  input(player: number, target: number) {
    this.e.game_input(player, Math.round(target));
  }
  place(player: number, kind: number, p: Vec) {
    return !!this.e.game_place(player, kind, Math.round(p.x), Math.round(p.y));
  }
  load(bytes: Uint8Array) {
    const ptr = this.e.game_load_buffer(bytes.length);
    new Uint8Array(this.e.memory.buffer, ptr, bytes.length).set(bytes);
    if (!this.e.game_load()) throw Error('Invalid match snapshot');
  }
  snapshot(): Snapshot {
    const ptr = this.e.game_snapshot();
    const bytes = new Uint8Array(
      this.e.memory.buffer,
      ptr,
      this.e.game_snapshot_len(),
    );
    return JSON.parse(new TextDecoder().decode(bytes));
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
