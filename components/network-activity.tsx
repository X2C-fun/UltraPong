'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { PublicKey } from '@solana/web3.js';
import {
  Activity as ActivityIcon,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import { base, er, PROGRAM, BASE_URL, ER_URL, short } from '@/lib/chain';
import {
  activitySnapshot,
  serverActivity,
  subscribeActivity,
  recordActivity,
  logLabel,
  activityLink,
  type Network,
} from '@/lib/activity';
export default function NetworkActivity({
  room,
  game,
  tick,
}: {
  room?: string;
  game?: string;
  tick?: number;
}) {
  const rows = useSyncExternalStore(
    subscribeActivity,
    activitySnapshot,
    serverActivity,
  );
  const [open, setOpen] = useState(false),
    [filter, setFilter] = useState('all'),
    [ownerRecord, setOwnerRecord] = useState<{
      game: string;
      owner: string;
    } | null>(null),
    [rpcError, setRpcError] = useState('');
  const owner =
    ownerRecord && ownerRecord.game === game ? ownerRecord.owner : '';
  useEffect(() => {
    if (!open) return;
    let closed = false;
    const listeners: { connection: typeof base; id: number }[] = [];
    const watch = (
      network: Network,
      address: string | undefined,
      connection: typeof base,
    ) => {
      if (!address) return;
      const key = new PublicKey(address);
      const id = connection.onLogs(
        key,
        (result, context) => {
          if (closed) return;
          recordActivity({
            network,
            signature: result.signature,
            label: logLabel(result.logs),
            status: result.err ? 'failed' : 'confirmed',
            detail: result.err ? JSON.stringify(result.err) : undefined,
            time: Date.now(),
            slot: context.slot,
          });
        },
        'confirmed',
      );
      listeners.push({ connection, id });
    };
    watch('Solana Devnet', room, base);
    watch('MagicBlock ER', game, er);
    const inspect = async () => {
      if (!game) return;
      try {
        const info = await base.getAccountInfo(new PublicKey(game));
        if (!closed) {
          setOwnerRecord({ game, owner: info?.owner.toBase58() ?? '' });
          setRpcError('');
        }
      } catch {
        if (!closed)
          setRpcError('The base RPC is temporarily unavailable. Retrying…');
      }
    };
    void inspect();
    const timer = setInterval(inspect, 4000);
    return () => {
      closed = true;
      clearInterval(timer);
      listeners.forEach(
        ({ connection, id }) => void connection.removeOnLogsListener(id),
      );
    };
  }, [open, room, game]);
  return (
    <details
      className="network-activity"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <ActivityIcon size={16} />
        <span>Live network activity</span>
        <small>{room ? 'LIVE' : 'HOW IT WORKS'}</small>
        <ChevronDown size={15} />
      </summary>
      <div className="network-content">
        <p>
          <b>Solana holds the pot.</b> Entry deposits and the final payout
          happen on Devnet.
        </p>
        <p>
          <b>MagicBlock runs the match.</b> The game account moves to its
          Ephemeral Rollup, where signed paddle inputs and a 20 Hz match clock
          update the shared physics. Your browser draws and predicts that state.
        </p>
        <p>
          <b>The result comes back to Solana.</b> Once the match ends, the final
          state is committed and the program pays the recorded winner. Session
          keys move paddles; they cannot withdraw your wallet’s stake.
        </p>
        <div className="network-facts">
          <span>
            Authoritative tick <b>{tick ?? '—'}</b>
          </span>
          <span>
            Base account{' '}
            <b>
              {owner
                ? owner === PROGRAM.toBase58()
                  ? 'On Solana'
                  : 'Delegated'
                : game
                  ? 'Checking…'
                  : 'No active match'}
            </b>
          </span>
        </div>
        <div className="network-endpoints">
          <span>
            Solana RPC <code>{BASE_URL}</code>
          </span>
          <span>
            ER RPC <code>{ER_URL}</code>
          </span>
          {game && (
            <span>
              Match account <code>{game}</code>
            </span>
          )}
          {owner && (
            <span>
              Base account owner <code>{owner}</code>
            </span>
          )}
        </div>
        <label className="activity-filter">
          Show{' '}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All transactions</option>
            <option value="Solana Devnet">Solana only</option>
            <option value="MagicBlock ER">MagicBlock only</option>
            <option value="important">Hide paddle inputs & ticks</option>
          </select>
        </label>
        {game && rpcError && <p className="activity-error">{rpcError}</p>}
        <div className="activity-list">
          {rows
            .filter(
              (r) =>
                filter === 'all' ||
                r.network === filter ||
                (filter === 'important' &&
                  !['Paddle input', 'Physics tick'].includes(r.label)),
            )
            .map((row) => (
              <a
                key={row.network + row.signature}
                href={activityLink(row)}
                target="_blank"
                rel="noreferrer"
                className={'activity-row ' + row.status}
              >
                <span>
                  <b>{row.label}</b>
                  <small>
                    {row.network} · {row.status}
                    {row.slot ? ' · slot ' + row.slot : ''}
                  </small>
                  {row.detail && (
                    <small className="activity-error">{row.detail}</small>
                  )}
                </span>
                <span>
                  <code>{short(row.signature)}</code>
                  <ExternalLink size={12} />
                </span>
              </a>
            ))}
          {!rows.length && (
            <p className="activity-empty">
              Create or join a room to see real transaction signatures here.
              Keep this panel open to watch everyone’s inputs and scheduled
              physics ticks.
            </p>
          )}
        </div>
        <p className="activity-footnote">
          Latest 200 observed transactions. Confirmed rows come from RPC
          responses; links open the matching Devnet or custom ER explorer. A
          submitted row is not yet confirmation.
        </p>
      </div>
    </details>
  );
}
