export const ROOM_CODE_SPACE = 36 ** 6;
export function roomCode(nonce: number): string | undefined {
  return Number.isSafeInteger(nonce) && nonce >= 0 && nonce < ROOM_CODE_SPACE
    ? nonce.toString(36).toUpperCase().padStart(6, '0')
    : undefined;
}
export function parseRoomCode(code: string): number {
  if (!/^[A-Z0-9]{6}$/i.test(code))
    throw Error('Enter a 6-character room code.');
  return parseInt(code, 36);
}
