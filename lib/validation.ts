export const SLUG_LENGTH = 7;
export const SLUG_RE = /^[A-Za-z0-9]{7}$/;

const MAX_URL_LENGTH = 2048;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * Returns the canonical target URL, or null when the input is not an acceptable
 * http(s) URL. Credentials are rejected: `https://example.com@evil.com` displays
 * as example.com but resolves to evil.com.
 */
export function parseTargetUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  if (url.username || url.password) return null;

  return url.toString();
}
