// Stable random IDs such as sc_4kP9xQ2mTz. Works in Node and the browser.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomId(prefix: string, length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  // 62 * 4 = 248, so rejecting bytes >= 248 keeps the distribution uniform.
  for (let i = 0; i < length; i++) {
    let b = bytes[i];
    while (b >= 248) b = globalThis.crypto.getRandomValues(new Uint8Array(1))[0];
    out += ALPHABET[b % 62];
  }
  return `${prefix}_${out}`;
}
