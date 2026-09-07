export type Network = 'Solana Devnet' | 'MagicBlock ER';
export type Activity = {
  signature: string;
  network: Network;
  label: string;
  status: 'submitted' | 'confirmed' | 'failed';
  time: number;
  slot?: number;
  detail?: string;
};
let rows: Activity[] = [];
const subscribers = new Set<() => void>();
let queued = false;
export function recordActivity(row: Activity) {
  const existing = rows.find(
    (r) => r.signature === row.signature && r.network === row.network,
  );
  // A late submission acknowledgement must not downgrade an RPC confirmation.
  if (existing && existing.status !== 'submitted' && row.status === 'submitted')
    return;
  rows = [
    { ...existing, ...row, time: existing?.time ?? row.time },
    ...rows.filter(
      (r) => r.signature !== row.signature || r.network !== row.network,
    ),
  ].slice(0, 200);
  if (!queued) {
    queued = true;
    setTimeout(() => {
      queued = false;
      subscribers.forEach((fn) => fn());
    }, 100);
  }
}
export const activitySnapshot = () => rows;
const empty: Activity[] = [];
export const serverActivity = () => empty;
export function subscribeActivity(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
export function activityLink(row: Activity) {
  return (
    'https://explorer.solana.com/tx/' +
    row.signature +
    (row.network === 'Solana Devnet'
      ? '?cluster=devnet'
      : '?cluster=custom&customUrl=' +
        encodeURIComponent('https://devnet-as.magicblock.app'))
  );
}
export const actionLabel = (name: string) =>
  ({
    create_room: 'Create room',
    join: 'Enter room',
    ready: 'Ready',
    lock_and_delegate: 'Delegate match to ER',
    request_seed: 'Request verified randomness',
    receive_seed: 'Randomness callback',
    start_crank: 'Start match clock',
    tick: 'Physics tick',
    input: 'Paddle input',
    hazard: 'Place sabotage',
    renew_session: 'Reconnect paddle',
    finalize: 'Commit final result to Solana',
    settle: 'Settle pot',
    refund: 'Refund entry',
    withdraw: 'Leave lobby',
    next_round: 'Open next round',
  })[name] ?? name;
export function logLabel(logs: string[]) {
  const name = logs
    .find((l) => l.includes('Instruction: '))
    ?.split('Instruction: ')[1];
  return name
    ? actionLabel(
        name.replace(/[A-Z]/g, (v, i) => (i ? '_' : '') + v.toLowerCase()),
      )
    : 'Network transaction';
}
