'use client';
import { useEffect, useRef } from 'react';
import {
  Physics,
  COLORS,
  keyboardTarget,
  acceptsPaddlePointer,
  paddleHalf,
  type Snapshot,
  type Vec,
  type Wall,
} from '@/lib/physics';
type Props = {
  engine: Physics;
  running: boolean;
  online: boolean;
  localPlayer: number;
  names: string[];
  hazard: number;
  muted: boolean;
  reduced: boolean;
  onSnapshot: (s: Snapshot) => void;
  onInput: (n: number) => void;
  onPlace: (p: Vec) => void;
  snapshotTime?: number;
};
export default function Arena(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  useEffect(() => {
    current.current = props;
  });
  const pointer = useRef<Vec | null>(null);
  const keys = useRef(new Set<string>());
  const frameTransform = useRef({ scale: 1, cx: 0, cy: 0, rotation: 0 });
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0,
      last = performance.now(),
      acc = 0,
      lastTick = -1,
      lastGeneration = -1;
    let trails: Vec[][] = [];
    let view = current.current.engine.snapshot();
    let lastEmit = 0;
    let audio: AudioContext | undefined;
    let lastHits = 0;
    let oldWalls: Wall[] = [],
      morphFrom: Wall[] = [],
      morphStart = -1000,
      cameraFrom = 0,
      cameraRotation = 0;
    let lastLives: number[] = [],
      lastPlayerHits: number[] = [];
    let shakeUntil = 0,
      flashUntil = 0,
      lastEventTick = -1;
    const hitFlash = new Map<number, number>();
    let sparks: {
      p: Vec;
      v: Vec;
      color: string;
      born: number;
      life: number;
    }[] = [];
    const burst = (at: Vec, color: string, now: number, count = 16) => {
      for (let i = 0; i < count; i++) {
        const angle = i * 2.39996;
        const speed = 30 + (i % 7) * 15;
        sparks.push({
          p: { ...at },
          v: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
          color,
          born: now,
          life: 350 + (i % 5) * 80,
        });
      }
      if (sparks.length > 240) sparks = sparks.slice(-240);
    };
    const resize = () => {
      const rect = el.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio, 2);
      el.width = rect.width * dpr;
      el.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const keyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches('input,textarea,select')) return;
      if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(e.key)) {
        e.preventDefault();
        keys.current.add(e.key.toLowerCase());
      }
    };
    const keyUp = (e: KeyboardEvent) =>
      keys.current.delete(e.key.toLowerCase());
    const clearKeys = () => keys.current.clear();
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    function draw(now: number) {
      const p = current.current;
      const dt = Math.min(now - last, 100);
      last = now;
      acc += dt;
      if (p.running) {
        while (acc >= 50) {
          if (!p.online || now - (p.snapshotTime ?? 0) < 200) {
            p.engine.step();
          }
          acc -= 50;
        }
      } else acc = 0;
      view = p.engine.snapshot();
      const { game, walls } = view;
      const rect = el!.getBoundingClientRect(),
        width = rect.width,
        height = rect.height;
      ctx!.clearRect(0, 0, width, height);
      const local = walls.find((w) => w.player === p.localPlayer);
      let desiredRotation = frameTransform.current.rotation;
      if (local) {
        const mx = (local.a.x + local.b.x) / 2,
          my = (local.a.y + local.b.y) / 2;
        desiredRotation = Math.PI / 2 - Math.atan2(my, mx);
      }
      if (game.tick < lastTick) {
        lastLives = [];
        lastPlayerHits = [];
        sparks = [];
        lastEventTick = -1;
        oldWalls = [];
        lastGeneration = -1;
      }
      if (game.generation !== lastGeneration) {
        morphFrom = oldWalls;
        cameraFrom = cameraRotation;
        morphStart = lastGeneration < 0 ? now - 1000 : now;
        if (lastGeneration >= 0 && !p.reduced) {
          for (const w of oldWalls.filter(
            (w) =>
              w.player >= 0 && !walls.some((next) => next.player === w.player),
          ))
            burst(
              { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 },
              COLORS[w.player],
              now,
              36,
            );
          shakeUntil = now + 350;
          flashUntil = now + 160;
        }
        trails = [];
        lastGeneration = game.generation;
      }
      const progress = p.reduced ? 1 : Math.min(1, (now - morphStart) / 650),
        ease = progress * progress * (3 - 2 * progress);
      const angle = Math.atan2(
        Math.sin(desiredRotation - cameraFrom),
        Math.cos(desiredRotation - cameraFrom),
      );
      const rotation =
        progress < 1 ? cameraFrom + angle * ease : desiredRotation;
      cameraRotation = rotation;
      const visualWalls = walls.map((w) => {
        const old = morphFrom.find((v) => v.player === w.player);
        if (!old || progress >= 1) return w;
        const blend = (a: Vec, b: Vec) => ({
          x: a.x + (b.x - a.x) * ease,
          y: a.y + (b.y - a.y) * ease,
        });
        return { ...w, a: blend(old.a, w.a), b: blend(old.b, w.b) };
      });
      for (let i = 0; i < game.players.length; i++) {
        const pl = game.players[i],
          w =
            walls.find((w) => w.player === i) ??
            oldWalls.find((w) => w.player === i);
        if (w && !p.reduced) {
          const at = {
            x: w.a.x + ((w.b.x - w.a.x) * pl.pos) / 10000,
            y: w.a.y + ((w.b.y - w.a.y) * pl.pos) / 10000,
          };
          if (pl.hits > (lastPlayerHits[i] ?? pl.hits)) {
            hitFlash.set(i, now + 160);
            burst(at, COLORS[i], now, 9);
          }
          if (pl.lives < (lastLives[i] ?? pl.lives)) {
            burst(at, COLORS[i], now, 24);
            shakeUntil = now + 220;
            flashUntil = now + 90;
          }
        }
      }
      lastLives = game.players.map((p) => p.lives);
      lastPlayerHits = game.players.map((p) => p.hits);
      oldWalls = visualWalls;
      if (game.event_tick > lastEventTick) {
        if (game.event > 0 && game.event <= 3 && !p.reduced) {
          burst(
            { x: 0, y: 0 },
            ['#c8ff57', '#ff8bcb', '#6ce3ff'][game.event - 1],
            now,
            30,
          );
          flashUntil = now + 90;
        }
        lastEventTick = game.event_tick;
      }
      const scale = Math.min(width, height) / 275000;
      frameTransform.current = {
        scale,
        cx: width / 2,
        cy: height / 2,
        rotation,
      };
      if (
        p.localPlayer >= 0 &&
        game.players[p.localPlayer]?.lives > 0 &&
        p.running
      ) {
        const direction =
          (keys.current.has('arrowright') || keys.current.has('d') ? 1 : 0) -
          (keys.current.has('arrowleft') || keys.current.has('a') ? 1 : 0);
        if (direction && local) {
          p.onInput(
            keyboardTarget(
              local,
              rotation,
              game.players[p.localPlayer].target,
              direction,
              dt,
            ),
          );
        }
      }
      ctx!.save();
      ctx!.translate(width / 2, height / 2);
      if (!p.reduced && now < shakeUntil) {
        const strength = ((shakeUntil - now) / 350) * 4;
        ctx!.translate(
          Math.sin(now * 0.087) * strength,
          Math.cos(now * 0.071) * strength,
        );
      }
      ctx!.rotate(rotation);
      ctx!.scale(scale, scale);
      if (visualWalls.length) {
        ctx!.beginPath();
        ctx!.moveTo(visualWalls[0].a.x, visualWalls[0].a.y);
        visualWalls.forEach((w) => ctx!.lineTo(w.b.x, w.b.y));
        ctx!.closePath();
        const gradient = ctx!.createRadialGradient(0, 0, 0, 0, 0, 120000);
        gradient.addColorStop(0, '#1b2534');
        gradient.addColorStop(1, '#101721');
        ctx!.fillStyle = gradient;
        ctx!.fill();
      }
      if (game.tick !== lastTick) {
        game.balls.forEach((b, i) => {
          trails[i] ??= [];
          trails[i].push({ ...b.p });
          if (trails[i].length > 12) trails[i].shift();
        });
        lastTick = game.tick;
      }
      for (const w of visualWalls) {
        const color = w.player < 0 ? '#526075' : COLORS[w.player];
        ctx!.lineWidth = 500;
        ctx!.strokeStyle = color + '77';
        ctx!.setLineDash(
          w.player >= 0 && game.players[w.player].lives === 1
            ? [3200, 2600]
            : [],
        );
        ctx!.beginPath();
        ctx!.moveTo(w.a.x, w.a.y);
        ctx!.lineTo(w.b.x, w.b.y);
        ctx!.stroke();
        ctx!.setLineDash([]);
        if (w.player < 0) continue;
        const pl = game.players[w.player];
        const t = pl.pos / 10000,
          half = paddleHalf(game, w.player) / 10000;
        const x1 = w.a.x + (w.b.x - w.a.x) * (t - half),
          y1 = w.a.y + (w.b.y - w.a.y) * (t - half);
        const x2 = w.a.x + (w.b.x - w.a.x) * (t + half),
          y2 = w.a.y + (w.b.y - w.a.y) * (t + half);
        ctx!.strokeStyle =
          (hitFlash.get(w.player) ?? 0) > now ? '#ffffff' : color;
        ctx!.lineWidth = (hitFlash.get(w.player) ?? 0) > now ? 2800 : 2000;
        ctx!.lineCap = 'round';
        ctx!.shadowColor = color;
        ctx!.shadowBlur = p.reduced ? 0 : 10;
        ctx!.beginPath();
        ctx!.moveTo(x1, y1);
        ctx!.lineTo(x2, y2);
        ctx!.stroke();
        ctx!.shadowBlur = 0;
        const mx = (w.a.x + w.b.x) * 0.56,
          my = (w.a.y + w.b.y) * 0.56;
        ctx!.save();
        ctx!.translate(mx, my);
        ctx!.rotate(-rotation);
        ctx!.textAlign = 'center';
        ctx!.font = 11 / scale + 'px monospace';
        ctx!.fillStyle = color;
        ctx!.fillText(
          (
            p.names[w.player] || 'BOT ' + String(w.player + 1).padStart(2, '0')
          ).slice(0, 16),
          0,
          0,
        );
        ctx!.font = 10 / scale + 'px monospace';
        ctx!.fillText(
          '◆'.repeat(pl.lives) + '◇'.repeat(2 - pl.lives),
          0,
          14 / scale,
        );
        if (w.player === p.localPlayer) {
          ctx!.fillText('▲ YOU', 0, 28 / scale);
        }
        ctx!.restore();
      }
      for (const h of game.hazards) {
        const color = COLORS[h.owner] ?? '#ffb45c';
        ctx!.save();
        ctx!.translate(h.p.x, h.p.y);
        ctx!.strokeStyle = color;
        ctx!.fillStyle = color + '22';
        ctx!.lineWidth = 500;
        const remaining = (h.expires - game.tick) / 240;
        ctx!.globalAlpha = Math.min(
          1,
          remaining * 4,
          (game.tick - h.phase + 1) / 8,
        );
        if (h.kind === 0) {
          ctx!.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3;
            ctx!.lineTo(Math.cos(a) * 4300, Math.sin(a) * 4300);
          }
          ctx!.closePath();
          ctx!.fill();
          ctx!.stroke();
          ctx!.beginPath();
          ctx!.arc(0, 0, 1600, 0, Math.PI * 2);
          ctx!.stroke();
        } else if (h.kind === 1) {
          ctx!.setLineDash([1500, 1500]);
          ctx!.beginPath();
          ctx!.arc(0, 0, 15000, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.setLineDash([]);
          for (let j = 0; j < 3; j++) {
            ctx!.beginPath();
            ctx!.arc(
              0,
              0,
              2500 + j * 2600,
              game.tick * 0.06 + j,
              game.tick * 0.06 + j + Math.PI * 1.4,
            );
            ctx!.stroke();
          }
        } else {
          ctx!.rotate((Math.floor((game.tick - h.phase) / 2) * Math.PI) / 32);
          ctx!.lineWidth = 1800;
          ctx!.beginPath();
          ctx!.moveTo(-10000, 0);
          ctx!.lineTo(10000, 0);
          ctx!.stroke();
          ctx!.beginPath();
          ctx!.arc(0, 0, 2500, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.restore();
      }
      for (const power of game.powerups ?? []) {
        const color = ['#c8ff57', '#ff8bcb', '#6ce3ff'][power.kind];
        ctx!.save();
        ctx!.translate(power.p.x, power.p.y);
        ctx!.rotate(-rotation);
        const pulse = p.reduced ? 1 : 1 + Math.sin(now * 0.006) * 0.1;
        ctx!.scale(pulse, pulse);
        ctx!.fillStyle = '#101c2b';
        ctx!.strokeStyle = color;
        ctx!.lineWidth = 650;
        ctx!.shadowColor = color;
        ctx!.shadowBlur = p.reduced ? 0 : 14;
        ctx!.beginPath();
        ctx!.roundRect(-6500, -6500, 13000, 13000, 2000);
        ctx!.fill();
        ctx!.stroke();
        ctx!.shadowBlur = 0;
        ctx!.fillStyle = color;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';
        ctx!.font = 'bold ' + Math.max(6500, 13 / scale) + 'px monospace';
        ctx!.fillText(['↔', '↦↤', '3×'][power.kind], 0, 0);
        ctx!.restore();
      }
      sparks = sparks.filter((s) => now - s.born < s.life);
      if (!p.reduced)
        for (const spark of sparks) {
          const age = now - spark.born;
          ctx!.globalAlpha = 1 - age / spark.life;
          ctx!.strokeStyle = spark.color;
          ctx!.lineWidth = 700;
          ctx!.beginPath();
          ctx!.moveTo(spark.p.x + spark.v.x * age, spark.p.y + spark.v.y * age);
          ctx!.lineTo(
            spark.p.x + spark.v.x * (age + 24),
            spark.p.y + spark.v.y * (age + 24),
          );
          ctx!.stroke();
        }
      ctx!.globalAlpha = 1;
      game.balls.forEach((b, i) => {
        const color = b.last < 0 ? '#eaf2ff' : COLORS[b.last];
        if (b.wait > 0) {
          ctx!.strokeStyle = color + '88';
          ctx!.lineWidth = 450;
          ctx!.setLineDash([1300, 2000]);
          ctx!.beginPath();
          ctx!.moveTo(0, 0);
          ctx!.lineTo(b.v.x * 14, b.v.y * 14);
          ctx!.stroke();
          ctx!.setLineDash([]);
          ctx!.beginPath();
          ctx!.arc(
            0,
            0,
            5000,
            -Math.PI / 2,
            -Math.PI / 2 + (Math.PI * 2 * b.wait) / 10,
          );
          ctx!.stroke();
          return;
        }
        if (!p.reduced) {
          const tr = trails[i] || [];
          for (let j = 1; j < tr.length; j++) {
            ctx!.strokeStyle = color;
            ctx!.globalAlpha = (j / tr.length) * 0.32;
            ctx!.lineWidth = 600 + j * 130;
            ctx!.beginPath();
            ctx!.moveTo(tr[j - 1].x, tr[j - 1].y);
            ctx!.lineTo(tr[j].x, tr[j].y);
            ctx!.stroke();
          }
          ctx!.globalAlpha = 1;
        }
        const f = p.running ? acc / 50 : 0;
        const bx = b.p.x + b.v.x * f,
          by = b.p.y + b.v.y * f;
        ctx!.fillStyle = '#fff';
        ctx!.shadowColor = color;
        ctx!.shadowBlur = p.reduced ? 0 : 16;
        ctx!.beginPath();
        ctx!.arc(bx, by, 1500, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.shadowBlur = 0;
      });
      if (
        pointer.current &&
        game.players[p.localPlayer]?.lives === 0 &&
        p.running &&
        game.sabotage
      ) {
        const at = pointer.current;
        ctx!.strokeStyle = COLORS[p.localPlayer];
        ctx!.lineWidth = 450;
        const cd = Math.max(
          0,
          (game.players[p.localPlayer].cooldown - game.tick) / 160,
        );
        ctx!.beginPath();
        ctx!.arc(at.x, at.y, 5500, 0, Math.PI * 2 * (1 - cd));
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.moveTo(at.x - 7500, at.y);
        ctx!.lineTo(at.x + 7500, at.y);
        ctx!.moveTo(at.x, at.y - 7500);
        ctx!.lineTo(at.x, at.y + 7500);
        ctx!.stroke();
      }
      ctx!.restore();
      if (!p.reduced && now < flashUntil) {
        ctx!.fillStyle =
          'rgba(200,255,87,' + ((flashUntil - now) / 160) * 0.05 + ')';
        ctx!.fillRect(0, 0, width, height);
      }
      if (game.event && game.tick - game.event_tick < 40) {
        ctx!.textAlign = 'center';
        ctx!.font = 'bold 11px monospace';
        ctx!.fillStyle = game.event === 5 ? '#ffb45c' : '#c8ff57';
        ctx!.fillText(
          [
            '',
            'PADDLE EXPANDED',
            'PADDLE SHRUNK',
            'TRIPLE BALL',
            'POWERUP INCOMING',
            'OBSTACLE INCOMING',
          ][game.event],
          width / 2,
          game.pause > 0 ? 64 : 35,
        );
      }
      if (game.pause > 0) {
        ctx!.fillStyle = '#d5dfeb';
        ctx!.textAlign = 'center';
        ctx!.font = '12px monospace';
        ctx!.fillText('ARENA COLLAPSING', width / 2, 40);
      }
      const hits = game.players.reduce((n, pl) => n + pl.hits, 0);
      if (hits > lastHits && p.running && !p.muted) {
        try {
          audio ??= new AudioContext();
          const o = audio.createOscillator(),
            gain = audio.createGain();
          o.type = 'sine';
          o.frequency.value = 350 + (hits % 5) * 100;
          gain.gain.setValueAtTime(0.035, audio.currentTime);
          gain.gain.exponentialRampToValueAtTime(
            0.001,
            audio.currentTime + 0.08,
          );
          o.connect(gain);
          gain.connect(audio.destination);
          o.start();
          o.stop(audio.currentTime + 0.08);
        } catch {}
      }
      lastHits = hits;
      if (now - lastEmit > 150) {
        p.onSnapshot(view);
        lastEmit = now;
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      void audio?.close();
    };
  }, [props.engine]);
  function position(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect(),
      t = frameTransform.current;
    const x = (e.clientX - rect.left - t.cx) / t.scale,
      y = (e.clientY - rect.top - t.cy) / t.scale;
    const p = {
      x: x * Math.cos(t.rotation) + y * Math.sin(t.rotation),
      y: -x * Math.sin(t.rotation) + y * Math.cos(t.rotation),
    };
    pointer.current = p;
    const snap = current.current.engine.snapshot();
    const wall = snap.walls.find(
      (w) => w.player === current.current.localPlayer,
    );
    if (
      acceptsPaddlePointer(e.pointerType) &&
      wall &&
      snap.game.players[current.current.localPlayer].lives > 0
    ) {
      const dx = wall.b.x - wall.a.x,
        dy = wall.b.y - wall.a.y;
      current.current.onInput(
        Math.max(
          1400,
          Math.min(
            8600,
            (((p.x - wall.a.x) * dx + (p.y - wall.a.y) * dy) /
              (dx * dx + dy * dy)) *
              10000,
          ),
        ),
      );
    }
    return p;
  }
  return (
    <canvas
      ref={canvas}
      className="game-canvas"
      aria-label="Survival Pong arena. Defend your wall with A/D, arrow keys, or touch sliding. Mouse aims sabotage only."
      onPointerMove={position}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = position(e);
        if (
          current.current.engine.snapshot().game.players[
            current.current.localPlayer
          ]?.lives === 0
        )
          current.current.onPlace(p);
      }}
      onPointerLeave={() => (pointer.current = null)}
    />
  );
}
