import '@/lib/polyfills';
import { Analytics } from '@vercel/analytics/react';
import { createRoot } from 'react-dom/client';
import GameApp from '@/components/game-app';
import './globals.css';

createRoot(document.getElementById('root')!).render(
  <>
    <GameApp />
    <Analytics />
  </>,
);
