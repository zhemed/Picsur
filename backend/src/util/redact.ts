import { createHash } from 'crypto';

/**
 * Renders a credential (API key, token, ...) for a log line without leaking it.
 *
 * Logs are shipped, screenshotted and attached to tickets, and an API key that
 * ends up there is a usable credential: `ApiKeyStrategy` used to log the full
 * key on every failed lookup, which includes the case of a *valid* key while
 * the database is unavailable (audit A-5).
 *
 * The output keeps enough to correlate two log lines (first 4 chars + hash
 * prefix) and nothing that can be replayed.
 */
export function RedactSecret(secret: unknown): string {
  if (typeof secret !== 'string') return '<non-string>';

  const length = secret.length;
  if (length === 0) return '<empty>';

  const hash = createHash('sha256')
    .update(secret)
    .digest('hex')
    .slice(0, 8);
  const prefix = secret.slice(0, 4).replace(/[^\x20-\x7e]/g, '?');

  return `${prefix}…(${length} chars, sha256:${hash})`;
}

/**
 * Same idea for arbitrary user controlled text (headers, query values) that is
 * about to be written to a log line: strip control characters, cap the length.
 */
export function SanitizeLogValue(value: unknown, maxLength = 64): string {
  if (typeof value !== 'string') return '<non-string>';

  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '?')
    .slice(0, maxLength);

  return value.length > maxLength ? `${cleaned}…` : cleaned;
}
