import { randomInt } from 'node:crypto';

// Ambiguous glyphs (0/O, 1/l/I) removed so a printed slip is easy to type.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// Random initial password for a bulk-provisioned account (~12 chars).
export function generateInitialPassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}
