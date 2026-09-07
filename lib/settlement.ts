// Both clients can observe the same terminal tick. Check committed ownership
// after a failed finalize before reporting an error to either participant.
export async function ensureCommitted({
  isCommitted,
  finalize,
  wait,
}: {
  isCommitted: () => Promise<boolean>;
  finalize: () => Promise<unknown>;
  wait: () => Promise<void>;
}) {
  if (await isCommitted()) return;
  let failure: unknown;
  try {
    await finalize();
  } catch (e) {
    failure = e;
  }
  for (let i = 0; i < 60; i++) {
    if (await isCommitted()) return;
    await wait();
  }
  throw (
    failure ??
    Error(
      'The final result is still returning to Solana. Retry settlement in a moment.',
    )
  );
}
export function isTerminalRace(error: unknown) {
  return /"Custom"\s*:\s*(3007|6006)/.test(String(error));
}
