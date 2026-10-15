import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Human password credentials — scrypt with a per-password salt, stored as
 * `scrypt$N$r$p$<salt-b64>$<hash-b64>`. No dependency; node:crypto only.
 */
const PREFIX = 'scrypt';
const COST_N = 16384;
const BLOCK_R = 8;
const PARALLEL_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN, { N: COST_N, r: BLOCK_R, p: PARALLEL_P });
  return [
    PREFIX,
    COST_N,
    BLOCK_R,
    PARALLEL_P,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    if (expected.length === 0) return false;
    const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Strong, URL/console-friendly password for the generated root credential. */
export function randomPassword(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}
