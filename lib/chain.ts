import './polyfills';
import {
  recordActivity,
  actionLabel,
  type Network,
  type Activity,
} from './activity';
import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  BN,
  type Idl,
} from '@coral-xyz/anchor';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from '@magicblock-labs/ephemeral-rollups-sdk';

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
export const PROGRAM = new PublicKey(
  '37DBNkDoLdAgnKrtQfMYSLF7jUZ1HqQsN8fqNKhVYQkh',
);
export const BASE_URL = 'https://rpc.magicblock.app/devnet';
export const ER_URL = 'https://devnet-as.magicblock.app';
export const base = new Connection(BASE_URL, 'confirmed');
export const er = new Connection(ER_URL, {
  commitment: 'confirmed',
  wsEndpoint: 'wss://devnet-as.magicblock.app',
});
export const STAKE = 0.01;
export type Room = {
  creator: PublicKey;
  nonce: BN;
  round: BN;
  wager: boolean;
  sabotage: boolean;
  state: number;
  count: number;
  created: BN;
  countdown: BN;
  players: PublicKey[];
  sessions: PublicKey[];
  names: number[][];
  ready: boolean[];
};
export type Match = {
  room: PublicKey;
  round: BN;
  humans: number;
  status: number;
  scheduled: boolean;
  data: Buffer;
  sequence: BN[];
  start: BN;
  heartbeat: BN[];
  sessions: PublicKey[];
};
export type Escrow = {
  room: PublicKey;
  total: BN;
  deadline: BN;
  state: number;
  refunded: boolean[];
};
type WalletFeature = {
  connect: () => Promise<{ accounts: readonly WalletAccount[] }>;
  signTransaction: (input: {
    account: WalletAccount;
    chain: string;
    transaction: Uint8Array;
  }) => Promise<readonly { signedTransaction: Uint8Array }[]>;
};
export class BrowserWallet {
  constructor(
    public wallet: Wallet,
    public account: WalletAccount,
  ) {}
  get publicKey() {
    return new PublicKey(this.account.publicKey);
  }
  async signTransaction(tx: Transaction) {
    const f = this.wallet.features['solana:signTransaction'] as WalletFeature;
    const [out] = await f.signTransaction({
      account: this.account,
      chain: 'solana:devnet',
      transaction: tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    });
    return Transaction.from(out.signedTransaction);
  }
}
export function wallets() {
  return getWallets()
    .get()
    .filter(
      (w) =>
        'standard:connect' in w.features &&
        'solana:signTransaction' in w.features,
    );
}
export async function connectWallet(wallet: Wallet) {
  const f = wallet.features['standard:connect'] as WalletFeature;
  const { accounts } = await f.connect();
  const account = accounts.find((a) =>
    a.chains.some((c) => c.startsWith('solana:')),
  );
  if (!account) throw Error('Choose a Solana wallet account');
  return new BrowserWallet(wallet, account);
}
let idlPromise: Promise<Idl> | undefined;
export async function idl() {
  return (idlPromise ??= fetch('/idl.json').then((r) => {
    if (!r.ok) throw Error('The Devnet program interface is not available');
    return r.json();
  }));
}
function pda(seeds: Uint8Array[]) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];
}
const seed = (s: string) => Buffer.from(s);
export function addresses(room: PublicKey, round: BN = new BN(0)) {
  return {
    room,
    escrow: pda([seed('escrow'), room.toBytes()]),
    game: pda([
      seed('match'),
      room.toBytes(),
      round.toArrayLike(Buffer, 'le', 8),
    ]),
  };
}
export function newRoomAddress(payer: PublicKey, nonce: BN) {
  return pda([
    seed('room'),
    payer.toBytes(),
    nonce.toArrayLike(Buffer, 'le', 8),
  ]);
}
export function sessionFor(room: PublicKey, wallet: PublicKey) {
  const key = 'ultrapong.session.' + room.toBase58() + '.' + wallet.toBase58();
  const saved = sessionStorage.getItem(key);
  if (saved) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
    } catch {
      sessionStorage.removeItem(key);
    }
  }
  const session = Keypair.generate();
  sessionStorage.setItem(key, JSON.stringify([...session.secretKey]));
  return session;
}
export async function decode<T>(name: string, bytes: Buffer): Promise<T> {
  return new BorshAccountsCoder(await idl()).decode(name, bytes) as T;
}
export async function readRoom(room: PublicKey) {
  const info = await base.getAccountInfo(room);
  if (!info || !info.owner.equals(PROGRAM))
    throw Error('Room not found on Solana Devnet');
  return decode<Room>('Room', info.data);
}
export async function readEscrow(room: PublicKey) {
  const info = await base.getAccountInfo(addresses(room).escrow);
  return info ? decode<Escrow>('Escrow', info.data) : null;
}

