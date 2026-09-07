import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The game is entirely client-side; Vercel serves these assets while the
// authoritative match and escrow run on MagicBlock ER and Solana Devnet.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      buffer: createRequire(import.meta.url).resolve('buffer/'),
    },
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: 'dist-vercel' },
});
