'use client';
import { useEffect, useRef, useState } from 'react';
import { X, ChevronRight, MousePointer2, Shield, Zap } from 'lucide-react';
export type GuidePage = 'rules' | 'tutorial' | 'network';
export default function GameGuide({
  page,
  onClose,
  onPractice,
  online,
}: {
  page: GuidePage;
  onClose: () => void;
  onPractice: () => void;
  online: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const lessons = [
    {
      icon: MousePointer2,
      title: 'Find your wall',
      text: 'Your colored wall is always at the bottom. Move your mouse across the arena, use A/D or the arrow keys, or slide a finger on mobile.',
    },
    {
      icon: Shield,
      title: 'Time your defense',
      text: 'Meet the ball with your paddle. Off-center returns change its angle. You have two lives: a dashed wall means one remains. Every return speeds the ball up.',
    },
    {
      icon: Zap,
      title: 'Survive the next shape',
      text: 'Collect center pickups to expand or shrink your paddle, or split the ball into three. An elimination clears obstacles and resets to one faster ball. If you are out, drop sabotage until the round ends.',
    },
  ];
  const lesson = lessons[step];
  return (
    <dialog
      ref={dialog}
      className="guide-dialog"
      onCancel={onClose}
      aria-labelledby="guide-title"
    >
      <button
        className="guide-close icon-button"
        aria-label="Close guide"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <span className="eyebrow">ULTRAPONG FIELD GUIDE</span>
      <h2 id="guide-title">
        {page === 'network'
          ? 'Behind the match'
          : page === 'tutorial'
            ? 'Learn in three steps'
            : 'How to play'}
      </h2>
      {online && (
        <p className="guide-notice">
          Your online match continues while this guide is open.
        </p>
      )}
      {page === 'tutorial' ? (
        <>
          <div className="lesson-progress">
            {lessons.map((l, i) => (
              <button
                key={l.title}
                aria-label={'Lesson ' + (i + 1)}
                aria-current={step === i ? 'step' : undefined}
                onClick={() => setStep(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <lesson.icon size={32} className="lesson-icon" />
          <h3>{lesson.title}</h3>
          <p>{lesson.text}</p>
          {step < 2 ? (
            <button
              className="primary-button"
              onClick={() => setStep(step + 1)}
            >
              Next lesson <ChevronRight size={16} />
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={online}
              onClick={() => {
                onClose();
                onPractice();
              }}
            >
              Try it in warmup
            </button>
          )}
        </>
      ) : page === 'rules' ? (
        <>
          {lessons.map((l) => (
            <div className="guide-row" key={l.title}>
              <l.icon size={22} />
              <div>
                <h3>{l.title}</h3>
                <p>{l.text}</p>
              </div>
            </div>
          ))}
          <p>
            The last surviving player wins. Two players finish in a classic Pong
            duel. Each match begins with a 3–2–1 countdown.
          </p>
        </>
      ) : (
        <>
          <div className="network-steps">
            <span>Wallet entry</span>
            <b>→</b>
            <span>MagicBlock match</span>
            <b>→</b>
            <span>Solana payout</span>
          </div>
          <h3>1. Solana holds the room and pot</h3>
          <p>
            Wallet transactions create accounts and enter the room on Devnet.
            Friends mode has no wager, but hosting funds account storage, a
            gameplay session and network fees. Wager mode adds 0.01 Devnet SOL
            per player. Warmup is wallet-free.
          </p>
          <h3>2. MagicBlock runs the shared game</h3>
          <p>
            The match account is delegated to the Asia Ephemeral Rollup. Signed
            session inputs move paddles and a scheduled 20 Hz clock runs the
            physics. Randomness seeds the round. Your browser renders this
            shared state; it cannot choose the winner.
          </p>
          <h3>3. The result returns to Solana</h3>
          <p>
            The final state is committed and undelegated. The program pays the
            entire recorded pot to the winner. Session keys authorize gameplay,
            not wallet withdrawals. Hosting account balances are not stakes and
            are not automatically returned by the current game.
          </p>
          <h3>Verify a transaction yourself</h3>
          <ol>
            <li>
              Open <b>Live network activity</b> under the arena while an online
              match runs.
            </li>
            <li>
              Select <b>MagicBlock only</b>. Physics tick and Paddle input rows
              show real RPC signatures and slots.
            </li>
            <li>
              Open a confirmed row. The explorer uses the custom Asia ER
              endpoint. Inspect the program ID and instruction logs.
            </li>
            <li>
              Select <b>Solana only</b> to inspect entry, delegation and final
              payout on Devnet. A submitted row is still awaiting confirmation.
            </li>
          </ol>
          <p className="guide-links">
            <a
              href="https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-rollup"
              target="_blank"
              rel="noreferrer"
            >
              MagicBlock documentation ↗
            </a>
          </p>
        </>
      )}
    </dialog>
  );
}
