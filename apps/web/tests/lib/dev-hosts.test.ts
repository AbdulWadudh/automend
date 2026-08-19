import { describe, expect, test } from "bun:test";
import { deriveAllowedHosts } from "../../src/lib/dev-hosts";

describe("hosts the dev server answers to", () => {
  /** The case this exists for: a tunnel loads only if Vite recognises its Host header. */
  test("takes the hostname from a tunnelled auth origin", () => {
    expect(deriveAllowedHosts(["https://tunnel-5173.example.quest"])).toEqual(["tunnel-5173.example.quest"]);
  });

  test("splits the comma-separated origin list the api trusts", () => {
    expect(deriveAllowedHosts([undefined, "http://localhost:5173,http://localhost:8080"])).toEqual(["localhost"]);
  });

  test("names a host once, however many origins mention it", () => {
    const hosts = deriveAllowedHosts([
      "https://tunnel.example.quest",
      "https://tunnel.example.quest,http://localhost:5173",
    ]);

    expect(hosts).toEqual(["tunnel.example.quest", "localhost"]);
  });

  /** Refusing to start over a stray comma would be a worse failure than ignoring one. */
  test("skips what is not a URL rather than throwing", () => {
    expect(deriveAllowedHosts(["", "not-a-url, https://tunnel.example.quest ,"])).toEqual(["tunnel.example.quest"]);
  });

  test("is empty when nothing is configured, which leaves Vite's own defaults", () => {
    expect(deriveAllowedHosts([undefined, undefined])).toEqual([]);
  });
});
