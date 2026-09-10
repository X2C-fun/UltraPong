use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

pub const Q: i64 = 100_000;
pub const MAX_TICKS: u32 = 6000;
pub const MAX_SPEED: i64 = 11_500;
#[derive(
    Clone, Copy, Default, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize, PartialEq,
)]
pub struct V {
    pub x: i64,
    pub y: i64,
}
impl V {
    pub fn new(x: i64, y: i64) -> Self {
        Self { x, y }
    }
    pub fn add(self, b: V) -> V {
        V::new(self.x + b.x, self.y + b.y)
    }
    pub fn sub(self, b: V) -> V {
        V::new(self.x - b.x, self.y - b.y)
    }
    pub fn scale(self, n: i64, d: i64) -> V {
        V::new(self.x * n / d, self.y * n / d)
    }
    pub fn dot(self, b: V) -> i64 {
        self.x * b.x + self.y * b.y
    }
    pub fn len(self) -> i64 {
        isqrt(self.dot(self) as u64) as i64
    }
    pub fn unit(self) -> V {
        self.scale(Q, self.len().max(1))
    }
}
fn isqrt(n: u64) -> u64 {
    if n < 2 {
        return n;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

#[derive(Clone, Default, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct Player {
    pub lives: u8,
    pub pos: i64,
    pub target: i64,
    pub bot: bool,
    pub hits: u32,
    pub cooldown: u32,
    pub shield: u32,
}
#[derive(Clone, Default, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct Ball {
    pub p: V,
    pub v: V,
    pub last: i8,
    pub wait: u32,
}
#[derive(Clone, Default, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct Hazard {
    pub p: V,
    pub kind: u8,
    pub owner: u8,
    pub expires: u32,
    pub phase: u32,
}
#[derive(Clone, Default, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct Powerup {
    pub p: V,
    pub kind: u8,
    pub expires: u32,
}
#[derive(Clone, Default, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct PaddleEffect {
    pub half: i64,
    pub expires: u32,
}
#[derive(Clone, Default, Debug, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
pub struct Game {
    pub tick: u32,
    pub players: Vec<Player>,
    pub balls: Vec<Ball>,
    pub hazards: Vec<Hazard>,
    pub rng: u64,
    pub pause: u32,
    pub winner: i8,
    pub finished: bool,
    pub sabotage: bool,
    pub generation: u32,
    pub stage_tick: u32,
    pub effects: Vec<PaddleEffect>,
    pub powerups: Vec<Powerup>,
    pub event: u8,
    pub event_player: i8,
    pub event_tick: u32,
}
// Previously created matches remain readable after this Devnet upgrade.
#[derive(BorshDeserialize, BorshSerialize)]
struct LegacyGame {
    tick: u32,
    players: Vec<Player>,
    balls: Vec<Ball>,
    hazards: Vec<Hazard>,
    rng: u64,
    pause: u32,
    winner: i8,
    finished: bool,
    sabotage: bool,
    generation: u32,
}
#[derive(Clone, Debug, Serialize)]
pub struct Wall {
    pub a: V,
    pub b: V,
    pub n: V,
    pub player: i8,
}

