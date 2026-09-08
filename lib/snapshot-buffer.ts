import type { Snapshot } from './physics';

// Render confirmed motion slightly behind the head instead of extrapolating
// untested ball positions through a paddle and rolling back on the next update.
export class SnapshotBuffer {
  private frames: { at: number; state: Snapshot }[] = [];
  clear() {
    this.frames = [];
  }
  push(state: Snapshot, at: number) {
    const previous = this.frames.at(-1);
    if (previous && state.game.tick < previous.state.game.tick) return;
    if (previous && state.game.tick === previous.state.game.tick) {
      previous.state = state;
      return;
    }
    this.frames.push({ at, state });
    this.frames = this.frames.slice(-12);
  }
  sample(now: number): Snapshot | undefined {
    const latest = this.frames.at(-1);
    if (!latest) return;
    if (latest.state.game.finished) return latest.state;
    const time = now - 80;
    const next = this.frames.findIndex((f) => f.at >= time);
    if (next < 0) return latest.state; // Freeze on connection loss, never invent a bounce.
    if (next === 0) return this.frames[0].state;
    const a = this.frames[next - 1],
      b = this.frames[next];
    if (a.state.game.generation !== b.state.game.generation) return a.state;
    const t = Math.max(
      0,
      Math.min(1, (time - a.at) / Math.max(1, b.at - a.at)),
    );
    const mix = (x: number, y: number) => x + (y - x) * t;
    return {
      walls: a.state.walls,
      game: {
        ...a.state.game,
        players: a.state.game.players.map((p, i) => ({
          ...p,
          pos: mix(p.pos, b.state.game.players[i].pos),
        })),
        balls: a.state.game.balls.map((ball, i) => {
          const end = b.state.game.balls[i];
          // A serve/reset, split, or return changes the trajectory: do not draw a
          // straight line across that discontinuity.
          if (
            !end ||
            a.state.game.balls.length !== b.state.game.balls.length ||
            ball.wait ||
            end.wait ||
            ball.last !== end.last ||
            ball.v.x * end.v.x + ball.v.y * end.v.y <= 0
          )
            return ball;
          return {
            ...ball,
            p: { x: mix(ball.p.x, end.p.x), y: mix(ball.p.y, end.p.y) },
          };
        }),
      },
    };
  }
}
