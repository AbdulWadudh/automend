/**
 * The child inherits almost nothing.
 *
 * Listing what to keep rather than what to remove is the only version of this that stays correct: a
 * variable added to the deployment tomorrow is absent by default instead of leaking because nobody
 * updated a denylist. `DATABASE_URL`, `REDIS_URL` and `SECRETS_KEY` are therefore not merely unused
 * in the child — they are not present to be read.
 *
 * One copy, shared by every host that spawns a child. A second would be a security allowlist kept in
 * step by hand, which is the same as one that is not.
 */
export function buildChildEnv(): Record<string, string> {
  const kept: Record<string, string> = {};

  for (const name of ["NODE_ENV", "TZ", "PATH", "SYSTEMROOT", "HOME"]) {
    const value = process.env[name];

    if (value !== undefined) {
      kept[name] = value;
    }
  }

  return kept;
}
