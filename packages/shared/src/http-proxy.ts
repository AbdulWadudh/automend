/**
 * Forwarding a browser request to a service that sits behind this origin.
 *
 * The web server proxies the API and OTLP prefixes so the browser only ever talks to one address;
 * both go through here.
 */

import { config } from "./config";

/**
 * Forwards `request` to `targetUrl` and returns the upstream's response as it stands.
 *
 * Two details are not negotiable:
 *
 * - **A redirect is not followed.** A 3xx belongs to the browser — it is what carries the user to
 *   the page after signing in, and its `Set-Cookie` is the session. Following it here resolves the
 *   `Location` against the *upstream's* own address, so the browser receives whatever that URL
 *   returns (the API's 404 for a page only the SPA serves) and the cookies are dropped with the
 *   redirect that carried them.
 * - **`Host` and the hop-by-hop headers are stripped.** The inbound `Host` names this origin, and
 *   an upstream behind a CDN routes by Host and rejects one it does not recognise.
 */
export async function forwardRequest(request: Request, targetUrl: URL): Promise<Response> {
  const headers = new Headers(request.headers);

  for (const header of config.http.proxy.strippedRequestHeaders) {
    headers.delete(header);
  }

  return await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  });
}
