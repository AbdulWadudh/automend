import { describe, expect, test } from "bun:test";
import { config } from "@automend/shared";
import { buildEngineLimits } from "../../src/engine/protocol";
import { checkAddress } from "../../src/engine/ssrf-guard";

/**
 * The highest-consequence logic in the worker.
 *
 * A flow's author supplies URLs, and a flow's *data* supplies them too — `{{body.callbackUrl}}` in an HTTP step
 * means whoever sends the webhook chooses where the worker connects. So these are not tests of a validator; they
 * are tests of a guard that has to hold for a URL nobody reviewed.
 */

const strict = buildEngineLimits(false);
const permissive = buildEngineLimits(true);

function allowed(url: string, limits = strict): boolean {
  return checkAddress(url, limits).allowed;
}

function reason(url: string, limits = strict): string {
  const verdict = checkAddress(url, limits);

  return verdict.allowed ? "" : verdict.reason;
}

describe("ordinary addresses", () => {
  test("public hosts are allowed over http and https", () => {
    expect(allowed("https://api.example.com/v1/orders")).toBe(true);
    expect(allowed("http://example.com")).toBe(true);
    expect(allowed("https://example.com:8443/path?q=1")).toBe(true);
  });

  test("a public IP is allowed", () => {
    expect(allowed("https://93.184.216.34/")).toBe(true);
    // 172.32 is public; only 172.16–31 is private, which is why the range is enumerated rather than prefixed.
    expect(allowed("https://172.32.0.1/")).toBe(true);
    expect(allowed("https://172.15.0.1/")).toBe(true);
  });
});

describe("the metadata service", () => {
  /**
   * The single most valuable target of an SSRF: it hands out the credentials of the machine the worker runs on. It
   * stays refused even for a deployment that opted into private networking, because no flow has a legitimate
   * reason to read it.
   */
  test("is refused, and stays refused even when private networking is allowed", () => {
    expect(allowed("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(allowed("http://169.254.169.254/", permissive)).toBe(false);
    expect(reason("http://169.254.169.254/")).toMatch(/link-local/);
  });

  test("its hostname form is refused too", () => {
    expect(allowed("http://metadata.google.internal/computeMetadata/v1/")).toBe(false);
  });

  test("and the IPv6 link-local range with it", () => {
    expect(allowed("http://[fe80::1]/")).toBe(false);
    expect(allowed("http://[fe80::1]/", permissive)).toBe(false);
  });
});

describe("the local machine and the private network", () => {
  test("loopback is refused by name and by address", () => {
    expect(allowed("http://localhost:3000/")).toBe(false);
    expect(allowed("http://127.0.0.1:5432/")).toBe(false);
    expect(allowed("http://[::1]:6379/")).toBe(false);
    // `.localhost` resolves to loopback by specification, so the name is as much a loopback address as the number.
    expect(allowed("http://api.localhost/")).toBe(false);
  });

  test("the private ranges are refused, which is where Postgres and Redis live", () => {
    expect(allowed("http://10.0.0.5:5432/")).toBe(false);
    expect(allowed("http://192.168.1.10/")).toBe(false);
    expect(allowed("http://172.16.0.1/")).toBe(false);
    expect(allowed("http://172.31.255.255/")).toBe(false);
    expect(allowed("http://[fd00::1]/")).toBe(false);
  });

  test("0.0.0.0 is refused, since it reaches the local host", () => {
    expect(allowed("http://0.0.0.0:3000/")).toBe(false);
  });

  test("carrier-grade NAT is refused", () => {
    expect(allowed("http://100.64.0.1/")).toBe(false);
  });

  /** An IPv4 address wearing an IPv6 hat is the same address, and the same rules apply. */
  test("an IPv4-mapped IPv6 address does not slip past", () => {
    expect(allowed("http://[::ffff:127.0.0.1]/")).toBe(false);
    expect(allowed("http://[::ffff:169.254.169.254]/")).toBe(false);
    expect(allowed("http://[::ffff:10.0.0.1]/")).toBe(false);
    expect(allowed("http://[::ffff:93.184.216.34]/")).toBe(true);
  });

  test("a deployment can opt into its own network, which is the point of the switch", () => {
    expect(allowed("http://10.0.0.5:8080/", permissive)).toBe(true);
    expect(allowed("http://localhost:8080/", permissive)).toBe(true);
    expect(allowed("http://[fd00::1]/", permissive)).toBe(true);
  });
});

describe("protocols", () => {
  /** `file://` reads the disk; `gopher://` has been used to speak to Redis through an HTTP client. */
  test("only http and https are usable", () => {
    for (const url of ["file:///etc/passwd", "gopher://localhost:6379/_SET%20x%20y", "ftp://example.com/"]) {
      expect(allowed(url)).toBe(false);
    }

    expect(reason("file:///etc/passwd")).toMatch(/protocol/);
  });
});

describe("things that are not addresses", () => {
  test("a value that will not parse is refused rather than guessed at", () => {
    expect(allowed("not a url")).toBe(false);
    expect(allowed("")).toBe(false);
    // The most likely real cause: a template that never resolved.
    expect(allowed("{{callbackUrl}}")).toBe(false);
  });
});

describe("the limits the guard is given", () => {
  test("come from config rather than from anything a flow can influence", () => {
    expect(strict.allowPrivateNetwork).toBe(false);
    expect(strict.requestTimeoutMs).toBe(config.engine.http.requestTimeoutMs);
    expect(strict.maxRedirects).toBe(config.engine.http.maxRedirects);
    expect(strict.maxResponseBytes).toBe(config.engine.http.maxResponseBytes);
    expect(strict.blockedHostnames).toEqual([...config.engine.http.blockedHostnames]);
  });
});
