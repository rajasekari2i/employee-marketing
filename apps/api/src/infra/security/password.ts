import * as argon2 from 'argon2';

/**
 * WU-05 DoD item 1: argon2id with these exact cost parameters. Used both
 * for real user passwords (`User.passwordHash`) and, by `TokenService`
 * (apps/api/src/modules/auth/token.service.ts), for refresh-token opaque
 * secrets — a refresh token hash is still just "hash this secret string",
 * so the same primitive is reused rather than inventing a second one.
 *
 * `memoryCost` is in KiB (argon2's own unit) — 19456 KiB = 19 MiB, timeCost
 * (iterations) 2, parallelism 1. These are embedded in the resulting
 * encoded hash string itself (argon2's standard `$argon2id$v=...$m=...`
 * format), so `verify()` below never needs to pass them back in — it
 * reads them off the hash it's checking against.
 */
const ARGON2_HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Hashes `plainText` (a password, or a refresh token's opaque secret). */
export async function hash(plainText: string): Promise<string> {
  return argon2.hash(plainText, ARGON2_HASH_OPTIONS);
}

/**
 * Verifies `plainText` against a previously-produced `hash()` output.
 * Never throws: argon2's own `verify()` throws on a malformed/foreign-format
 * hash (e.g. empty string, or a hash produced by a different algorithm),
 * which this wraps into a plain `false` so callers can treat "wrong
 * password" and "unparsable hash" identically, matching the "identical
 * message either way" requirement (contracts/auth.md) one level up in the
 * caller rather than leaking a distinction here.
 */
export async function verify(
  hashValue: string,
  plainText: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hashValue, plainText);
  } catch {
    return false;
  }
}