include!("trig.rs");
fn direction(i: usize) -> V {
    let v = TRIG[i % 64];
    V::new(v.0, v.1)
}
impl Game {
    pub fn from_bytes(bytes: &[u8]) -> std::io::Result<Self> {
        if let Ok(game) = borsh::from_slice::<Self>(bytes) {
            return Ok(game);
        }
        let g = borsh::from_slice::<LegacyGame>(bytes)?;
        Ok(Self {
            tick: g.tick,
            players: g.players,
            balls: g.balls,
            hazards: g.hazards,
            rng: g.rng,
            pause: g.pause,
            winner: g.winner,
            finished: g.finished,
            sabotage: g.sabotage,
            generation: g.generation,
            ..Self::default()
        })
    }
    pub fn start_speed(&self) -> i64 {
        (4200 + self.generation as i64 * 450).min(7800)
    }
    pub fn paddle_half(&self, p: usize) -> i64 {
        self.effects
            .get(p)
            .filter(|e| e.expires > self.tick)
            .map(|e| e.half)
            .unwrap_or(1400)
    }
    pub fn new(count: usize, seed: u64, bot_mask: u8, sabotage: bool) -> Self {
        let mut g = Self {
            rng: seed.max(1),
            winner: -1,
            sabotage,
            ..Self::default()
        };
        for i in 0..count.clamp(2, 8) {
            g.players.push(Player {
                lives: 2,
                pos: 5000,
                target: 5000,
                bot: bot_mask & (1 << i) != 0,
                ..Player::default()
            });
        }
        g.serve();
        // Shared by the ER and browser: no ball can move during 3-2-1.
        g.pause = 60;
        g.balls[0].wait = 0;
        g
    }
    fn random(&mut self) -> u64 {
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.rng = x;
        x
    }
    pub fn radius(&self) -> i64 {
        Q - ((self.tick.saturating_sub(2400) as i64) * 10).min(35_000)
    }
    pub fn alive(&self) -> Vec<usize> {
        self.players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.lives > 0)
            .map(|(i, _)| i)
            .collect()
    }
    pub fn walls(&self) -> Vec<Wall> {
        let alive = self.alive();
        let n = alive.len();
        if n < 2 {
            return vec![];
        };
        let r = self.radius();
        let vertices: Vec<V> = if n == 2 {
            vec![
                V::new(-r * 7 / 10, -r),
                V::new(r * 7 / 10, -r),
                V::new(r * 7 / 10, r),
                V::new(-r * 7 / 10, r),
            ]
        } else {
            POLYGONS[n - 3]
                .iter()
                .map(|v| V::new(v.0 * r / Q, v.1 * r / Q))
                .collect()
        };
        (0..vertices.len())
            .map(|i| {
                let a = vertices[i];
                let b = vertices[(i + 1) % vertices.len()];
                let t = b.sub(a).unit();
                Wall {
                    a,
                    b,
                    n: V::new(-t.y, t.x),
                    player: if n == 2 {
                        match i {
                            0 => alive[1] as i8,
                            2 => alive[0] as i8,
                            _ => -1,
                        }
                    } else {
                        alive[i] as i8
                    },
                }
            })
            .collect()
    }
    pub fn input(&mut self, p: usize, target: i64) {
        if let Some(pl) = self.players.get_mut(p) {
            pl.target = target.clamp(1400, 8600);
        }
    }
    fn serve(&mut self) {
        let d = direction((self.random() % 64) as usize);
        self.balls.push(Ball {
            p: V::default(),
            v: d.scale(self.start_speed(), Q),
            last: -1,
            wait: 10,
        });
    }
    fn reset_ball(&mut self, b: usize) {
        let d = direction((self.random() % 64) as usize);
        self.balls[b] = Ball {
            p: V::default(),
            v: d.scale(self.start_speed(), Q),
            last: -1,
            wait: 10,
        };
    }
    fn hazard_clearance(kind: u8) -> i64 {
        match kind {
            0 => 9_000,
            1 => 16_000,
            2 => 12_000,
            _ => 9_000,
        }
    }
    pub fn placement(&self, owner: usize, kind: u8, p: V) -> Result<(), &'static str> {
        if self.finished || !self.sabotage {
            return Err("Hazards are disabled");
        }
        if kind > 2 || owner >= self.players.len() || self.players[owner].lives > 0 {
            return Err("Only eliminated players can sabotage");
        }
        if self.tick < self.players[owner].cooldown {
            return Err("Hazard is cooling down");
        }
        if p.x.abs() > Q || p.y.abs() > Q {
            return Err("Place inside the arena");
        }
        for w in self.walls() {
            if p.sub(w.a).dot(w.n) / Q < 20_000 {
                return Err("Too close to a living wall");
            }
        }
        if self.hazards.len() >= 12 {
            return Err("Hazard limit reached");
        }
        let clearance = Self::hazard_clearance(kind);
        if self.hazards.iter().any(|h| {
            h.p.sub(p).len()
                < clearance + Self::hazard_clearance(h.kind)
        }) {
            return Err("Too close to another hazard");
        }
        Ok(())
    }
    pub fn placement_code(&self, owner: usize, kind: u8, p: V) -> u8 {
        match self.placement(owner, kind, p) {
            Ok(()) => 0,
            Err("Hazards are disabled") => 1,
            Err("Only eliminated players can sabotage") => 2,
            Err("Hazard is cooling down") => 3,
            Err("Place inside the arena") => 4,
            Err("Too close to a living wall") => 5,
            Err("Hazard limit reached") => 6,
            Err("Too close to another hazard") => 7,
            Err(_) => 8,
        }
    }
    pub fn place(&mut self, owner: usize, kind: u8, p: V) -> Result<(), &'static str> {
        self.placement(owner, kind, p)?;
        self.hazards.push(Hazard {
            p,
            kind,
            owner: owner as u8,
            expires: u32::MAX,
            phase: self.tick,
        });
        self.players[owner].cooldown = self.tick + 160;
        Ok(())
    }
    pub fn eliminate(&mut self, p: usize) {
        if self.players[p].lives > 0 {
            self.players[p].lives = 0;
            self.rebuild();
        }
    }
    fn rebuild(&mut self) {
        self.generation += 1;
        self.hazards.clear();
        let alive = self.alive();
        if alive.len() < 2 {
            self.finished = true;
            self.winner = alive.first().map(|p| *p as i8).unwrap_or(-1);
            return;
        }
        self.pause = 14;
        self.stage_tick = 0;
        self.balls.clear();
        self.serve();
        self.powerups.clear();
    }
    pub fn step(&mut self) {
        if self.finished {
            return;
        }
        self.tick += 1;
        if self.tick >= MAX_TICKS {
            let mut order: Vec<_> = self
                .players
                .iter()
                .enumerate()
                .filter(|(_, p)| p.lives > 0)
                .collect();
            order.sort_by_key(|(_, p)| (p.lives, p.hits));
            self.winner = if order.len() > 1
                && (
                    order[order.len() - 1].1.lives,
                    order[order.len() - 1].1.hits,
                ) == (
                    order[order.len() - 2].1.lives,
                    order[order.len() - 2].1.hits,
                ) {
                -1
            } else {
                order.last().map(|(i, _)| *i as i8).unwrap_or(-1)
            };
            self.finished = true;
            return;
        }
        let walls = self.walls();
        for i in 0..self.players.len() {
            if self.players[i].bot && self.players[i].lives > 0 && self.tick % 4 == 0 {
                if let Some(w) = walls.iter().find(|w| w.player == i as i8) {
                    let tangent = w.b.sub(w.a);
                    let ball = self.balls.iter().min_by_key(|b| b.p.sub(w.a).dot(w.n));
                    if let Some(b) = ball {
                        let aim = b.p.add(b.v.scale(3, 1));
                        let mut target = aim.sub(w.a).dot(tangent) * 10000 / tangent.dot(tangent);
                        target += (self.random() % 2000) as i64 - 1000;
                        self.players[i].target = target.clamp(1400, 8600);
                    }
                }
            }
            let half = self.paddle_half(i);
            let pl = &mut self.players[i];
            let speed = if pl.bot { 370 } else { 700 };
            pl.pos += (pl.target.clamp(half, 10000 - half) - pl.pos).clamp(-speed, speed);
            pl.pos = pl.pos.clamp(half, 10000 - half);
        }
        if self.pause > 0 {
            self.pause -= 1;
            return;
        }
        self.stage_tick += 1;
        self.powerups.retain(|p| p.expires > self.tick);
        if self.stage_tick >= 100 && (self.stage_tick - 100) % 240 == 0 {
            if let Some(p) = self.clear_center(12_000) {
                let kind = (self.random() % 3) as u8;
                self.powerups.clear();
                self.powerups.push(Powerup {
                    p,
                    kind,
                    expires: self.tick + 220,
                });
                self.event = 4;
                self.event_tick = self.tick;
            }
        }
        if self.tick >= 360 && (self.tick - 360) % 400 == 0 && self.hazards.len() < 12 {
            if let Some(p) = self.clear_center(24_000) {
                let kind = if self.random() % 2 == 0 { 0 } else { 2 };
                self.hazards.push(Hazard {
                    p,
                    kind,
                    owner: 255,
                    expires: u32::MAX,
                    phase: self.tick,
                });
                self.event = 5;
                self.event_tick = self.tick;
            }
        }
        for bi in 0..self.balls.len() {
            if self.balls[bi].wait > 0 {
                self.balls[bi].wait -= 1;
                continue;
            }
            let mut b = self.balls[bi].clone();
            let mut missed = false;
            for _ in 0..3 {
                for h in &self.hazards {
                    let delta = b.p.sub(h.p);
                    let d = delta.len().max(1);
                    if h.kind == 1 && d < 30_000 {
                        let force = delta.unit().scale(-((30_000 - d) / 70), Q);
                        b.v = b.v.add(force);
                        let speed = b.v.len().clamp(3000, MAX_SPEED);
                        b.v = b.v.unit().scale(speed, Q);
                    }
                    if h.kind == 0 && d < 6500 && b.v.dot(delta) < 0 {
                        let n = delta.unit();
                        b.v = b.v.sub(n.scale(2 * b.v.dot(n), Q * Q));
                        b.p = h.p.add(n.scale(6800, Q));
                    }
                    if h.kind == 2 {
                        let dir = direction(((self.tick - h.phase) / 2) as usize);
                        let along = delta.dot(dir) / Q;
                        let normal = V::new(-dir.y, dir.x);
                        let across = delta.dot(normal) / Q;
                        if along.abs() < 10000 && across.abs() < 2600 {
                            let n = normal.scale(if across < 0 { -1 } else { 1 }, 1);
                            if b.v.dot(n) < 0 {
                                b.v = b.v.sub(n.scale(2 * b.v.dot(n), Q * Q));
                                b.v = b.v.add(dir.scale(300, Q));
                                b.v = b.v.unit().scale(b.v.len().min(MAX_SPEED), Q);
                                b.p = b.p.add(n.scale(2800 - across.abs(), Q));
                            }
                        }
                    }
                }
                let next = b.p.add(b.v.scale(1, 3));
                let mut collision = false;
                for w in &walls {
                    let before = b.p.sub(w.a).dot(w.n) / Q;
                    let after = next.sub(w.a).dot(w.n) / Q;
                    if after < 1500 && b.v.dot(w.n) < 0 {
                        let fraction =
                            ((before - 1500).max(0) * Q / (before - after).max(1)).clamp(0, Q);
                        let hit = b.p.add(next.sub(b.p).scale(fraction, Q));
                        let tangent = w.b.sub(w.a);
                        let u = hit.sub(w.a).dot(tangent) * 10000 / tangent.dot(tangent);
                        let paddle_hit = w.player >= 0
                            && (u - self.players[w.player as usize].pos).abs()
                                <= self.paddle_half(w.player as usize) + 150;
                        let defended = w.player < 0
                            || self.players[w.player as usize].shield > self.tick
                            || paddle_hit;
                        if defended {
                            if paddle_hit {
                                let half = self.paddle_half(w.player as usize);
                                let player = &mut self.players[w.player as usize];
                                player.hits += 1;
                                let offset = (u - player.pos).clamp(-half, half);
                                let out = w.n.add(tangent.unit().scale(offset, half + 100));
                                b.v = out
                                    .unit()
                                    .scale((b.v.len() * 106 / 100 + 30).min(MAX_SPEED), Q);
                                b.last = w.player;
                            } else {
                                b.v = b.v.sub(w.n.scale(2 * b.v.dot(w.n), Q * Q));
                            }
                            b.p = hit.add(w.n.scale(100, Q));
                            collision = true;
                            break;
                        } else {
                            let p = w.player as usize;
                            self.players[p].lives = self.players[p].lives.saturating_sub(1);
                            self.players[p].shield = self.tick + 10;
                            missed = true;
                            break;
                        }
                    }
                }
                if missed {
                    break;
                }
                if !collision {
                    b.p = next
                }
            }
            if missed {
                self.reset_ball(bi);
                if self.players.iter().filter(|p| p.lives > 0).count()
                    != walls.iter().filter(|w| w.player >= 0).count()
                {
                    self.rebuild();
                    return;
                }
            } else {
                self.balls[bi] = b;
                let ball = &self.balls[bi];
                if ball.last >= 0 && self.players[ball.last as usize].lives > 0 {
                    if let Some(pi) = self
                        .powerups
                        .iter()
                        .position(|p| p.p.sub(ball.p).len() < 8500)
                    {
                        let power = self.powerups.remove(pi);
                        self.collect(bi, power.kind);
                    }
                }
            }
        }
    }
    fn clear_center(&mut self, radius: i64) -> Option<V> {
        let walls = self.walls();
        for _ in 0..12 {
            let d = direction((self.random() % 64) as usize);
            let r = (self.random() % (radius as u64 + 1)) as i64;
            let p = d.scale(r, Q);
            if walls.iter().all(|w| p.sub(w.a).dot(w.n) / Q >= 24_000)
                && self.hazards.iter().all(|h| h.p.sub(p).len() >= 23_000)
                && self.powerups.iter().all(|v| v.p.sub(p).len() > 15000)
            {
                return Some(p);
            }
        }
        None
    }
    fn collect(&mut self, bi: usize, kind: u8) {
        let ball = self.balls[bi].clone();
        let owner = ball.last as usize;
        self.event = kind + 1;
        self.event_player = ball.last;
        self.event_tick = self.tick;
        if kind < 2 {
            self.effects
                .resize(self.players.len(), PaddleEffect::default());
            self.effects[owner] = PaddleEffect {
                half: if kind == 0 { 2100 } else { 900 },
                expires: self.tick + 200,
            };
        } else if kind == 2 {
            for sign in [-1, 1] {
                if self.balls.len() >= 3 {
                    break;
                }
                let dir = V::new(
                    ball.v.x * 866 / 1000 - sign * ball.v.y / 2,
                    sign * ball.v.x / 2 + ball.v.y * 866 / 1000,
                );
                let mut split = ball.clone();
                split.v = dir.unit().scale(ball.v.len(), Q);
                self.balls.push(split);
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use std::cell::RefCell;
    thread_local! {static GAME:RefCell<Game>=RefCell::new(Game::default());static OUTPUT:RefCell<Vec<u8>>=RefCell::new(Vec::new());static INPUT:RefCell<Vec<u8>>=RefCell::new(Vec::new());}
    #[no_mangle]
    pub extern "C" fn game_init(count: u32, seed: u32, bots: u32, sabotage: u32) {
        GAME.with(|g| {
            *g.borrow_mut() = Game::new(count as usize, seed as u64, bots as u8, sabotage != 0)
        });
    }
    #[no_mangle]
    pub extern "C" fn game_step() {
        GAME.with(|g| g.borrow_mut().step());
    }
    #[no_mangle]
    pub extern "C" fn game_input(p: u32, target: i32) {
        GAME.with(|g| g.borrow_mut().input(p as usize, target as i64));
    }
    #[no_mangle]
    pub extern "C" fn game_place(p: u32, kind: u32, x: i32, y: i32) -> u32 {
        GAME.with(|g| {
            g.borrow_mut()
                .place(p as usize, kind as u8, V::new(x as i64, y as i64))
                .is_ok() as u32
        })
    }
    #[no_mangle]
    pub extern "C" fn game_placement(p: u32, kind: u32, x: i32, y: i32) -> u32 {
        GAME.with(|g| {
            g.borrow()
                .placement_code(p as usize, kind as u8, V::new(x as i64, y as i64)) as u32
        })
    }
    #[no_mangle]
    pub extern "C" fn game_snapshot() -> *const u8 {
        GAME.with(|g| {
            let game = g.borrow();
            let json = serde_json::json!({"game":&*game,"walls":game.walls()});
            OUTPUT.with(|o| {
                *o.borrow_mut() = serde_json::to_vec(&json).unwrap();
                o.borrow().as_ptr()
            })
        })
    }
    #[no_mangle]
    pub extern "C" fn game_snapshot_len() -> usize {
        OUTPUT.with(|o| o.borrow().len())
    }
    #[no_mangle]
    pub extern "C" fn game_load_buffer(len: usize) -> *mut u8 {
        INPUT.with(|i| {
            i.borrow_mut().resize(len, 0);
            i.borrow_mut().as_mut_ptr()
        })
    }
    #[no_mangle]
    pub extern "C" fn game_load() -> u32 {
        INPUT.with(|i| {
            if let Ok(game) = Game::from_bytes(&i.borrow()) {
                GAME.with(|g| *g.borrow_mut() = game);
                1
            } else {
                0
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maximum_speed_defense_does_not_tunnel_through_any_paddle() {
        for count in 2..=8 {
            for player in 0..count {
                let mut g = Game::new(count, 42, 0, false);
                g.pause = 0;
                let wall = g.walls().into_iter().find(|w| w.player == player as i8).unwrap();
                let center = wall.a.add(wall.b).scale(1, 2);
                g.balls[0] = Ball { p: center.add(wall.n.scale(7000, Q)), v: wall.n.scale(-MAX_SPEED, Q), wait: 0, last: -1 };
                g.step();
                assert_eq!(g.players[player].lives, 2);
                assert_eq!(g.players[player].hits, 1);
                assert!(g.balls[0].v.dot(wall.n) > 0);
            }
        }
    }
    #[test]
    fn countdown_holds_ball_but_allows_paddle_input() {
        let mut g = Game::new(2, 42, 0, true);
        let initial = g.balls[0].p;
        g.input(0, 8000);
        for _ in 0..60 {
            g.step();
            assert_eq!(g.balls[0].p.x, initial.x);
            assert_eq!(g.balls[0].p.y, initial.y);
            assert_eq!(g.stage_tick, 0);
        }
        assert_eq!(g.players[0].pos, 8000);
        assert_eq!(g.pause, 0);
        g.step();
        assert!(g.balls[0].p.sub(initial).len() > 0);
    }
    #[test]
    fn obstacles_live_until_elimination_including_final_duel() {
        let mut g = Game::new(3, 42, 0, true);
        g.balls[0].wait = 5000;
        for _ in 0..361 { g.step(); }
        let first_phase = g.hazards[0].phase;
        for _ in 0..260 { g.step(); }
        assert!(g.hazards.iter().any(|h| h.phase == first_phase));
        g.eliminate(2);
        assert!(g.hazards.is_empty());
        g.place(2, 0, V::new(0, 0)).unwrap();
        g.balls[0].wait = 5000;
        for _ in 0..260 { g.step(); }
        assert!(g.hazards.iter().any(|h| h.owner == 2));
        g.eliminate(1);
        assert!(g.finished);
        assert!(g.hazards.is_empty());
    }
    #[test]
    fn faster_stages_reset_multiball() {
        let mut g = Game::new(8, 42, 0, true);
        let speed = g.balls[0].v.len();
        assert!(speed > 4100);
        g.balls[0].last = 0;
        g.collect(0, 2);
        assert_eq!(g.balls.len(), 3);
        g.eliminate(7);
        assert_eq!(g.balls.len(), 1);
        assert!(g.balls[0].v.len() > speed + 400);
        assert_eq!(g.stage_tick, 0);
        assert_eq!(g.pause, 14);
    }
    #[test]
    fn powerups_expire_and_split_is_bounded() {
        let mut g = Game::new(8, 42, 0, true);
        g.balls[0].last = 0;
        g.collect(0, 0);
        assert_eq!(g.paddle_half(0), 2100);
        g.collect(0, 1);
        assert_eq!(g.paddle_half(0), 900);
        g.tick += 201;
        assert_eq!(g.paddle_half(0), 1400);
        for _ in 0..10 {
            g.collect(0, 2)
        }
        assert_eq!(g.balls.len(), 3);
        for b in &g.balls {
            assert!(b.v.len() <= MAX_SPEED);
        }
    }
    #[test]
    fn central_pickups_and_periodic_obstacles_spawn() {
        let mut g = Game::new(8, 42, 0, true);
        g.balls[0].wait = 5000;
        for _ in 0..170 {
            g.step()
        }
        assert_eq!(g.powerups.len(), 1);
        assert!(g.powerups[0].p.len() <= 12000);
        for _ in 170..361 {
            g.step()
        }
        assert!(g.hazards.iter().any(|h| h.owner == 255));
        assert!(g
            .hazards
            .iter()
            .all(|h| g.walls().iter().all(|w| h.p.sub(w.a).dot(w.n) / Q >= 22000)));
    }
    #[test]
    fn every_real_return_accelerates_ball() {
        let mut g = Game::new(2, 42, 0, true);
        g.pause = 0;
        g.balls[0] = Ball {
            p: V::new(0, 97000),
            v: V::new(0, 4200),
            last: -1,
            wait: 0,
        };
        g.step();
        assert_eq!(g.players[0].hits, 1);
        assert!(g.balls[0].v.len() > 4450);
    }
    #[test]
    fn old_match_bytes_remain_readable() {
        let g = LegacyGame {
            tick: 500,
            players: vec![
                Player {
                    lives: 1,
                    ..Player::default()
                },
                Player::default(),
            ],
            balls: vec![],
            hazards: vec![],
            rng: 4,
            pause: 0,
            winner: 0,
            finished: true,
            sabotage: true,
            generation: 1,
        };
        let bytes = borsh::to_vec(&g).unwrap();
        let loaded = Game::from_bytes(&bytes).unwrap();
        assert!(loaded.finished);
        assert_eq!(loaded.winner, 0);
        assert_eq!(loaded.paddle_half(0), 1400);
        assert!(Game::from_bytes(&[1, 2, 3]).is_err());
    }
    #[test]
    fn deterministic() {
        let mut a = Game::new(8, 92, 254, true);
        let mut b = a.clone();
        for _ in 0..6000 {
            a.step();
            b.step();
        }
        assert_eq!(borsh::to_vec(&a).unwrap(), borsh::to_vec(&b).unwrap());
        assert!(a.finished);
    }
    #[test]
    fn duel() {
        let g = Game::new(2, 1, 0, true);
        let w = g.walls();
        assert_eq!(w.len(), 4);
        assert_eq!(w.iter().filter(|w| w.player < 0).count(), 2);
    }
    #[test]
    fn collapse() {
        let mut g = Game::new(8, 1, 0, true);
        for i in 1..7 {
            g.eliminate(i);
            let w = g.walls();
            let lens: Vec<_> = w
                .iter()
                .filter(|w| w.player >= 0)
                .map(|w| w.b.sub(w.a).len())
                .collect();
            assert!(lens.iter().max().unwrap() - lens.iter().min().unwrap() < 5);
        }
        assert_eq!(g.alive().len(), 2);
        g.eliminate(7);
        assert!(g.finished);
        assert_eq!(g.winner, 0);
    }
    fn segment_center(w: &Wall) -> V {
        V::new((w.a.x + w.b.x) / 3, (w.a.y + w.b.y) / 3)
    }
    #[test]
    fn hazards() {
        let mut g = Game::new(8, 1, 0, true);
        assert!(g.place(0, 0, V::default()).is_err());
        g.eliminate(0);
        assert!(g.place(0, 0, V::new(99999, 99999)).is_err());
        assert!(g.place(0, 0, V::default()).is_ok());
        assert!(g.place(0, 1, V::default()).is_err());
        g.tick = 161;
        assert!(g.place(0, 1, V::default()).is_err());
    }
    #[test]
    fn second_hazard_in_adjacent_segment() {
        let mut g = Game::new(8, 1, 0, true);
        g.eliminate(0);
        let walls = g.walls();
        let first = segment_center(&walls[0]);
        assert!(g.place(0, 1, first).is_ok());
        g.tick += 160;
        let second = segment_center(&walls[1]);
        assert!(
            g.place(0, 0, second).is_ok(),
            "adjacent segment centers should allow a second hazard"
        );
    }
    #[test]
    fn third_hazard_by_same_player() {
        let mut g = Game::new(8, 1, 0, true);
        g.eliminate(0);
        let walls = g.walls();
        assert!(g.place(0, 0, segment_center(&walls[0])).is_ok());
        g.tick += 160;
        assert!(g.place(0, 1, segment_center(&walls[2])).is_ok());
        g.tick += 160;
        assert!(
            g.place(0, 2, segment_center(&walls[4])).is_ok(),
            "eliminated players are not capped at two hazards"
        );
    }
    #[test]
    fn bounded_inputs() {
        let mut g = Game::new(2, 1, 0, true);
        g.input(0, i64::MAX);
        g.step();
        assert_eq!(g.players[0].pos, 5700);
        assert_eq!(g.players[0].target, 8600);
    }
    #[test]
    fn all_seeds_finish_and_stay_bounded() {
        for seed in 1..32 {
            let mut g = Game::new(8, seed, 255, true);
            for _ in 0..6000 {
                g.step();
                for b in &g.balls {
                    assert!(b.v.len() <= MAX_SPEED + 10);
                    assert!(b.p.x.abs() < 110000 && b.p.y.abs() < 110000);
                }
            }
            assert!(g.finished);
        }
    }
}