// Account addresses generated by Anchor/MagicBlock macros come from the deployed IDL.
const instructionNames = new WeakMap<TransactionInstruction, string>();
const describeInstructions = (instructions: TransactionInstruction[]) =>
  instructions
    .map((i) => instructionNames.get(i))
    .filter(Boolean)
    .map((n) => actionLabel(n!))
    .join(' + ') || 'Fund gameplay session';
const track = (
  signature: string,
  connection: Connection,
  label: string,
  status: Activity['status'],
  detail?: string,
) =>
  recordActivity({
    signature,
    network: (connection === er ? 'MagicBlock ER' : 'Solana Devnet') as Network,
    label,
    status,
    time: Date.now(),
    detail,
  });
export async function instruction(
  name: string,
  args: Record<string, unknown>,
  accounts: Record<string, PublicKey>,
) {
  const spec = await idl();
  const found = spec.instructions.find((ix) => ix.name === name);
  if (!found) throw Error('Unknown instruction ' + name);
  const keys = found.accounts.map((a) => {
    if ('accounts' in a) throw Error('Unsupported nested account group');
    let key = accounts[a.name];
    if (!key && a.address) key = new PublicKey(a.address);
    if (!key && a.name === 'system_program') key = SystemProgram.programId;
    if (!key) throw Error('Missing account ' + a.name + ' for ' + name);
    return { pubkey: key, isSigner: !!a.signer, isWritable: !!a.writable };
  });
  const built = new TransactionInstruction({
    programId: PROGRAM,
    keys,
    data: new BorshInstructionCoder(spec).encode(name, args),
  });
  instructionNames.set(built, name);
  return built;
}
export async function sendWallet(
  wallet: BrowserWallet,
  instructions: TransactionInstruction[],
  connection = base,
) {
  const latest = await connection.getLatestBlockhash();
  const tx = new Transaction({ ...latest, feePayer: wallet.publicKey }).add(
    ...instructions,
  );
  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: connection === er,
  });
  const label = describeInstructions(instructions);
  track(signature, connection, label, 'submitted');
  const confirmation = await connection.confirmTransaction(
    { signature, ...latest },
    'confirmed',
  );
  track(
    signature,
    connection,
    label,
    confirmation.value.err ? 'failed' : 'confirmed',
    confirmation.value.err ? JSON.stringify(confirmation.value.err) : undefined,
  );
  if (confirmation.value.err)
    throw Error(
      'Transaction failed: ' + JSON.stringify(confirmation.value.err),
    );
  return signature;
}
export async function renewSession(
  wallet: BrowserWallet,
  room: PublicKey,
  r: Room,
) {
  const session = sessionFor(room, wallet.publicKey);
  if ((await base.getBalance(session.publicKey)) < 500_000)
    await sendWallet(wallet, [
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: session.publicKey,
        lamports: 2_000_000,
      }),
    ]);
  await sendWallet(
    wallet,
    [
      await instruction(
        'renew_session',
        { session: session.publicKey },
        { signer: wallet.publicKey, game: addresses(room, r.round).game },
      ),
    ],
    er,
  );
  return session;
}
let cachedHash:
  | {
      value: Awaited<ReturnType<Connection['getLatestBlockhash']>>;
      time: number;
    }
  | undefined;
