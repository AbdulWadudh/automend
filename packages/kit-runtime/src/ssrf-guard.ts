/**
 * Deciding whether a flow may call a given address.
 *
 * A flow's author supplies URLs, and a flow's *data* can supply them too — `{{payload.callbackUrl}}` in an HTTP
 * step means whoever sends the webhook chooses where the worker connects. That is the whole SSRF problem, and it
 * is why this is a guard rather than a validation: the check has to hold for a URL nobody reviewed.
 *
 * What it refuses, and why each one matters:
 *
 * - **Loopback.** The worker's own process and anything else on the container.
 * - **Link-local `169.254.0.0/16`.** Where every cloud provider's instance metadata service lives, including the
 *   credentials for the machine the worker runs on. This is the single most valuable target of an SSRF.
 * - **Private ranges.** A self-hosted deployment's Postgres, Redis and every internal service sit on them.
 * - **Anything but HTTP and HTTPS.** `file://` reads the disk; `gopher://` and friends have been used to speak to
 *   Redis through an HTTP client.
 *
 * Redirects are checked at every hop rather than only at the first, because a permitted URL that redirects to
 * `169.254.169.254` is the same attack with one more step.
 */

import type { EngineLimits } from "./protocol";

export type AddressVerdict = { allowed: true } | { allowed: false; reason: string };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * The ranges a flow may not reach, as prefixes on the dotted-quad form.
 *
 * Prefix matching rather than integer arithmetic because the set is small, fixed, and this way each entry is
 * legible next to the RFC that defines it. `127.` and `10.` cover their whole /8; the `172.16–31` block is
 * enumerated because `172.` alone would wrongly refuse the public `172.32+` space.
 */
const BLOCKED_V4_PREFIXES = [
  "0.", // RFC 1122 "this host on this network"
  "10.", // RFC 1918 private
  "127.", // RFC 1122 loopback
  "169.254.", // RFC 3927 link-local — cloud instance metadata
  "192.168.", // RFC 1918 private
  "100.64.", // RFC 6598 carrier-grade NAT
  ...Array.from({ length: 16 }, (_unused, index) => `172.${16 + index}.`), // RFC 1918 private
];

const BLOCKED_V6_EXACT = new Set(["::", "::1"]);

/** `fc00::/7` unique-local — the IPv6 equivalent of the RFC 1918 ranges. */
const PRIVATE_V6_PREFIXES = ["fc", "fd"];

/**
 * `fe80::/10` link-local.
 *
 * Kept apart from the private ranges because it stays blocked even for a deployment that opts into private
 * networking, exactly as `169.254.0.0/16` does: a flow that needs to reach a service on the local network has no
 * reason to reach a link-local address, and that is where instance metadata lives.
 */
const LINK_LOCAL_V6_PREFIXES = ["fe8", "fe9", "fea", "feb"];

/** The metadata range, blocked unconditionally for the same reason. */
const LINK_LOCAL_V4_PREFIX = "169.254.";

function isBlockedV4(hostname: string): boolean {
  return BLOCKED_V4_PREFIXES.some((prefix) => hostname.startsWith(prefix));
}

type V6Verdict = "allowed" | "private" | "linkLocal";

function classifyV6(hostname: string): V6Verdict {
  // URL keeps IPv6 literals in brackets; the address itself is what the rules are about.
  const address = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (BLOCKED_V6_EXACT.has(address)) {
    return "private";
  }

  // An IPv4-mapped address is an IPv4 address wearing a hat, and the same rules apply to it.
  const mapped = readMappedV4(address);

  if (mapped) {
    if (mapped.startsWith(LINK_LOCAL_V4_PREFIX)) {
      return "linkLocal";
    }

    return isBlockedV4(mapped) ? "private" : "allowed";
  }

  if (LINK_LOCAL_V6_PREFIXES.some((prefix) => address.startsWith(prefix))) {
    return "linkLocal";
  }

  return PRIVATE_V6_PREFIXES.some((prefix) => address.startsWith(prefix)) ? "private" : "allowed";
}

/**
 * The IPv4 address inside an IPv4-mapped IPv6 literal, in dotted form.
 *
 * **The hex branch is the one that matters, and it was a real bypass.** `URL` normalises
 * `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, so matching only the dotted spelling let a mapped address
 * through to the metadata service — the exact thing this guard exists to stop. A test found it.
 *
 * Both spellings are read, because a parser is free to keep either.
 */
function readMappedV4(address: string): string | undefined {
  const dotted = /^(?:::ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address)?.[1];

  if (dotted) {
    return dotted;
  }

  const hex = /^(?:::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);

  if (!hex?.[1] || !hex[2]) {
    return undefined;
  }

  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);

  // Two 16-bit groups are four octets; the shift is what "the same address" means here.
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

function looksLikeIpV4(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function looksLikeIpV6(hostname: string): boolean {
  return hostname.includes(":");
}

/**
 * Whether a flow may call this URL.
 *
 * Hostnames are checked as written, not resolved. Resolving here and connecting later would be a
 * time-of-check-to-time-of-use gap — DNS can answer differently the second time — so this refuses the addresses
 * and names it can decide on, and a deployment that needs stronger guarantees pins DNS at the network level. That
 * limit is real and is stated rather than papered over.
 */
export function checkAddress(rawUrl: string, limits: EngineLimits): AddressVerdict {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: `"${rawUrl}" is not a URL` };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { allowed: false, reason: `${url.protocol} is not a protocol a flow may use` };
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname.length === 0) {
    return { allowed: false, reason: "the URL names no host" };
  }

  // Names that are *never* reachable, whatever a deployment allows — a metadata endpoint has no legitimate use
  // from a flow. Loopback is not in this list: it is handled below, where the deployment's own setting applies.
  if (limits.blockedHostnames.some((blocked) => hostname === blocked.toLowerCase())) {
    return { allowed: false, reason: `${hostname} is not a host a flow may reach` };
  }

  // `.localhost` resolves to loopback by specification, so the name is as much a loopback address as 127.0.0.1.
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return limits.allowPrivateNetwork
      ? { allowed: true }
      : { allowed: false, reason: "the local machine is not reachable from a flow" };
  }

  if (looksLikeIpV4(hostname)) {
    if (hostname.startsWith(LINK_LOCAL_V4_PREFIX)) {
      // Never permitted, whatever the deployment allows: this is the instance metadata service.
      return { allowed: false, reason: `${hostname} is a link-local address` };
    }

    if (isBlockedV4(hostname) && !limits.allowPrivateNetwork) {
      return { allowed: false, reason: `${hostname} is a private address` };
    }
  }

  if (looksLikeIpV6(hostname)) {
    const verdict = classifyV6(hostname);

    if (verdict === "linkLocal") {
      return { allowed: false, reason: `${hostname} is a link-local address` };
    }

    if (verdict === "private" && !limits.allowPrivateNetwork) {
      return { allowed: false, reason: `${hostname} is a private address` };
    }
  }

  return { allowed: true };
}
