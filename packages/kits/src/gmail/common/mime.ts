/**
 * Assembling the RFC 2822 message Gmail wants.
 *
 * `users.messages.send` takes a `raw` field holding a complete MIME message, base64url-encoded — so
 * the kit builds the message itself rather than handing Gmail a set of fields. Two things here are not
 * optional.
 */

import { toEmailSafeHtml } from "@automend/shared";

export type MessageBodyType = "text" | "html";

export type OutgoingMessage = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyType: MessageBodyType;
  /** Set when replying, so the client threads the message instead of starting a new conversation. */
  inReplyTo?: string;
};

/**
 * Strips CR and LF from a header value.
 *
 * **This is a security boundary, not tidying.** Every field here can contain a `{{variable}}`, so its
 * value comes from whatever the flow received — and a newline inside a header value ends that header
 * and begins another. A subject of `Hi\r\nBcc: everyone@example.com` would otherwise turn one
 * recipient into a silent mailing list. Folding whitespace is collapsed to a single space rather than
 * removed, so `A\r\n B` stays readable as `A B`.
 */
function sanitiseHeaderValue(value: string): string {
  return value.replace(/[\r\n]+\s*/g, " ").trim();
}

/**
 * RFC 2047 encoded-word form, for a header that is not pure ASCII.
 *
 * A `Subject` containing an accent or an emoji is invalid as raw bytes in a header, and sending it
 * unencoded produces mojibake in the recipient's client rather than an error anyone would notice.
 * ASCII is left alone so the common case stays readable on the wire.
 */
function encodeHeaderValue(value: string): string {
  const clean = sanitiseHeaderValue(value);

  // Printable ASCII is everything a header may carry unencoded; anything outside it needs the
  // encoded-word form below.
  if (!/[^\x20-\x7E]/.test(clean)) {
    return clean;
  }

  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/**
 * The message as Gmail's `raw` field wants it.
 *
 * The body is base64 rather than inline because a plain-text body may contain any Unicode and lines
 * longer than the 998 octets RFC 5322 permits; base64 sidesteps both without having to implement
 * quoted-printable folding.
 */
export function buildRawMessage(message: OutgoingMessage): string {
  const contentType = message.bodyType === "html" ? "text/html" : "text/plain";
  /**
   * An HTML body composed in the builder carries the editor's own Tailwind class names, and a class name is
   * worth nothing here: the recipient's client has no stylesheet for it, drops it, and applies its own
   * paragraph margin instead — which is how a body written with 4px gaps arrives with roughly 48px ones.
   *
   * Applied at send rather than only at save because a body stored before that export was fixed still carries
   * those classes and nothing will rewrite it. Doing it here means an existing flow is correct without anybody
   * having to re-open and re-save it.
   */
  const body = message.bodyType === "html" ? toEmailSafeHtml(message.body) : message.body;

  const headers: string[] = [
    `To: ${sanitiseHeaderValue(message.to)}`,
    ...(message.cc ? [`Cc: ${sanitiseHeaderValue(message.cc)}`] : []),
    ...(message.bcc ? [`Bcc: ${sanitiseHeaderValue(message.bcc)}`] : []),
    ...(message.inReplyTo
      ? [
          `In-Reply-To: ${sanitiseHeaderValue(message.inReplyTo)}`,
          `References: ${sanitiseHeaderValue(message.inReplyTo)}`,
        ]
      : []),
    `Subject: ${encodeHeaderValue(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: ${contentType}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
  ];

  const encodedBody = Buffer.from(body, "utf8").toString("base64");
  // CRLF, because RFC 5322 says so — a bare LF is accepted by some servers and mangled by others.
  const mime = `${headers.join("\r\n")}\r\n\r\n${encodedBody}`;

  return Buffer.from(mime, "utf8").toString("base64url");
}

/** Reads one header out of a Gmail message payload, case-insensitively as RFC 5322 requires. */
export function findHeader(headers: readonly { name?: string; value?: string }[], name: string): string | undefined {
  const wanted = name.toLowerCase();

  return headers.find((header) => header.name?.toLowerCase() === wanted)?.value;
}
