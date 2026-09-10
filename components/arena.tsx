'use client';
import { useEffect, useRef } from 'react';
import {
  Physics,
  COLORS,
  keyboardTarget,
  acceptsPaddlePointer,
  paddleHalf,
  visualPaddlePosition,
  ballVisualPosition,
  type Snapshot,
  type Vec,
  type Wall,
} from '@/lib/physics';
import { PADDLE_FRAMES, themeById, type ThemeId } from '@/lib/themes';
type Props = {
  engine: Physics;
  running: boolean;
  online: boolean;
  localPlayer: number;
  names: string[];
  hazard: number;
  muted: boolean;
  reduced: boolean;
  theme: ThemeId;
  onSnapshot: (s: Snapshot) => void;
  onInput: (n: number) => void;
  onPlace: (p: Vec) => void;
  snapshotTime?: number;
};

function star(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? radius * 0.45 : radius;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export default function Arena(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  useEffect(() => {
    current.current = props;
  });
  const pointer = useRef<Vec | null>(null);
  const localInput = useRef({ target: 5000, time: -Infinity });
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
    let paddlePosition = 5000;
    let wasRunning = false;
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
    const paddleAnimationStart = new Map<number, number>();
    const paddleImages = PADDLE_FRAMES.map((frames) =>
      frames.map((src, index) => {
        const image = new Image();
        // Keep the initial arena light: idle art loads up front, animation
        // frames load only after that player first returns the ball.
        if (index === 0) image.src = src;
        return image;
      }),
    );
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
        dpr = Math.min(
          devicePixelRatio,
          matchMedia('(pointer: coarse)').matches ? 1.5 : 2,
        );
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
      const themed = p.theme !== 'default';
      const dt = Math.min(now - last, 100);
      last = now;
      acc += dt;
      if (p.running) {
        while (acc >= 50) {
          if (!p.online) {
            p.engine.step();
          }
          acc -= 50;
        }
      } else acc = 0;
      view =
        (p.online ? p.engine.networkFrames.sample(now) : undefined) ??
        p.engine.snapshot();
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
      if (p.running !== wasRunning) {
        wasRunning = p.running;
        paddlePosition = game.players[p.localPlayer]?.pos ?? 5000;
        localInput.current = { target: paddlePosition, time: -Infinity };
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
            if (themed && !p.reduced) {
              paddleAnimationStart.set(i, now);
              paddleImages[i]?.forEach((image, frame) => {
                if (!image.src) image.src = PADDLE_FRAMES[i]?.[frame] ?? '';
              });
            }
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
          const value = keyboardTarget(
            local,
            rotation,
            localInput.current.target,
            direction,
            dt,
          );
          localInput.current = { target: value, time: now };
          p.onInput(value);
        }
      }
      const localState = game.players[p.localPlayer];
      if (localState) {
        const fresh = !p.online || now - (p.snapshotTime ?? 0) < 500;
        const nearImpact =
          p.online &&
          local &&
          game.balls.some((b) => {
            const distance =
              ((b.p.x - local.a.x) * local.n.x +
                (b.p.y - local.a.y) * local.n.y) /
              100000;
            return (
              distance < 22000 &&
              !b.wait &&
              b.v.x * local.n.x + b.v.y * local.n.y < 0
            );
          });
        const predicting =
          fresh && !nearImpact && now - localInput.current.time < 500;
        paddlePosition = visualPaddlePosition(
          paddlePosition,
          predicting ? localInput.current.target : localState.pos,
          paddleHalf(game, p.localPlayer),
          dt,
        );
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
        const theme = themeById(p.theme);
        const gradient = ctx!.createRadialGradient(0, 0, 0, 0, 0, 120000);
        gradient.addColorStop(0, theme.table[0]);
        gradient.addColorStop(1, theme.table[1]);
        ctx!.fillStyle = gradient;
        ctx!.fill();

        if (themed) {
          ctx!.save();
          ctx!.strokeStyle = theme.line + '70';
          ctx!.lineWidth = 380;
          ctx!.setLineDash([2600, 2100]);
          ctx!.beginPath();
          for (const w of visualWalls) {
            const mx = (w.a.x + w.b.x) / 2;
            const my = (w.a.y + w.b.y) / 2;
            ctx!.moveTo(0, 0);
            ctx!.lineTo(mx, my);
          }
          ctx!.stroke();
          ctx!.setLineDash([]);
          ctx!.beginPath();
          visualWalls.forEach((w, index) => {
            const x = ((w.a.x + w.b.x) / 2) * 0.38;
            const y = ((w.a.y + w.b.y) / 2) * 0.38;
            if (index) ctx!.lineTo(x, y);
            else ctx!.moveTo(x, y);
          });
          ctx!.closePath();
          ctx!.stroke();
          ctx!.fillStyle = theme.line + '30';
          const starPositions = [
            [-0.48, -0.2],
            [0.47, -0.18],
            [-0.34, 0.34],
            [0.32, 0.39],
            [-0.2, -0.5],
            [0.21, -0.49],
            [0, 0.58],
          ];
          for (const [x, y] of starPositions)
            star(ctx!, x * 100000, y * 100000, 4300);
          ctx!.restore();

          ctx!.save();
          ctx!.globalAlpha = 0.13;
          ctx!.fillStyle = '#a7c0ff';
          ctx!.beginPath();
          ctx!.roundRect(-15000, -10500, 30000, 23000, 8000);
          ctx!.fill();
          ctx!.beginPath();
          ctx!.moveTo(-12000, -7000);
          ctx!.lineTo(-7000, -17000);
          ctx!.lineTo(-1500, -9000);
          ctx!.lineTo(6500, -17000);
          ctx!.lineTo(12000, -7000);
          ctx!.fill();
          ctx!.fillStyle = theme.table[1];
          ctx!.beginPath();
          ctx!.arc(-5200, 0, 2300, 0, Math.PI * 2);
          ctx!.arc(5200, 0, 2300, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.restore();
        }
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
        ctx!.lineWidth = themed && w.player >= 0 ? 900 : 500;
        ctx!.strokeStyle = themed && w.player >= 0 ? color : color + '77';
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
        const t =
            (w.player === p.localPlayer ? paddlePosition : pl.pos) / 10000,
          half = paddleHalf(game, w.player) / 10000;
        const x1 = w.a.x + (w.b.x - w.a.x) * (t - half),
          y1 = w.a.y + (w.b.y - w.a.y) * (t - half);
        const x2 = w.a.x + (w.b.x - w.a.x) * (t + half),
          y2 = w.a.y + (w.b.y - w.a.y) * (t + half);
        if (themed) {
          const animationAge =
            now - (paddleAnimationStart.get(w.player) ?? -1000);
          const frames = paddleImages[w.player] ?? [];
          const frameIndex =
            !p.reduced && animationAge >= 0 && animationAge < 405
              ? Math.min(frames.length - 1, Math.floor(animationAge / 45))
              : 0;
          const requestedImage = frames[frameIndex];
          const image =
            requestedImage?.complete && requestedImage.naturalWidth
              ? requestedImage
              : frames[0];
          if (image?.complete && image.naturalWidth) {
            const paddleLength = Math.hypot(x2 - x1, y2 - y1) * 1.16;
            const paddleX = (x1 + x2) / 2;
            const paddleY = (y1 + y2) / 2;
            ctx!.save();
            ctx!.translate(paddleX, paddleY);
            ctx!.rotate(Math.atan2(y2 - y1, x2 - x1));
            ctx!.drawImage(
              image,
              -paddleLength / 2,
              -paddleLength / 2,
              paddleLength,
              paddleLength,
            );
            ctx!.restore();
          } else {
            ctx!.strokeStyle =
              (hitFlash.get(w.player) ?? 0) > now ? '#ffffff' : color;
            ctx!.lineWidth = (hitFlash.get(w.player) ?? 0) > now ? 2800 : 2000;
            ctx!.lineCap = 'round';
            ctx!.beginPath();
            ctx!.moveTo(x1, y1);
            ctx!.lineTo(x2, y2);
            ctx!.stroke();
          }

          const mx = ((w.a.x + w.b.x) / 2) * 1.34;
          const my = ((w.a.y + w.b.y) / 2) * 1.34;
          ctx!.save();
          ctx!.translate(mx, my);
          ctx!.rotate(-rotation);
          ctx!.scale(1 / scale, 1 / scale);
          const cardWidth = 104;
          const cardHeight = 38;
          ctx!.fillStyle = '#152657e8';
          ctx!.strokeStyle = color + '80';
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.roundRect(
            -cardWidth / 2,
            -cardHeight / 2,
            cardWidth,
            cardHeight,
            11,
          );
          ctx!.fill();
          ctx!.stroke();
          ctx!.fillStyle = color;
          ctx!.beginPath();
          ctx!.arc(-37, 0, 10, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.fillStyle = '#10204c';
          ctx!.font = 'bold 9px Arial';
          ctx!.textAlign = 'center';
          ctx!.textBaseline = 'middle';
          ctx!.fillText('P' + (w.player + 1), -37, 0);
          ctx!.textAlign = 'left';
          ctx!.fillStyle = '#f5f7ff';
          ctx!.font = 'bold 9px Arial';
          ctx!.fillText(
            (
              p.names[w.player] ||
              'BOT ' + String(w.player + 1).padStart(2, '0')
            ).slice(0, 9),
            -22,
            -6,
          );
          ctx!.fillStyle = '#ff6f8f';
          ctx!.font = '12px Arial';
          ctx!.fillText(
            '♥'.repeat(pl.lives) + '♡'.repeat(2 - pl.lives),
            -22,
            8,
          );
          if (w.player === p.localPlayer) {
            ctx!.fillStyle = color;
            ctx!.font = 'bold 7px Arial';
            ctx!.textAlign = 'right';
            ctx!.fillText('YOU', 45, -6);
          }
          ctx!.restore();
        } else {
          ctx!.strokeStyle =
            (hitFlash.get(w.player) ?? 0) > now ? '#ffffff' : color;
          ctx!.lineWidth = (hitFlash.get(w.player) ?? 0) > now ? 2800 : 2000;
          ctx!.lineCap = 'round';
          ctx!.beginPath();
          ctx!.moveTo(x1, y1);
          ctx!.lineTo(x2, y2);
          ctx!.stroke();

          const mx = (w.a.x + w.b.x) * 0.56;
          const my = (w.a.y + w.b.y) * 0.56;
          ctx!.save();
          ctx!.translate(mx, my);
          ctx!.rotate(-rotation);
          ctx!.textAlign = 'center';
          ctx!.font = 11 / scale + 'px monospace';
          ctx!.fillStyle = color;
          ctx!.fillText(
            (
              p.names[w.player] ||
              'BOT ' + String(w.player + 1).padStart(2, '0')
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
      }
      for (const h of game.hazards) {
        const color = COLORS[h.owner] ?? '#ffb45c';
        ctx!.save();
        ctx!.translate(h.p.x, h.p.y);
        ctx!.strokeStyle = color;
        ctx!.fillStyle = color + '22';
        ctx!.lineWidth = 500;
        ctx!.globalAlpha = Math.min(1, (game.tick - h.phase + 1) / 8);
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
        // Icons use fixed CSS-pixel geometry, independent of arena scale and fonts.
        ctx!.scale(1 / scale, 1 / scale);
        ctx!.fillStyle = '#101c2b';
        ctx!.strokeStyle = color;
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.roundRect(-12, -12, 24, 24, 5);
        ctx!.fill();
        ctx!.stroke();
        ctx!.fillStyle = color;
        ctx!.lineWidth = 1.8;
        ctx!.beginPath();
        if (power.kind === 2) {
          for (const [x, y] of [
            [-5, 4],
            [5, 4],
            [0, -5],
          ]) {
            ctx!.moveTo(x + 2.5, y);
            ctx!.arc(x, y, 2.5, 0, Math.PI * 2);
          }
          ctx!.fill();
        } else {
          ctx!.moveTo(-7, 0);
          ctx!.lineTo(7, 0);
          for (const sign of [-1, 1]) {
            const tip = power.kind === 0 ? sign * 7 : sign * 2;
            const tail = power.kind === 0 ? sign * 3 : sign * 6;
            ctx!.moveTo(tail, -4);
            ctx!.lineTo(tip, 0);
            ctx!.lineTo(tail, 4);
          }
          ctx!.stroke();
        }
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
        const f =
          !p.online && p.running && !game.pause && !b.wait ? acc / 50 : 0;
        const { x: bx, y: by } = ballVisualPosition(b, walls, f);
        ctx!.fillStyle = '#fff';
        ctx!.beginPath();
        ctx!.arc(bx, by, 2250, 0, Math.PI * 2);
        ctx!.fill();
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
      if (p.running && game.pause > 0) {
        ctx!.fillStyle = '#d5dfeb';
        ctx!.textAlign = 'center';
        const starting = game.generation === 0 && game.stage_tick === 0;
        ctx!.font = starting ? 'bold 64px monospace' : '12px monospace';
        ctx!.fillText(
          starting ? String(Math.ceil(game.pause / 20)) : 'ARENA COLLAPSING',
          width / 2,
          starting ? height / 2 : 40,
        );
        if (starting) {
          ctx!.font = '12px monospace';
          ctx!.fillText('GET READY', width / 2, height / 2 + 30);
        }
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
      const value = Math.max(
        1400,
        Math.min(
          8600,
          (((p.x - wall.a.x) * dx + (p.y - wall.a.y) * dy) /
            (dx * dx + dy * dy)) *
            10000,
        ),
      );
      localInput.current = { target: value, time: performance.now() };
      current.current.onInput(value);
    }
    return p;
  }
  return (
    <canvas
      ref={canvas}
      className="game-canvas"
      aria-label="Survival Pong arena. Defend your wall with mouse movement, A/D, arrow keys, or touch sliding."
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
