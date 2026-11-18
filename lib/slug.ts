import { SLUG_LENGTH } from "./validation";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Largest multiple of the alphabet size below 256. Bytes at or above this
// value are discarded, so every character is equally likely (no modulo bias).
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length);

export function generateSlug(length: number = SLUG_LENGTH): string {
  let slug = "";

  while (slug.length < length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= UNBIASED_LIMIT) continue;
      slug += ALPHABET[byte % ALPHABET.length];
      if (slug.length === length) break;
    }
  }

  return slug;
}
