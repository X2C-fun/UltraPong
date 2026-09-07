import fs from 'node:fs';
import os from 'node:os';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { createRequire } from 'node:module';
const anchor = createRequire(import.meta.url)('@coral-xyz/anchor');
export const { BN } = anchor;
export const IDL = JSON.parse(fs.readFileSync('public/idl.json', 'utf8')),
  ID = new PublicKey(IDL.address);
export const base = new Connection(
  process.env.SOLANA_RPC || 'https://rpc.magicblock.app/devnet',
  'confirmed',
);
export const er = new Connection(
  'https://devnet-as.magicblock.app',
  'confirmed',
);
export const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      fs.readFileSync(os.homedir() + '/.config/solana/id.json', 'utf8'),
    ),
  ),
);
const ac = new anchor.BorshAccountsCoder(IDL),
  ic = new anchor.BorshInstructionCoder(IDL);
export const pda = (s) => PublicKey.findProgramAddressSync(s, ID)[0];
export const b = (s) => Buffer.from(s);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function ix(name, args, a) {
  const def = IDL.instructions.find((i) => i.name === name);
  return new TransactionInstruction({
    programId: ID,
    data: ic.encode(name, args),
    keys: def.accounts.map((k) => {
      const key = a[k.name] ?? (k.address ? new PublicKey(k.address) : null);
      if (!key) throw Error('Missing ' + k.name);
      return { pubkey: key, isSigner: !!k.signer, isWritable: !!k.writable };
    }),
  });
}
export async function send(connection, signer, instructions) {
  const latest = await connection.getLatestBlockhash();
  const tx = new Transaction({ ...latest, feePayer: signer.publicKey }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ...instructions,
  );
  tx.sign(signer);
  let signature;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: connection === er,
      maxRetries: 3,
    });
  } catch (e) {
    if (e.getLogs) console.log(await e.getLogs(connection));
    throw e;
  }
  for (let i = 0; i < 80; i++) {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s?.err) {
      const tx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      throw Error(
        JSON.stringify({
          signature,
          error: s.err,
          logs: tx?.meta?.logMessages,
        }),
      );
    }
    if (
      s?.confirmationStatus === 'confirmed' ||
      s?.confirmationStatus === 'finalized'
    )
      return signature;
    await sleep(connection === er ? 100 : 700);
  }
  throw Error('Confirmation timeout ' + signature);
}
export async function account(c, key, name) {
  const data = await c.getAccountInfo(key);
  if (!data) throw Error('Missing ' + key);
  return ac.decode(name, data.data);
}
export function decode(name, data) {
  return ac.decode(name, data);
}
export async function expectFailure(label, fn) {
  try {
    await fn();
  } catch (e) {
    if (!/custom program error|InstructionError|Error Code:/.test(String(e)))
      throw Error('No program rejection confirmed for ' + label, { cause: e });
    console.log('PASS rejection:', label);
    return;
  }
  throw Error('Expected rejection: ' + label);
}
export async function physics() {
  const { instance } = await WebAssembly.instantiate(
    fs.readFileSync('public/physics.wasm'),
  );
  const e = instance.exports;
  return (bytes) => {
    const ptr = e.game_load_buffer(bytes.length);
    new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
    if (!e.game_load()) throw Error('Invalid state');
    const p = e.game_snapshot();
    return JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(e.memory.buffer, p, e.game_snapshot_len()),
      ),
    );
  };
}