async function erHash() {
  if (!cachedHash || Date.now() - cachedHash.time > 5000)
    cachedHash = {
      value: await er.getLatestBlockhash(),
      time: Date.now(),
    };
  return cachedHash.value;
}
export async function sendSession(
  session: Keypair,
  instructions: TransactionInstruction[],
  confirm = true,
) {
  const tx = new Transaction({
    ...(await erHash()),
    feePayer: session.publicKey,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ...instructions,
  );
  tx.sign(session);
  // ER scheduler and delegation CPIs cannot be simulated through Solana's base RPC.
  const signature = await er.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 0,
  });
  const label = describeInstructions(instructions);
  track(signature, er, label, 'submitted');
  if (confirm) {
    await confirmSession(signature, label);
  }
  return signature;
}
export async function confirmSession(
  signature: string,
  label = 'Paddle input',
) {
  for (let i = 0; i < 50; i++) {
    const s = (await er.getSignatureStatuses([signature])).value[0];
    if (s?.err) {
      track(signature, er, label, 'failed', JSON.stringify(s.err));
      throw Error('Game transaction failed: ' + JSON.stringify(s.err));
    }
    if (
      s?.confirmationStatus === 'confirmed' ||
      s?.confirmationStatus === 'finalized'
    ) {
      track(signature, er, label, 'confirmed');
      return signature;
    }
    await delay(100);
  }
  throw Error('Game transaction confirmation timed out');
}
export const delay = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));
export async function createRoom(
  wallet: BrowserWallet,
  wager: boolean,
  sabotage: boolean,
  name: string,
) {
  const nonce = new BN(crypto.getRandomValues(new Uint32Array(1))[0]);
  const room = newRoomAddress(wallet.publicKey, nonce);
  const a = addresses(room);
  const session = sessionFor(room, wallet.publicKey);
  const callsign = new Uint8Array(16);
  callsign.set(new TextEncoder().encode(name).slice(0, 16));
  await sendWallet(wallet, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    await instruction(
      'create_room',
      { nonce, wager, sabotage },
      { payer: wallet.publicKey, ...a },
    ),
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: session.publicKey,
      lamports: 2_000_000,
    }),
    await instruction(
      'join',
      { name: [...callsign], session: session.publicKey },
      { payer: wallet.publicKey, ...a },
    ),
    await instruction('ready', {}, { payer: wallet.publicKey, room }),
  ]);
  return room;
}
export async function joinRoom(
  wallet: BrowserWallet,
  room: PublicKey,
  r: Room,
  name: string,
) {
  const session = sessionFor(room, wallet.publicKey);
  const n = new Uint8Array(16);
  n.set(new TextEncoder().encode(name).slice(0, 16));
  const ix = await instruction(
    'join',
    { name: [...n], session: session.publicKey },
    { payer: wallet.publicKey, ...addresses(room, r.round) },
  );
  const funding = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: session.publicKey,
    lamports: 2_000_000,
  });
  await sendWallet(wallet, [
    funding,
    ix,
    await instruction('ready', {}, { payer: wallet.publicKey, room }),
  ]);
  return session;
}
export async function readyRoom(wallet: BrowserWallet, room: PublicKey) {
  return sendWallet(wallet, [
    await instruction('ready', {}, { payer: wallet.publicKey, room }),
  ]);
}
export async function withdrawRoom(wallet: BrowserWallet, room: PublicKey) {
  return sendWallet(wallet, [
    await instruction(
      'withdraw',
      {},
      { payer: wallet.publicKey, ...addresses(room) },
    ),
  ]);
}
export const short = (p: PublicKey | string) => {
  const s = String(p);
  return s.slice(0, 4) + '…' + s.slice(-4);
};
export const playerName = (r: Room, i: number) =>
  new TextDecoder()
    .decode(new Uint8Array(r.names[i]))
    .replaceAll('\0', '')
    .trim() || short(r.players[i]);
