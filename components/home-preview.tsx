'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import Arena from '@/components/arena';
import { Physics, type Snapshot } from '@/lib/physics';
import { THEMES, themeById, type ThemeId } from '@/lib/themes';

const PREVIEW_NAMES = [
  'PLAYER ONE',
  ...Array.from(
    { length: 7 },
    (_, index) => `BOT ${String(index + 2).padStart(2, '0')}`,
  ),
];

const THEME_CYCLE_MS = 2500;
const RESTART_DELAY_MS = 1200;

export default function HomePreview({
  muted,
  reduced,
}: {
  muted: boolean;
  reduced: boolean;
}) {
  const [engine, setEngine] = useState<Physics>();
  const [snap, setSnap] = useState<Snapshot>();
  const [theme, setTheme] = useState<ThemeId>('default');

  useEffect(() => {
    let disposed = false;
    Physics.create()
      .then((previewEngine) => {
        if (disposed) return;
        setSnap(
          previewEngine.init(
            8,
            crypto.getRandomValues(new Uint32Array(1))[0],
            254,
            true,
          ),
        );
        setEngine(previewEngine);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTheme((current) => {
        const index = THEMES.findIndex((option) => option.id === current);
        return THEMES[(index + 1) % THEMES.length].id;
      });
    }, THEME_CYCLE_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!engine || !snap?.game.finished) return;
    const timer = window.setTimeout(() => {
      setSnap(
        engine.init(
          8,
          crypto.getRandomValues(new Uint32Array(1))[0],
          254,
          true,
        ),
      );
    }, RESTART_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [engine, snap?.game.finished]);

  const activeTheme = themeById(theme);

  return (
    <div className="home-showcase home-showcase-live">
      <div className="home-showcase-stage arena-stage" data-theme={theme}>
        {activeTheme.background && (
          <div
            className="arena-backdrop"
            style={{ backgroundImage: `url("${activeTheme.background}")` }}
          />
        )}
        <div className="arena-grain" />
        {engine && snap ? (
          <Arena
            engine={engine}
            running
            online={false}
            localPlayer={0}
            names={PREVIEW_NAMES}
            hazard={0}
            muted={muted}
            reduced={reduced}
            theme={theme}
            preview
            onSnapshot={setSnap}
            onInput={() => {}}
            onPlace={() => {}}
          />
        ) : (
          <div className="loading-engine">
            <LoaderCircle className="spin" /> Loading preview…
          </div>
        )}
      </div>
      <div className="home-showcase-badge">
        LIVE MATCH PREVIEW · {activeTheme.label}
      </div>
    </div>
  );
}
