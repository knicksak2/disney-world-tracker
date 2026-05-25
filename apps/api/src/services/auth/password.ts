/**
 * Auth_Service: Argon2id password hashing primitive.
 *
 * Wraps the `argon2` library so that the rest of the codebase only ever sees
 * the encoded hash string and the boolean verification result. Plaintext
 * passwords flow into `hash` / `verify` and never anywhere else: no logging,
 * no return paths, no DTO field. This file is the single source of truth for
 * the Argon2 parameters used by the application.
 *
 * Parameters (from design.md → "Password hashing"):
 *   - algorithm:   Argon2id           (memory-hard + side-channel resistant)
 *   - memoryCost:  64 MiB (65536 KiB) (`m` in Argon2 notation)
 *   - timeCost:    3                  (`t` — number of iterations)
 *   - parallelism: 1                  (`p` — lanes)
 *
 * The encoded hash returned by `hash` embeds the algorithm identifier, the
 * parameters above, the per-record salt, and the derived key, so callers do
 * not need to track parameters separately. `verify` reads them back from the
 * encoded string at check time, which means the cost parameters can be
 * raised in the future without invalidating existing rows.
 *
 * Validates: Requirements 6.11
 */

import argon2 from 'argon2';

/**
 * OWASP-recommended Argon2id parameters for new systems as referenced by
 * design.md. Held as a single immutable object so every call site uses the
 * same configuration.
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  // `argon2` expresses memory in KiB; 65 536 KiB = 64 MiB.
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * Derive an Argon2id encoded hash for a plaintext password.
 *
 * The returned string is the standard PHC-formatted Argon2 encoding —
 * `$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>` — which is what callers
 * persist into `users.password_hash`. The plaintext is not retained anywhere
 * after this call returns.
 *
 * @param plaintext - The user-supplied password. Length validation lives in
 *   the registration Zod schema; this function does not police it.
 * @returns A self-describing Argon2id encoded hash string.
 */
export async function hash(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, HASH_OPTIONS);
}

/**
 * Constant-time verify a plaintext password against a stored encoded hash.
 *
 * `argon2.verify` throws on malformed encoded strings (for example, a value
 * read from a corrupted row). Such failures are not "the password matched"
 * and they are not "an Argon2 internal failure that the caller should
 * handle"; from the Auth_Service's point of view they mean "this hash will
 * never authenticate anyone", which is exactly the same outcome as a wrong
 * password. We therefore swallow them and return `false`, ensuring the
 * Auth_Service surfaces a uniform `invalid_credentials` response and does
 * not leak information about hash-row corruption.
 *
 * @param encoded   - The previously-stored Argon2id encoded hash string.
 * @param plaintext - The candidate password to check.
 * @returns `true` iff the plaintext matches the encoded hash.
 */
export async function verify(encoded: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(encoded, plaintext);
  } catch {
    return false;
  }
}
