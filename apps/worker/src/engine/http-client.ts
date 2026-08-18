/**
 * The only way a kit reaches the network.
 *
 * Kits are handed this rather than `fetch`, and the difference is every limit below. A kit that could call `fetch`
 * directly could bypass the address rules, hang forever on a server that never answers, and read a response until
 * the worker ran out of memory — three failure modes that are impossible to prevent forty kits at a time and
 * straightforward to prevent once.
 *
 * Runs inside the subprocess, which is why the limits arrive as data: they come from the parent's config, and
 * nothing a flow contains can influence them.
 */

import type { HttpClient, HttpRequest, HttpResponse } from "@automend/kit-framework";
import { stepExecutionError } from "@automend/shared";
import type { EngineLimits } from "./protocol";
import { checkAddress } from "./ssrf-guard";

function buildUrl(request: HttpRequest): string {
  if (!request.query) {
    return request.url;
  }

  const url = new URL(request.url);

  for (const [name, value] of Object.entries(request.query)) {
    url.searchParams.set(name, String(value));
  }

  return url.toString();
}

function buildBody(request: HttpRequest): { body: string | undefined; headers: Record<string, string> } {
  if (request.rawBody !== undefined) {
    // Sent verbatim; the caller owns the content type, because only it knows what the bytes are.
    return { body: request.rawBody, headers: {} };
  }

  if (request.body === undefined) {
    return { body: undefined, headers: {} };
  }

  return { body: JSON.stringify(request.body), headers: { "content-type": "application/json" } };
}

function collectHeaders(headers: Headers): Record<string, string> {
  const collected: Record<string, string> = {};

  headers.forEach((value, name) => {
    collected[name] = value;
  });

  return collected;
}

/**
 * Reads at most `maxResponseBytes` and abandons the request rather than truncating silently.
 *
 * Truncating would hand a kit a half a JSON document to parse, and the resulting error would point at the kit
 * instead of at the response being too large. A step's output also goes into the run journal, so an unbounded
 * body is an unbounded row.
 */
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();

  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel();

      throw stepExecutionError(`The response was larger than ${maxBytes} bytes`);
    }

    chunks.push(value);
  }

  // Joined by hand rather than through a Blob, so this needs no DOM lib and the byte count above is the same
  // count that bounds the allocation here.
  const joined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(joined);
}

/** Parsed when the response declares JSON, otherwise the text as it arrived. */
function parseBody(text: string, contentType: string | null): unknown {
  if (!contentType?.toLowerCase().includes("json") || text.length === 0) {
    return text;
  }

  try {
    return JSON.parse(text);
  } catch {
    // A server that promised JSON and sent something else is the server's problem, not a reason to fail the step
    // — the kit gets the text and can decide.
    return text;
  }
}

export function createGuardedHttpClient(limits: EngineLimits): HttpClient {
  async function request(input: HttpRequest): Promise<HttpResponse> {
    const bodyParts = buildBody(input);
    let target = buildUrl(input);

    // Redirects are followed here rather than by `fetch`, so every hop is re-checked. A permitted URL that
    // redirects to the metadata service is the same attack with one more step, and `redirect: "follow"` would
    // take it without asking.
    for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
      const verdict = checkAddress(target, limits);

      if (!verdict.allowed) {
        throw stepExecutionError(`This step may not call ${target} — ${verdict.reason}`);
      }

      const response = await fetch(target, {
        method: input.method,
        headers: { ...bodyParts.headers, ...input.headers },
        body: bodyParts.body,
        redirect: "manual",
        signal: AbortSignal.timeout(limits.requestTimeoutMs),
      });

      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400 && location !== null;

      if (!isRedirect) {
        const text = await readBoundedText(response, limits.maxResponseBytes);

        return {
          status: response.status,
          headers: collectHeaders(response.headers),
          body: parseBody(text, response.headers.get("content-type")),
        };
      }

      // Resolved against the current URL, because a `Location` may be relative.
      target = new URL(location, target).toString();
    }

    throw stepExecutionError(`This step was redirected more than ${limits.maxRedirects} times`);
  }

  return { request };
}
