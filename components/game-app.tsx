'use client';
/* Shared with the standalone Vercel client: native navigation and wallet data-URI icons. */
/* eslint-disable next/no-html-link-for-pages, next/no-img-element */
import '@/lib/polyfills';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import {
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Hexagon,
  LoaderCircle,
  LogOut,
  RotateCcw,
  Shield,
  Trophy,
  Users,
  VolumeX,
  Wallet as WalletIcon,
  X,
  Zap,
} from 'lucide-react';
import { BN } from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { Wallet } from '@wallet-standard/base';
import Arena from '@/components/arena';
import NetworkActivity from '@/components/network-activity';
import { ensureCommitted, isTerminalRace } from '@/lib/settlement';
import { Physics, COLORS, type Snapshot, type Vec } from '@/lib/physics';
import * as chain from '@/lib/chain';
import GameGuide, { type GuidePage } from './game-guide';
type Mode = 'practice' | 'free' | 'wager';
export default function GameApp() {
  const [engine, setEngine] = useState<Physics>();
  const [snap, setSnap] = useState<Snapshot>();
  const [mode, setMode] = useState<Mode>('practice');
  const [screen, setScreen] = useState<'home' | 'arena'>('home');
  const [guide, setGuide] = useState<GuidePage>();
  const [setupCost, setSetupCost] = useState<{
    rent: number;
    session: number;
  }>();
  useEffect(() => {
    let closed = false;
    void chain
      .hostSetupCost()
      .then((cost) => {
        if (!closed) setSetupCost(cost);
      })
      .catch(() => {});
    return () => {
      closed = true;
    };
  }, []);
  const [running, setRunning] = useState(false);
  const [name, setName] = useState('PLAYER ONE');
  const [muted, setMuted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [sabotage, setSabotage] = useState(true);
  const [hazard, setHazard] = useState(0);
  const [wallet, setWallet] = useState<chain.BrowserWallet>();
  const [walletOptions, setWalletOptions] = useState<Wallet[]>([]);
  const [showWallets, setShowWallets] = useState(false);
  const [balance, setBalance] = useState<number>();
  const [roomId, setRoomId] = useState<PublicKey>();
  const [room, setRoom] = useState<chain.Room>();
  const [escrow, setEscrow] = useState<chain.Escrow | null>(null);
  const [match, setMatch] = useState<chain.Match>();
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clock, setClock] = useState(Date.now);
  const [snapshotTime, setSnapshotTime] = useState(0);
  const [settlement, setSettlement] = useState('');
  const [copied, setCopied] = useState(false);
  const session = useRef<Keypair | undefined>(undefined);
  const target = useRef(5000);
  const latest = useRef({ roomId, room, wallet, match, engine });
  useEffect(() => {
    latest.current = { roomId, room, wallet, match, engine };
  });
  const attemptedSettlement = useRef('');
  const walletDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (showWallets) walletDialog.current?.showModal();
  }, [showWallets]);
  const online = !!roomId;
  const inviteCode = room ? chain.roomCode(room.nonce.toNumber()) : undefined;
  useEffect(() => {
    if (!roomId || !inviteCode) return;
    const url = new URL(window.location.href);
    url.searchParams.set('room', inviteCode);
    window.history.replaceState({}, '', url);
  }, [roomId, inviteCode]);
  const localPlayer =
    online && room && wallet
      ? room.players
          .slice(0, room.count)
          .findIndex((p) => p.equals(wallet.publicKey))
      : online
        ? -1
        : 0;
  const names =
    online && room
      ? Array.from({ length: 8 }, (_, i) =>
          i < room.count
            ? chain.playerName(room, i)
            : 'BOT ' + String(i + 1).padStart(2, '0'),
        )
      : [
          name,
          ...Array.from(
            { length: 7 },
            (_, i) => 'BOT ' + String(i + 2).padStart(2, '0'),
          ),
        ];
  const finished = !!snap?.game.finished;
  const out =
    !!snap && localPlayer >= 0 && snap.game.players[localPlayer]?.lives === 0;
  const active = online ? match?.status === 1 : running;
  const arenaPanel = useRef<HTMLElement>(null);
  const focusArena = useCallback(() => {
    if (window.matchMedia('(max-width: 800px), (pointer: coarse)').matches)
      arenaPanel.current?.scrollIntoView({
        behavior: 'instant',
        block: 'start',
      });
  }, []);
  useEffect(() => {
    if (active && screen === 'arena') focusArena();
  }, [active, screen, focusArena]);
  const countdown = room?.countdown.toNumber()
    ? Math.max(0, room.countdown.toNumber() - Math.floor(clock / 1000))
    : null;
  // This mount effect hydrates browser-only preferences and the invitation URL.
  /* oxlint-disable react/react-compiler */
  useEffect(() => {
    let disposed = false;
    Physics.create()
      .then((e) => {
        if (disposed) return;
        const s = e.init(8, 8429, 255);
        setEngine(e);
        setSnap(s);
      })
      .catch((e) => setError(e.message));
    const params = new URLSearchParams(window.location.search);
    const value = params.get('room');
    if (value) {
      void chain
        .resolveRoom(value)
        .then((id) => {
          if (!disposed) {
            setRoomId(id);
            setScreen('arena');
            setMode('free');
          }
        })
        .catch((e) => {
          if (!disposed) setError(e.message);
        });
    }
    setName(localStorage.getItem('ultrapong.name') || 'PLAYER ONE');
    setMuted(localStorage.getItem('ultrapong.muted') === 'true');
    setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  /* oxlint-enable react/react-compiler */
  useEffect(() => {
    localStorage.setItem('ultrapong.name', name);
  }, [name]);
  useEffect(() => {
    localStorage.setItem('ultrapong.muted', String(muted));
    const fn = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'm' &&
        !(e.target as HTMLElement).matches('input')
      )
        setMuted((m) => !m);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [muted]);
  const refresh = useCallback(async () => {
    const { roomId, wallet } = latest.current;
    if (!roomId) return;
    const r = await chain.readRoom(roomId);
    setRoom(r);
    setMode(r.wager ? 'wager' : 'free');
    setSabotage(r.sabotage);
    setEscrow(await chain.readEscrow(roomId));
    if (wallet) {
      setBalance((await chain.base.getBalance(wallet.publicKey)) / 1e9);
      session.current = chain.sessionFor(roomId, wallet.publicKey);
    }
  }, []);
  useEffect(() => {
    if (!roomId) return;
    let dead = false;
    const load = () => refresh().catch((e) => !dead && setError(e.message));
    void load();
    const subscription = chain.base.onAccountChange(roomId, () => void load(), {
      commitment: 'confirmed',
    });
    const timer = setInterval(load, 5000);
    return () => {
      dead = true;
      clearInterval(timer);
      void chain.base.removeAccountChangeListener(subscription);
      setRoom(undefined);
      setMatch(undefined);
    };
  }, [roomId, refresh, wallet]);
  const roundNumber = room?.round.toString();
  const roomState = room?.state;
  useEffect(() => {
    if (
      !roomId ||
      roundNumber === undefined ||
      roomState === undefined ||
      !engine
    )
      return;
    if (roomState === 0) {
      queueMicrotask(() => {
        setMatch(undefined);
        setSettlement('');
        setSnap(engine.init(8, 8429, 255));
      });
      return;
    }
    let closed = false;
    let sequenceSlot = -1;
    const game = chain.addresses(roomId, new BN(roundNumber)).game;
    const connection = roomState >= 2 ? chain.base : chain.er;
    async function accept(data: Buffer, slot: number) {
      if (closed || slot < sequenceSlot) return;
      const m = await chain.decode<chain.Match>('MatchState', data);
      if (closed || slot < sequenceSlot || !m.data.length) return;
      sequenceSlot = slot;
      setMatch(m);
      setNotice((n) =>
        n === 'Connection interrupted. Reconnecting…' ? '' : n,
      );
      engine!.load(m.data);
      const received = performance.now();
      const authoritative = engine!.snapshot();
      engine!.networkFrames.push(authoritative, received);
      setSnapshotTime(received);
      setSnap(authoritative);
      if (localPlayer >= 0) engine!.input(localPlayer, target.current);
    }
    const id = connection.onAccountChange(
      game,
      (a, c) => void accept(a.data, c.slot).catch((e) => setError(e.message)),
      { commitment: 'confirmed' },
    );
    const poll = async () => {
      try {
        const info = await connection.getAccountInfoAndContext(game);
        if (info.value) await accept(info.value.data, info.context.slot);
      } catch {
        if (!closed) setNotice('Connection interrupted. Reconnecting…');
      }
    };
    void poll();
    const interval = setInterval(poll, 1500);
    return () => {
      closed = true;
      clearInterval(interval);
      void connection.removeAccountChangeListener(id);
    };
  }, [roomId, roundNumber, roomState, engine, localPlayer]);
  useEffect(() => {
    if (!online || match?.status !== 1 || localPlayer < 0 || !session.current)
      return;
    let inFlight = false,
      confirmationInFlight = false,
      lastTarget = -1,
      lastSent = 0,
      lastConfirmed = 0,
      closed = false;
    const timer = setInterval(async () => {
      const { roomId, room } = latest.current;
      if (closed || inFlight || !roomId || !room || !session.current) return;
      if (
        Math.abs(target.current - lastTarget) < 20 &&
        Date.now() - lastSent < 1000
      )
        return;
      inFlight = true;
      try {
        const value = Math.round(target.current);
        const ix = await chain.instruction(
          'input',
          { sequence: new BN(Date.now()), target: value },
          {
            signer: session.current.publicKey,
            game: chain.addresses(roomId, room.round).game,
          },
        );
        const signature = await chain.sendSession(session.current, [ix], false);
        // Check execution independently so slow confirmations cannot stall touch input.
        if (!confirmationInFlight && Date.now() - lastConfirmed > 3000) {
          confirmationInFlight = true;
          lastConfirmed = Date.now();
          void chain
            .confirmSession(signature)
            .catch((e) => {
              if (!closed && latest.current.match?.status === 1)
                setNotice(
                  isTerminalRace(e)
                    ? 'Round ended. Syncing the final result…'
                    : 'Paddle input not confirmed. Use Reconnect paddle if movement stops.',
                );
            })
            .finally(() => {
              confirmationInFlight = false;
            });
        }
        lastTarget = value;
        lastSent = Date.now();
        setNotice((n) =>
          n === 'Input connection interrupted. Reconnecting…' ? '' : n,
        );
      } catch (e) {
        if (!closed && latest.current.match?.status === 1)
          setNotice(
            isTerminalRace(e)
              ? 'Round ended. Syncing the final result…'
              : e instanceof Error &&
                  e.message.includes('Game transaction failed')
                ? 'Paddle session rejected. Use Reconnect paddle.'
                : 'Input connection interrupted. Reconnecting…',
          );
      } finally {
        inFlight = false;
      }
    }, 50);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [online, match?.status, localPlayer]);
  const action = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };
  function chooseMode(m: Mode) {
    if (online || running) return;
    setMode(m);
    setError('');
  }
  const practice = useCallback(() => {
    if (!engine) return;
    setMode('practice');
    setSnap(
      engine.init(
        8,
        crypto.getRandomValues(new Uint32Array(1))[0],
        254,
        sabotage,
      ),
    );
    setRunning(true);
    setScreen('arena');
    focusArena();
    setError('');
    target.current = 5000;
  }, [engine, sabotage, focusArena]);
  function openWallets() {
    setWalletOptions(chain.wallets());
    setShowWallets(true);
  }
  async function connect(w: Wallet) {
    await action('Connecting wallet', async () => {
      const connected = await chain.connectWallet(w);
      setWallet(connected);
      setBalance((await chain.base.getBalance(connected.publicKey)) / 1e9);
      setShowWallets(false);
    });
  }
  function selectRoom(id: PublicKey) {
    setScreen('arena');
    setRoomId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('room', id.toBase58());
    history.replaceState(null, '', url);
    setRunning(false);
    setSettlement('');
    setMatch(undefined);
    if (engine) setSnap(engine.init(8, 8429, 255));
  }
  async function create() {
    if (!wallet) return openWallets();
    await action('Creating room', async () => {
      selectRoom(
        await chain.createRoom(
          wallet,
          mode === 'wager',
          sabotage,
          name || 'PLAYER',
        ),
      );
    });
  }
  async function join() {
    if (!wallet) return openWallets();
    if (!roomId || !room) return;
    await action(
      room.wager ? 'Confirming your entry' : 'Joining room',
      async () => {
        session.current = await chain.joinRoom(
          wallet,
          roomId,
          room,
          name || 'PLAYER',
        );
        await refresh();
      },
    );
  }
  async function ready() {
    if (!wallet || !roomId) return;
    await action('Readying up', async () => {
      await chain.readyRoom(wallet, roomId);
      await refresh();
    });
  }
  async function launch() {
    if (!wallet || !roomId || !room) return;
    focusArena();
    await action('Starting match', async () => {
      if (room.state === 0) await chain.lockRoom(wallet, roomId, room);
      await refresh();
      session.current ??= chain.sessionFor(roomId, wallet.publicKey);
      await chain.activateMatch(session.current, roomId, room);
      setNotice('Match connected');
    });
  }
  async function recoverSession() {
    if (!wallet || !roomId || !room) return;
    await action('Reconnecting your paddle', async () => {
      session.current = await chain.renewSession(wallet, roomId, room);
      setNotice('Paddle reconnected');
    });
  }
  async function payout() {
    if (!wallet || !roomId || !room || !engine || !session.current) return;
    await action('Settling match', async () => {
      const game = chain.addresses(roomId, room.round).game;
      await ensureCommitted({
        isCommitted: async () =>
          !!(await chain.base.getAccountInfo(game))?.owner.equals(
            chain.PROGRAM,
          ),
        finalize: () => chain.finalizeMatch(session.current!, game),
        wait: () => chain.delay(500),
      });
      const a = await chain.base.getAccountInfo(game);
      if (!a || !a.owner.equals(chain.PROGRAM))
        throw Error('Final result is still settling. You can retry safely.');
      const m = await chain.decode<chain.Match>('MatchState', a.data);
      engine.load(m.data);
      const result = engine.snapshot();
      const latestRoom = await chain.readRoom(roomId);
      if (latestRoom.state >= 2) {
        setNotice(
          latestRoom.state === 2
            ? 'Match settled. The winner has been paid.'
            : 'Draw or expired match. Stakes are available to reclaim.',
        );
        await refresh();
        return;
      }
      let signature: string;
      try {
        signature = await chain.settleWithSession(
          session.current!,
          roomId,
          room,
          result.game.winner,
        );
      } catch (e) {
        const updated = await chain.readRoom(roomId);
        if (updated.state >= 2) {
          setNotice('Match already settled by another player.');
          await refresh();
          return;
        }
        throw e;
      }
      setSettlement(signature);
      await refresh();
    });
  }
  const automaticPayout = useEffectEvent(() => payout());
  useEffect(() => {
    const attemptKey = roomId?.toBase58() + '/' + roundNumber;
    if (
      match?.status === 2 &&
      roomState === 1 &&
      wallet &&
      localPlayer >= 0 &&
      attemptedSettlement.current !== attemptKey &&
      !busy
    ) {
      attemptedSettlement.current = attemptKey;
      void automaticPayout();
    }
  }, [
    match?.status,
    roomState,
    wallet,
    localPlayer,
    busy,
    roomId,
    roundNumber,
  ]);
  function leave() {
    setScreen('home');
    setRunning(false);
    setRoomId(undefined);
    setRoom(undefined);
    setMatch(undefined);
    session.current = undefined;
    history.replaceState(null, '', location.pathname);
    setNotice('');
    setError('');
    setSettlement('');
    if (engine) setSnap(engine.init(8, 8429, 255));
  }
  async function drop(p: Vec) {
    if (!engine || localPlayer < 0) return;
    if (!online) {
      const ok = engine.place(localPlayer, hazard, p);
      if (!ok)
        setNotice(
          'Placement refused: keep clear of walls and hazards, and wait for your cooldown.',
        );
      else setNotice('');
      return;
    }
    if (!roomId || !room || !session.current) return;
    try {
      await chain.sendSession(session.current, [
        await chain.instruction(
          'hazard',
          {
            sequence: new BN(Date.now()),
            kind: hazard,
            x: Math.round(p.x),
            y: Math.round(p.y),
          },
          {
            signer: session.current.publicKey,
            game: chain.addresses(roomId, room.round).game,
          },
        ),
      ]);
      setNotice('');
    } catch {
      setNotice(
        'Placement refused: keep clear of walls and hazards, and wait for your cooldown.',
      );
    }
  }
  const onInput = useCallback(
    (value: number) => {
      target.current = value;
      const { engine } = latest.current;
      if (engine && localPlayer >= 0) engine.input(localPlayer, value);
    },
    [localPlayer],
  );
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => void;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    context.registerTool(
      {
        name: 'start_ultrapong_practice',
        description:
          'Start a fresh offline practice round against seven bots. Does not connect a wallet or wager.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: (input: unknown) => {
          if (input && Object.keys(input as object).length)
            throw Error('No inputs expected');
          if (latest.current.roomId)
            throw Error('Leave the online room before starting practice');
          if (!latest.current.engine) throw Error('Game is loading');
          practice();
          return { mode: 'practice', players: 8 };
        },
      },
      { signal: lifecycle.signal },
    );
    context.registerTool(
      {
        name: 'read_ultrapong_match',
        description: 'Read the visible match status and player lives.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        execute: () => {
          const s = latest.current.engine?.snapshot();
          return s
            ? {
                tick: s.game.tick,
                finished: s.game.finished,
                winner: s.game.winner,
                lives: s.game.players.map((p) => p.lives),
              }
            : { loading: true };
        },
      },
      { signal: lifecycle.signal },
    );
    return () => lifecycle.abort();
  }, [engine, sabotage, practice]);
  const winnerName =
    snap && snap.game.winner >= 0 ? names[snap.game.winner] : 'Draw';
  const home = () => {
    setGuide(undefined);
    if (online) setScreen('home');
    else leave();
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  return (
    <main className="shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            home();
          }}
        >
          <Hexagon size={30} />
          <span>
            ULTRA<span className="brand-light">PONG</span>
            <sup>●</sup>
          </span>
        </a>
        <div className="network">
          <span className="status-dot" /> SOLANA DEVNET{' '}
          <span className="network-divider" /> POWERED BY MAGICBLOCK
        </div>
        <button className="wallet" onClick={openWallets}>
          <WalletIcon size={16} />
          {wallet ? chain.short(wallet.publicKey) : 'Connect wallet'}
          {wallet && balance !== undefined && (
            <span className="wallet-balance">{balance.toFixed(3)} SOL</span>
          )}
        </button>
      </header>
      <nav className="game-nav" aria-label="Game navigation">
        <button
          aria-current={screen === 'home' ? 'page' : undefined}
          onClick={home}
        >
          Home
        </button>
        <button
          aria-current={screen === 'arena' ? 'page' : undefined}
          onClick={() => setScreen('arena')}
        >
          Arena
        </button>
        <button onClick={() => setGuide('rules')}>How to play</button>
        <button onClick={() => setGuide('tutorial')}>Tutorial</button>
        <button onClick={() => setGuide('network')}>How it works</button>
        <span className="nav-network">DEVNET · TEST SOL</span>
      </nav>
      {guide && (
        <GameGuide
          key={guide}
          page={guide}
          onClose={() => setGuide(undefined)}
          onPractice={practice}
          online={online}
        />
      )}
      {screen === 'home' ? (
        <section className="home-screen" aria-labelledby="home-title">
          <span className="eyebrow">EIGHT WALLS. ONE SURVIVOR.</span>
          <h1 id="home-title">
            Last wall
            <br />
            <span>standing.</span>
          </h1>
          <p className="home-description">
            A survival Pong arena for you and your rivals. Defend your edge.
            Outlast the room.
          </p>
          {online ? (
            <div className="home-resume">
              <h2>Your room is still open</h2>
              <p>
                {active
                  ? 'Your online match continues. Return to defend your wall.'
                  : 'Return to your lobby to play with your friends.'}
              </p>
              <button
                className="primary-button"
                onClick={() => setScreen('arena')}
              >
                Return to arena <ArrowUpRight size={18} />
              </button>
              <button className="text-button" onClick={leave}>
                Leave room
              </button>
            </div>
          ) : (
            <div className="home-modes">
              <button disabled={!engine} onClick={practice}>
                <Zap size={25} />
                <strong>Warm up</strong>
                <span>
                  You and seven bots.
                  <br />
                  No wallet needed.
                </span>
                <b>PLAY SOLO ↗</b>
              </button>
              <button
                onClick={() => {
                  chooseMode('free');
                  setScreen('arena');
                }}
              >
                <Users size={25} />
                <strong>Play with friends</strong>
                <span>
                  Host or join a room.
                  <br />
                  No wager. Setup fees apply.
                </span>
                <b>OPEN LOBBY ↗</b>
              </button>
              <button
                onClick={() => {
                  chooseMode('wager');
                  setScreen('arena');
                }}
              >
                <Trophy size={25} />
                <strong>Winner takes all</strong>
                <span>
                  0.01 Devnet SOL per player.
                  <br />
                  Last survivor takes the pot.
                </span>
                <b>OPEN WAGER LOBBY ↗</b>
              </button>
            </div>
          )}
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </section>
      ) : (
        <div className="workspace">
          <section ref={arenaPanel} className="arena-panel">
            <div className="arena-heading">
              <div>
                <span className="eyebrow">
                  {active ? 'THE PRESSURE IS ON' : 'THE LAST WALL STANDING'}
                </span>
                <h1>
                  {finished
                    ? snap?.game.winner < 0
                      ? 'The round is a draw'
                      : 'One wall remains'
                    : out
                      ? 'Time to get even'
                      : active
                        ? 'Defend your edge'
                        : 'Enter the arena'}
                  <span>.</span>
                </h1>
              </div>
              <span className="pill">
                <span className="status-dot" />
                {online
                  ? room?.wager
                    ? 'WAGER ROOM'
                    : 'FRIENDS ROOM'
                  : 'PRACTICE ARENA'}
              </span>
              {!online && running && (
                <button className="menu-button" onClick={leave}>
                  <LogOut size={15} /> Main menu
                </button>
              )}
            </div>
            <div className="arena-stage">
              <div className="arena-grain" />
              {engine ? (
                <Arena
                  engine={engine}
                  running={!!active}
                  online={online}
                  localPlayer={localPlayer}
                  names={names}
                  hazard={hazard}
                  muted={muted}
                  reduced={reduced}
                  onSnapshot={online ? () => {} : setSnap}
                  onInput={onInput}
                  onPlace={drop}
                  snapshotTime={snapshotTime}
                />
              ) : (
                <div className="loading-engine">
                  <LoaderCircle className="spin" /> Loading arena…
                </div>
              )}
              {!active && !finished && !online && (
                <div className="arena-hint">
                  <span>YOUR WALL. YOUR REFLEXES.</span>
                  <span>
                    Choose a mode to begin <ArrowUpRight size={14} />
                  </span>
                </div>
              )}
              {finished && (
                <div className="result-overlay">
                  <Trophy size={32} />
                  <span className="eyebrow">
                    {snap?.game.winner < 0
                      ? 'ROUND COMPLETE'
                      : 'LAST WALL STANDING'}
                  </span>
                  <h2>{winnerName}</h2>
                  <p>
                    {online && room?.wager
                      ? snap?.game.winner < 0
                        ? 'Draw — each player can reclaim their stake.'
                        : escrow?.state === 1
                          ? 'The entire pot has been paid.'
                          : 'Payout pending on Solana Devnet.'
                      : snap?.game.winner === localPlayer
                        ? 'You held the line.'
                        : 'Every round is a fresh start.'}
                  </p>
                  {!online && (
                    <button className="primary-button" onClick={practice}>
                      Run it back <RotateCcw size={17} />
                    </button>
                  )}
                </div>
              )}
              <div className="stage-corner">
                <span>
                  {String(
                    snap?.game.players.filter((p) => p.lives > 0).length ?? 8,
                  ).padStart(2, '0')}
                </span>{' '}
                / {String(snap?.game.players.length ?? 8).padStart(2, '0')}{' '}
                SIDES
              </div>
              <div className="stage-coordinate">
                {online ? 'MAGICBLOCK ER' : 'LOCAL SIMULATION'}{' '}
                <span>
                  {active && snap
                    ? Math.floor(snap.game.tick / 1200) +
                      ':' +
                      String(Math.floor(snap.game.tick / 20) % 60).padStart(
                        2,
                        '0',
                      )
                    : 'READY WHEN YOU ARE'}
                </span>
              </div>
            </div>
            <div className="arena-footer">
              <span>
                <span className="keycap">↔</span> Mouse · A/D · Arrows{' '}
                <span className="footer-divider" /> Drag on mobile
              </span>
              <div className="footer-actions">
                <label title="Reduce glow and ball trails">
                  <input
                    type="checkbox"
                    checked={reduced}
                    onChange={(e) => setReduced(e.target.checked)}
                  />{' '}
                  Less motion
                </label>
                <button
                  className="icon-button"
                  aria-label={muted ? 'Unmute sound' : 'Mute sound'}
                  onClick={() => setMuted(!muted)}
                >
                  {muted ? <VolumeX size={19} /> : <AudioLines size={19} />}
                </button>
              </div>
            </div>
            {active && snap && (
              <div className="live-strip">
                <span>
                  <b>{snap.game.balls.length}</b> BALL
                  {snap.game.balls.length !== 1 ? 'S' : ''}
                </span>
                <span>
                  <b>
                    {localPlayer >= 0
                      ? (snap.game.players[localPlayer]?.hits ?? 0)
                      : '—'}
                  </b>{' '}
                  RETURNS
                </span>
                <span>
                  {snap.game.tick >= 2400
                    ? 'ARENA SHRINKING'
                    : snap.game.balls.length > 1
                      ? 'TRIPLE BALL'
                      : 'STAGE ' + (snap.game.generation + 1)}
                </span>
              </div>
            )}
            {active && (
              <div className="powerup-legend">
                <span>HIT A CENTER PICKUP</span>
                <b>↔ Expand</b>
                <b>↦↤ Shrink</b>
                <b>3× Split</b>
                <small>Last hitter gets the effect · 10s paddle effects</small>
              </div>
            )}
            <NetworkActivity
              room={roomId?.toBase58()}
              game={
                roomId && room
                  ? chain.addresses(roomId, room.round).game.toBase58()
                  : undefined
              }
              tick={online ? snap?.game.tick : undefined}
            />
          </section>
          <aside className="control-panel">
            <div className="panel-intro">
              <span className="eyebrow">
                {online ? 'BRING YOUR RIVALS' : 'MAKE YOUR NEXT MOVE'}
              </span>
              <h2>
                {online
                  ? 'Match lobby'
                  : active
                    ? 'Practice session'
                    : 'Choose your game'}
              </h2>
              <p>
                {online && room?.wager
                  ? '0.01 Devnet SOL per player. No house fee.'
                  : 'Eight walls. Two lives. One survivor.'}
              </p>
            </div>
            {!online && !running && (
              <>
                <div className="mode-label">
                  CHOOSE YOUR MODE <span>01 — 03</span>
                </div>
                <div className="mode-list">
                  {[
                    {
                      id: 'practice' as Mode,
                      icon: Zap,
                      title: 'Warm up',
                      sub: 'You + 7 bots. No wallet needed.',
                      tag: 'SOLO',
                    },
                    {
                      id: 'free' as Mode,
                      icon: Users,
                      title: 'Play with friends',
                      sub: 'One link. Up to eight players.',
                      tag: 'NO WAGER',
                    },
                    {
                      id: 'wager' as Mode,
                      icon: Shield,
                      title: 'Winner takes all',
                      sub: 'Put your reflexes on the line.',
                      tag: '0.01 SOL',
                    },
                  ].map((m) => (
                    <button
                      key={m.id}
                      className={
                        'mode-card ' + (mode === m.id ? 'selected' : '')
                      }
                      onClick={() => chooseMode(m.id)}
                    >
                      <m.icon size={22} />
                      <span>
                        <strong>{m.title}</strong>
                        <small>{m.sub}</small>
                      </span>
                      <em>{m.tag}</em>
                    </button>
                  ))}
                </div>
              </>
            )}
            {!running && (!online || room?.state === 0) && (
              <>
                <label className="field-label" htmlFor="name">
                  YOUR CALLSIGN
                </label>
                <input
                  id="name"
                  className="name-input"
                  maxLength={16}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </>
            )}
            {!online && !running && (
              <>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={sabotage}
                    onChange={(e) => setSabotage(e.target.checked)}
                  />
                  <span>Sabotage after elimination</span>
                </label>
                <button
                  className="primary-button"
                  disabled={!!busy || !engine}
                  onClick={mode === 'practice' ? practice : create}
                >
                  {busy ||
                    (mode === 'practice'
                      ? 'Enter practice'
                      : wallet
                        ? mode === 'wager'
                          ? 'Create & enter · 0.01 SOL'
                          : 'Create & ready up'
                        : 'Connect to play')}
                  {busy ? (
                    <LoaderCircle className="spin" size={19} />
                  ) : (
                    <ArrowUpRight size={21} />
                  )}
                </button>
                <div className="mode-note">
                  <Globe size={14} />
                  {mode === 'practice'
                    ? 'Jump straight in. Learn by surviving.'
                    : 'Devnet SOL only · Fees separate from the pot'}
                </div>
                {mode !== 'practice' && (
                  <p className="fee-note">
                    {mode === 'wager' ? 'Entry: 0.01 Devnet SOL. ' : ''}One
                    approval creates the room, enters you, and marks you ready.
                    {setupCost ? (
                      <>
                        Host setup: ~
                        {(setupCost.rent + setupCost.session).toFixed(5)} Devnet
                        SOL ({setupCost.rent.toFixed(5)} account storage + 0.002
                        session funding).
                      </>
                    ) : (
                      <>
                        Hosting funds onchain accounts and a 0.002 SOL gameplay
                        session.
                      </>
                    )}{' '}
                    {mode === 'free'
                      ? 'No wager.'
                      : 'Plus your 0.01 SOL wager.'}{' '}
                    Network fees and the later delegation transaction are
                    additional. Account storage is not automatically refunded.
                  </p>
                )}
                {mode !== 'practice' && (
                  <div className="join-input">
                    <input
                      aria-label="Six-character room code or invite link"
                      placeholder="Room code, e.g. A7B2C9"
                      autoCapitalize="characters"
                      spellCheck={false}
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                    />
                    <button
                      disabled={!!busy}
                      onClick={() =>
                        action('Finding room', async () =>
                          selectRoom(await chain.resolveRoom(joinCode)),
                        )
                      }
                    >
                      Join <ChevronRight size={15} />
                    </button>
                  </div>
                )}
              </>
            )}
            {online && roomId && (
              <>
                <button
                  className="invite-button"
                  onClick={async () => {
                    const code = room && chain.roomCode(room.nonce.toNumber());
                    await navigator.clipboard.writeText(
                      location.origin + '/?room=' + (code || roomId.toBase58()),
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
                  {copied ? 'Invite link copied' : 'Copy invite link'}
                  <span className="room-code">
                    {room
                      ? chain.roomCode(room.nonce.toNumber()) ||
                        chain.short(roomId)
                      : '…'}
                  </span>
                </button>
                {room && (
                  <>
                    <details className="room-details">
                      <summary>Room address & alternate invite</summary>
                      <code>{roomId.toBase58()}</code>
                      <button
                        className="text-button"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            location.origin + '/?room=' + roomId.toBase58(),
                          )
                        }
                      >
                        Copy full invite link
                      </button>
                    </details>
                    <div className="room-meta">
                      <span>{room.count} / 8 PLAYERS</span>
                      <span>
                        {room.sabotage ? 'SABOTAGE ON' : 'SABOTAGE OFF'}
                      </span>
                    </div>
                    <div className="roster">
                      {Array.from(
                        { length: room.wager ? Math.max(2, room.count) : 8 },
                        (_, i) => (
                          <div
                            key={i}
                            className={
                              'roster-row ' +
                              (i === localPlayer ? 'is-you' : '')
                            }
                          >
                            <span
                              className="player-orb"
                              style={{ background: COLORS[i] }}
                            />
                            <span>
                              {i < room.count
                                ? chain.playerName(room, i)
                                : room.wager
                                  ? 'Waiting for rival…'
                                  : 'BOT ' + String(i + 1).padStart(2, '0')}
                            </span>
                            <small>
                              {i < room.count
                                ? room.state === 0
                                  ? room.ready[i]
                                    ? 'READY'
                                    : 'JOINED'
                                  : (snap?.game.players[i]?.lives ?? 0) > 0
                                    ? '◆'.repeat(snap!.game.players[i].lives)
                                    : 'OUT'
                                : room.wager
                                  ? '—'
                                  : room.state === 0
                                    ? 'FILL SEAT'
                                    : (snap?.game.players[i]?.lives ?? 0) > 0
                                      ? '◆'.repeat(snap!.game.players[i].lives)
                                      : 'OUT'}
                            </small>
                          </div>
                        ),
                      )}
                    </div>
                    {room.wager && (
                      <div className="pot-display">
                        <span>WINNER TAKES ALL</span>
                        <strong>
                          {(room.count * 0.01).toFixed(2)}{' '}
                          <small>DEVNET SOL</small>
                        </strong>
                      </div>
                    )}
                    {room.state === 0 && localPlayer < 0 && (
                      <>
                        <p className="fee-note">
                          {room.wager ? 'Entry: 0.01 Devnet SOL. ' : ''}Joining
                          funds a 0.002 SOL gameplay session. Network fees are
                          additional.
                        </p>
                        <button
                          className="primary-button"
                          disabled={!!busy || room.count >= 8}
                          onClick={join}
                        >
                          {busy ||
                            (wallet
                              ? room.wager
                                ? 'Join & ready · 0.01 SOL'
                                : 'Join & ready up'
                              : 'Connect wallet to join')}
                          <ArrowUpRight size={19} />
                        </button>
                      </>
                    )}
                    {room.state === 0 && localPlayer >= 0 && (
                      <>
                        {!room.ready[localPlayer] ? (
                          <button
                            className="primary-button"
                            disabled={!!busy}
                            onClick={ready}
                          >
                            {busy || 'Ready up'}
                            <Check size={19} />
                          </button>
                        ) : (
                          <button
                            className="primary-button"
                            disabled={!!busy || countdown !== 0}
                            onClick={launch}
                          >
                            {busy ||
                              (countdown === null
                                ? 'Waiting for players'
                                : countdown > 0
                                  ? 'Starting in ' + countdown + '…'
                                  : 'Launch match')}
                            <Zap size={19} />
                          </button>
                        )}
                        <button
                          className="text-button"
                          disabled={!!busy}
                          onClick={() =>
                            action('Withdrawing', async () => {
                              await chain.withdrawRoom(wallet!, roomId);
                              await refresh();
                            })
                          }
                        >
                          Leave lobby{room.wager ? ' & refund entry' : ''}
                        </button>
                      </>
                    )}
                    {room.state === 1 && !match && localPlayer >= 0 && (
                      <button
                        className="primary-button"
                        disabled={!!busy}
                        onClick={launch}
                      >
                        {busy || 'Connect to match'}
                        <Zap size={19} />
                      </button>
                    )}
                    {room.state === 1 && localPlayer < 0 && (
                      <div className="spectator-note">
                        This round has started. Watch it out and join the next
                        one.
                      </div>
                    )}
                    {room.state === 1 &&
                      match?.status === 1 &&
                      localPlayer >= 0 && (
                        <button
                          className="text-button"
                          disabled={!!busy}
                          onClick={recoverSession}
                        >
                          Reconnect paddle
                        </button>
                      )}
                    {finished && room.state === 1 && (
                      <button
                        className="primary-button"
                        disabled={!!busy}
                        onClick={payout}
                      >
                        {busy || 'Retry settlement'}
                        <ArrowUpRight size={19} />
                      </button>
                    )}
                    {settlement && (
                      <a
                        className="receipt"
                        href={chain.receipt(settlement)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View settlement receipt <ExternalLink size={14} />
                      </a>
                    )}
                    {localPlayer >= 0 &&
                      escrow &&
                      escrow.state !== 1 &&
                      (room.state === 3 ||
                        (escrow.deadline.toNumber() > 0 &&
                          clock / 1000 >= escrow.deadline.toNumber())) &&
                      !escrow.refunded[localPlayer] && (
                        <button
                          className="primary-button"
                          disabled={!!busy}
                          onClick={() =>
                            action('Refunding entry', async () => {
                              await chain.sendWallet(wallet!, [
                                await chain.instruction(
                                  'refund',
                                  {},
                                  {
                                    payer: wallet!.publicKey,
                                    ...chain.addresses(roomId),
                                  },
                                ),
                              ]);
                              await refresh();
                            })
                          }
                        >
                          {busy || 'Reclaim your stake'}
                          <ArrowUpRight size={19} />
                        </button>
                      )}
                    {room.state >= 2 && escrow?.total.isZero() && (
                      <button
                        className="primary-button"
                        disabled={!!busy || !wallet}
                        onClick={() =>
                          action('Creating next round', async () => {
                            await chain.sendWallet(wallet!, [
                              await chain.instruction(
                                'next_round',
                                {},
                                {
                                  payer: wallet!.publicKey,
                                  ...chain.addresses(
                                    roomId,
                                    room.round.addn(1),
                                  ),
                                },
                              ),
                            ]);
                            setMatch(undefined);
                            setSettlement('');
                            if (engine) setSnap(engine.init(8, 8429, 255));
                            await refresh();
                          })
                        }
                      >
                        {busy || 'Run it back'}
                        <RotateCcw size={17} />
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            {(running || online) && (
              <>
                {out && sabotage && !finished && (
                  <div className="hazard-panel">
                    <div className="mode-label">YOU’RE OUT. GET EVEN.</div>
                    <p>Pick a hazard, then tap inside the arena.</p>
                    <div className="hazard-buttons">
                      {['PEG', 'WELL', 'SPIN'].map((h, i) => (
                        <button
                          key={h}
                          className={hazard === i ? 'selected' : ''}
                          onClick={() => setHazard(i)}
                        >
                          <span>{['⬡', '◎', '╱'][i]}</span>
                          {h}
                        </button>
                      ))}
                    </div>
                    <div className="cooldown">
                      <span
                        style={{
                          width:
                            100 -
                            Math.max(
                              0,
                              (snap!.game.players[localPlayer].cooldown -
                                snap!.game.tick) /
                                160,
                            ) *
                              100 +
                            '%',
                        }}
                      />
                    </div>
                    <small>
                      {snap &&
                      snap.game.players[localPlayer].cooldown > snap.game.tick
                        ? 'Cooling down…'
                        : 'Ready to place'}{' '}
                      · 12 second lifetime
                    </small>
                  </div>
                )}
                <button className="text-button leave" onClick={leave}>
                  <LogOut size={14} />
                  {online ? 'Leave room' : 'Back to main menu'}
                </button>
              </>
            )}
            {error && (
              <div className="error-message" role="alert">
                <span>{error}</span>
                <button aria-label="Dismiss error" onClick={() => setError('')}>
                  <X size={14} />
                </button>
              </div>
            )}
            {notice && <output className="notice">{notice}</output>}
          </aside>
        </div>
      )}
      <footer className="bottom-bar">
        <span>BUILT FOR RIVALRIES.</span>
        <span className="bottom-right">
          NO DOWNLOADS <i /> NO SECOND CHANCES <i /> JUST ONE MORE ROUND
        </span>
      </footer>
      {showWallets && (
        <dialog
          ref={walletDialog}
          className="wallet-modal"
          aria-modal="true"
          aria-label="Connect a wallet"
          onClose={() => setShowWallets(false)}
        >
          <button
            className="modal-close icon-button"
            aria-label="Close wallet selection"
            onClick={() => setShowWallets(false)}
          >
            <X />
          </button>
          <WalletIcon size={28} />
          <h2>Bring your wallet.</h2>
          <p>
            Online rooms use Solana Devnet. Your wallet approves entry; paddle
            movements use a limited session key.
          </p>
          {walletOptions.length ? (
            walletOptions.map((w) => (
              <button
                className="wallet-choice"
                key={w.name}
                onClick={() => connect(w)}
                disabled={!!busy}
              >
                <img src={w.icon} alt="" width={28} height={28} />
                {w.name}
                <ArrowUpRight size={18} />
              </button>
            ))
          ) : (
            <div className="no-wallet">
              No supported wallet detected. Install a Solana wallet, or open
              this link inside your wallet’s mobile browser.
              <a
                href="https://phantom.com/download"
                target="_blank"
                rel="noreferrer"
              >
                Get Phantom <ExternalLink size={14} />
              </a>
              <button
                className="text-button"
                onClick={() => setWalletOptions(chain.wallets())}
              >
                Refresh wallets
              </button>
            </div>
          )}
          <a
            className="faucet-link"
            href="https://faucet.solana.com/"
            target="_blank"
            rel="noreferrer"
          >
            Need test SOL? Open the Devnet faucet <ExternalLink size={13} />
          </a>
        </dialog>
      )}
    </main>
  );
}
