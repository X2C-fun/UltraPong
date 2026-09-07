'use client';
import dynamic from 'next/dynamic';
// Wallet discovery, audio, WebAssembly and the live canvas belong in the browser.
const GameApp = dynamic(() => import('@/components/game-app'), {
  ssr: false,
  loading: () => (
    <main className="shell">
      <p className="loading-engine">Loading UltraPong…</p>
    </main>
  ),
});
export default function Home() {
  return <GameApp />;
}
