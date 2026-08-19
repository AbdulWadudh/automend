/**
 * The credential a kit acts with, already resolved by the parent process.
 *
 * Its own module rather than part of `context.ts` because a property's option loader needs it too,
 * and `context.ts` imports `property.ts` — putting it there makes the two files import each other.
 *
 * An OAuth connection arrives as an access token rather than as a refresh token and a client secret:
 * refreshing happens in the parent, where the secrets key lives, so the subprocess never holds
 * anything reusable beyond this run.
 */
export type KitCredential =
  | { readonly kind: "oauth"; readonly connectorId: string; readonly accessToken: string }
  | { readonly kind: "token"; readonly connectorId: string; readonly token: string };
