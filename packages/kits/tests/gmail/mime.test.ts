import { describe, expect, test } from "bun:test";
import { buildRawMessage, findHeader } from "../../src/gmail/common/mime";

/**
 * Gmail takes a whole RFC 2822 message rather than a set of fields, so the kit assembles one — which means
 * the kit, not Google, is responsible for the two things that go wrong when you do that.
 */

/** `raw` is base64url of the MIME message; decoding it is how these assert what was actually sent. */
function decode(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

function decodeBody(raw: string): string {
  const message = decode(raw);
  const [, body = ""] = message.split("\r\n\r\n");

  return Buffer.from(body, "base64").toString("utf8");
}

const base = { to: "ada@example.com", subject: "Invoice", body: "Attached.", bodyType: "text" } as const;

describe("the message that gets sent", () => {
  test("carries the headers Gmail needs, separated by CRLF as RFC 5322 requires", () => {
    const message = decode(buildRawMessage(base));

    expect(message).toContain("To: ada@example.com\r\n");
    expect(message).toContain("Subject: Invoice\r\n");
    expect(message).toContain("MIME-Version: 1.0\r\n");
    expect(message).toContain('Content-Type: text/plain; charset="UTF-8"\r\n');
  });

  test("the body survives a round trip, including characters outside ASCII", () => {
    const raw = buildRawMessage({ ...base, body: "Total: 42,50 € — merci\nSecond line" });

    expect(decodeBody(raw)).toBe("Total: 42,50 € — merci\nSecond line");
  });

  test("HTML is declared as HTML, or the recipient sees the markup as text", () => {
    const message = decode(buildRawMessage({ ...base, bodyType: "html", body: "<p>Hi</p>" }));

    expect(message).toContain('Content-Type: text/html; charset="UTF-8"');
  });

  test("cc and bcc appear only when given, rather than as empty headers", () => {
    const without = decode(buildRawMessage(base));
    const with_ = decode(buildRawMessage({ ...base, cc: "cc@example.com", bcc: "bcc@example.com" }));

    expect(without).not.toContain("Cc:");
    expect(without).not.toContain("Bcc:");
    expect(with_).toContain("Cc: cc@example.com");
    expect(with_).toContain("Bcc: bcc@example.com");
  });

  test("a reply carries both threading headers, so clients group it", () => {
    const message = decode(buildRawMessage({ ...base, inReplyTo: "<abc@mail.example.com>" }));

    expect(message).toContain("In-Reply-To: <abc@mail.example.com>");
    expect(message).toContain("References: <abc@mail.example.com>");
  });
});

/**
 * Every field here can hold a `{{variable}}`, so its value comes from whatever the flow received — a
 * webhook body, an email, a spreadsheet cell. A newline inside a header value ends that header and starts
 * another, which turns "send one person an email" into "send it to a list nobody chose".
 */
describe("header injection", () => {
  test("a newline in the subject cannot introduce a Bcc", () => {
    const message = decode(buildRawMessage({ ...base, subject: "Hi\r\nBcc: everyone@example.com" }));

    // The text survives — it is somebody's subject line — but only as part of the Subject value. What
    // must not exist is a line *beginning* Bcc:, which is what would make it a header.
    expect(message).toContain("Subject: Hi Bcc: everyone@example.com\r\n");
    expect(message).not.toMatch(/\r\nBcc:/);
  });

  test("a newline in the recipient cannot introduce a header either", () => {
    const message = decode(buildRawMessage({ ...base, to: "ada@example.com\nX-Evil: yes" }));

    expect(message).not.toContain("\r\nX-Evil:");
  });

  test("a bare linefeed is caught as well as a CRLF pair", () => {
    const message = decode(buildRawMessage({ ...base, subject: "One\nTwo" }));

    expect(message).toContain("Subject: One Two");
  });

  /** Folding whitespace collapses to one space so a wrapped value stays readable rather than jamming. */
  test("folded whitespace becomes a single space", () => {
    const message = decode(buildRawMessage({ ...base, subject: "One\r\n   Two" }));

    expect(message).toContain("Subject: One Two");
  });

  /**
   * The body is base64, so a newline there is data rather than structure — which is the other half of why
   * encoding it matters.
   */
  test("a newline in the body is content, not structure", () => {
    const raw = buildRawMessage({ ...base, body: "Line one\r\nBcc: everyone@example.com" });

    expect(decode(raw)).not.toContain("Bcc:");
    expect(decodeBody(raw)).toBe("Line one\r\nBcc: everyone@example.com");
  });
});

/**
 * A non-ASCII header is invalid as raw bytes, and sending it unencoded produces mojibake in the
 * recipient's client rather than an error anybody would notice.
 */
describe("non-ASCII headers", () => {
  test("are encoded as an RFC 2047 encoded-word", () => {
    const message = decode(buildRawMessage({ ...base, subject: "Facture réglée" }));

    expect(message).toContain("Subject: =?UTF-8?B?");
    expect(message).not.toContain("Subject: Facture réglée");
  });

  test("the encoded word decodes back to what was asked for", () => {
    const message = decode(buildRawMessage({ ...base, subject: "Facture réglée ✅" }));
    const encoded = /Subject: =\?UTF-8\?B\?(.+)\?=/.exec(message)?.[1] ?? "";

    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("Facture réglée ✅");
  });

  test("plain ASCII is left readable on the wire", () => {
    expect(decode(buildRawMessage(base))).toContain("Subject: Invoice");
  });
});

describe("reading a header back off a Gmail message", () => {
  const headers = [{ name: "From", value: "ada@example.com" }, { name: "Subject", value: "Hi" }, { value: "orphan" }];

  test("matches case-insensitively, as RFC 5322 requires", () => {
    expect(findHeader(headers, "from")).toBe("ada@example.com");
    expect(findHeader(headers, "FROM")).toBe("ada@example.com");
  });

  test("returns nothing for a header that is absent", () => {
    expect(findHeader(headers, "reply-to")).toBeUndefined();
  });

  test("tolerates a header with no name, which Gmail has been known to send", () => {
    expect(() => findHeader(headers, "subject")).not.toThrow();
    expect(findHeader(headers, "subject")).toBe("Hi");
  });
});

/**
 * A body composed in the builder carries the editor's Tailwind class names, and nothing rewrites a body that was
 * stored before the export was fixed. So the message is normalised here, at the last point before the MIME is
 * built — which is what makes an existing flow render correctly without anybody re-saving it.
 */
describe("an HTML body composed in the builder", () => {
  /** Exactly what was stored for the flow that arrived over-spaced. */
  const stored =
    '<p class="mb-1 last:mb-0"><span style="white-space: pre-wrap;">Hi </span><span>Ada</span></p>' +
    '<p class="mb-1 last:mb-0"><br></p><p class="mb-1 last:mb-0"><span>Body</span></p>';

  test("is sent with inline styles rather than editor class names", () => {
    const body = decodeBody(buildRawMessage({ to: "a@b.c", subject: "s", body: stored, bodyType: "html" }));

    // The class is what the recipient's client drops, falling back to its own ~16px paragraph margins.
    expect(body).not.toContain("class=");
    expect(body).toContain("margin: 0 0 4px");
  });

  test("keeps the content, the typed spaces and the blank line", () => {
    const body = decodeBody(buildRawMessage({ to: "a@b.c", subject: "s", body: stored, bodyType: "html" }));

    expect(body).toContain("white-space: pre-wrap");
    expect(body).toContain("Ada");
    expect([...body.matchAll(/<br>/g)]).toHaveLength(1);
  });

  test("a plain-text body is left exactly as it was", () => {
    // There is no markup to normalise, and rewriting text somebody typed would be a bug of its own.
    const text = "Hi Ada,\n\nRegards";
    const body = decodeBody(buildRawMessage({ to: "a@b.c", subject: "s", body: text, bodyType: "text" }));

    expect(body).toBe(text);
  });
});
