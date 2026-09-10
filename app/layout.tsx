import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/react';
import './globals.css';
export const metadata: Metadata = {
  title: 'UltraPong — Last wall standing',
  description:
    'Eight walls. Two lives. One survivor. Play survival Pong with friends on Solana Devnet.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
