/**
 * Where to send someone after they sign in.
 *
 * The target comes from a query parameter, which means it is attacker-controllable: anyone can
 * send a link to `/sign-in?redirect=…`. So it is not used as given — it must be a plain path
 * inside the signed-in app, or it is discarded in favour of the default landing page.
 */

import { config } from "@automend/shared";

const { routes } = config.webClient;

/** Anything that could leave this origin or climb out of the app area. */
const UNSAFE_FRAGMENTS = ["//", "\\", "..", ":"];

export function resolveRedirectTarget(candidate: string | undefined | null): string {
  if (!candidate?.startsWith(routes.app)) {
    return routes.flows;
  }

  if (UNSAFE_FRAGMENTS.some((fragment) => candidate.includes(fragment))) {
    return routes.flows;
  }

  return candidate;
}

/** The `?redirect=` value a guard attaches when it turns someone away from a protected page. */
export function buildSignInSearch(attemptedPath: string): { redirect: string } {
  return { redirect: attemptedPath };
}
