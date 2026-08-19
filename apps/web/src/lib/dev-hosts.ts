/**
 * Hostnames the dev server may answer to.
 *
 * Vite refuses a request whose `Host` it does not recognise, which is what stops a tunnelled dev
 * server from loading at all. The tunnel's hostname is not written down again here: reaching this
 * app through one already means naming it in `AUTH_BASE_URL` (the origin the browser uses, and the
 * one OAuth redirect URIs are built from) and in `WEB_ORIGIN` (the origins the api trusts), so the
 * list is derived from those rather than kept in step with them by hand.
 */
export function deriveAllowedHosts(origins: readonly (string | undefined)[]): string[] {
  const hosts = origins
    .flatMap((origin) => origin?.split(",") ?? [])
    .flatMap((origin) => {
      const trimmed = origin.trim();

      if (trimmed.length === 0) {
        return [];
      }

      try {
        return [new URL(trimmed).hostname];
      } catch {
        // A malformed origin is the deployment's problem to fix, not a reason to refuse to start.
        return [];
      }
    });

  return [...new Set(hosts)];
}
