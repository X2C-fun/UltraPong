import '@/lib/polyfills';
import { createRoot } from 'react-dom/client';
import GameApp from '@/components/game-app';
import './globals.css';

createRoot(document.getElementById('root')!).render(<GameApp />);