export const receipt = (signature: string) =>
  'https://explorer.solana.com/tx/' + signature + '?cluster=devnet';
export function crankSigner(game: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [seed('crank-executor'), game.toBytes()],
    new PublicKey('Crank11111111111111111111111111111111111111'),
  )[0];
}
export async function lockRoom(
  wallet: BrowserWallet,
  room: PublicKey,
  r: Room,
) {
  const a = addresses(room, r.round);
  return sendWallet(wallet, [
    await instruction(
      'lock_and_delegate',
      {},
      {
        payer: wallet.publicKey,
        ...a,
        buffer_game: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
          a.game,
          PROGRAM,
        ),
        delegation_record_game: delegationRecordPdaFromDelegatedAccount(a.game),
        delegation_metadata_game: delegationMetadataPdaFromDelegatedAccount(
          a.game,
        ),
      },
    ),
  ]);
}
export async function activateMatch(
  session: Keypair,
  room: PublicKey,
  r: Room,
) {
  const { game } = addresses(room, r.round);
  for (let i = 0; i < 100; i++) {
    const info = await er.getAccountInfo(game);
    if (info && info.owner.equals(PROGRAM)) {
      const m = await decode<Match>('MatchState', info.data);
      if (m.humans > 0) {
        if (m.status === 0) {
          await sendSession(session, [
            await instruction(
              'request_seed',
              {},
              {
                payer: session.publicKey,
                game,
                program_identity: pda([seed('identity')]),
              },
            ),
          ]);
          for (let j = 0; j < 150; j++) {
            const b = await er.getAccountInfo(game);
            if (b) {
              const state = await decode<Match>('MatchState', b.data);
              if (state.status === 1) break;
            }
            await delay(200);
          }
        }
        const b = await er.getAccountInfo(game);
        if (!b) throw Error('Match is unavailable');
        const state = await decode<Match>('MatchState', b.data);
        if (state.status !== 1)
          throw Error(
            'Waiting for the randomness service. Retry starting the match.',
          );
        if (!state.scheduled)
          await sendSession(session, [
            await instruction(
              'start_crank',
              {},
              { game, crank_signer: crankSigner(game) },
            ),
          ]);
        return;
      }
    }
    await delay(200);
  }
  throw Error('The match is still moving to MagicBlock. Retry in a moment.');
}
export async function finalizeMatch(session: Keypair, game: PublicKey) {
  return sendSession(session, [
    await instruction('finalize', {}, { payer: session.publicKey, game }),
  ]);
}
export async function settleMatch(
  wallet: BrowserWallet,
  room: PublicKey,
  r: Room,
  winner: number,
) {
  const recipient =
    winner < 0 || winner >= r.count ? r.creator : r.players[winner];
  return sendWallet(wallet, [
    await instruction(
      'settle',
      {},
      { ...addresses(room, r.round), winner: recipient },
    ),
  ]);
}
export async function settleWithSession(
  session: Keypair,
  room: PublicKey,
  r: Room,
  winner: number,
) {
  const latest = await base.getLatestBlockhash();
  const recipient =
    winner < 0 || winner >= r.count ? r.creator : r.players[winner];
  const tx = new Transaction({ ...latest, feePayer: session.publicKey }).add(
    await instruction(
      'settle',
      {},
      { ...addresses(room, r.round), winner: recipient },
    ),
  );
  tx.sign(session);
  const signature = await base.sendRawTransaction(tx.serialize());
  track(signature, base, 'Settle pot', 'submitted');
  const result = await base.confirmTransaction(
    { signature, ...latest },
    'confirmed',
  );
  track(
    signature,
    base,
    'Settle pot',
    result.value.err ? 'failed' : 'confirmed',
    result.value.err ? JSON.stringify(result.value.err) : undefined,
  );
  if (result.value.err) throw Error('Settlement failed');
  return signature;
}
