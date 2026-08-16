import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { config } from "../src/config";
import { decryptSecret, encryptSecret, parseMasterKey, secretHint, secretsMatch } from "../src/crypto";

const masterKey = randomBytes(config.secrets.keyLengthBytes);
const otherKey = randomBytes(config.secrets.keyLengthBytes);

describe("the master key", () => {
  test("is accepted at exactly the required length", () => {
    const encoded = masterKey.toString("base64");

    expect(parseMasterKey(encoded).equals(masterKey)).toBe(true);
  });

  test("is rejected at any other length, at startup rather than at first use", () => {
    for (const length of [16, 31, 33, 64]) {
      expect(() => parseMasterKey(randomBytes(length).toString("base64"))).toThrow(/SECRETS_KEY/);
    }
  });

  test("reports how to generate a correct one", () => {
    expect(() => parseMasterKey("")).toThrow(/openssl rand -base64/);
  });
});

describe("encrypting a secret", () => {
  test("round-trips", () => {
    // Shaped like a real token but matching no provider's format on purpose: a fixture that looks
    // like a Slack `xoxb` bot token trips GitHub's push protection and blocks the push.
    const token = "example-token-1234567890-abcdefghijklmnop";

    expect(decryptSecret(encryptSecret(token, masterKey), masterKey)).toBe(token);
  });

  test("round-trips values that are not plain ASCII", () => {
    const token = "clé-secrète-🔑-日本語";

    expect(decryptSecret(encryptSecret(token, masterKey), masterKey)).toBe(token);
  });

  test("never produces the same ciphertext twice for the same input", () => {
    // Each secret gets its own data key and IV, so identical tokens are indistinguishable in the
    // database — otherwise anyone reading it could tell which workspaces share a key.
    const envelopes = Array.from({ length: 20 }, () => encryptSecret("same-token", masterKey));
    const ciphertexts = new Set(envelopes.map((envelope) => envelope.data.ct));
    const dataKeys = new Set(envelopes.map((envelope) => envelope.key.ct));

    expect(ciphertexts.size).toBe(envelopes.length);
    expect(dataKeys.size).toBe(envelopes.length);
  });

  test("the plaintext never appears in the stored form", () => {
    const envelope = encryptSecret("super-secret-value", masterKey);

    expect(JSON.stringify(envelope)).not.toContain("super-secret-value");
  });
});

describe("decrypting a secret", () => {
  test("fails with a different master key", () => {
    expect(() => decryptSecret(encryptSecret("token", masterKey), otherKey)).toThrow(/could not be decrypted/);
  });

  test("fails when the ciphertext has been edited", () => {
    // The point of an authenticated cipher: a tampered value must not decrypt to something else.
    const envelope = encryptSecret("token", masterKey);
    const tampered = { ...envelope, data: { ...envelope.data, ct: randomBytes(16).toString("base64") } };

    expect(() => decryptSecret(tampered, masterKey)).toThrow(/could not be decrypted/);
  });

  test("fails when the authentication tag has been edited", () => {
    const envelope = encryptSecret("token", masterKey);
    const tampered = { ...envelope, data: { ...envelope.data, tag: randomBytes(16).toString("base64") } };

    expect(() => decryptSecret(tampered, masterKey)).toThrow(/could not be decrypted/);
  });

  test("fails when the sealed data key has been swapped for another", () => {
    const envelope = encryptSecret("token", masterKey);
    const other = encryptSecret("token", masterKey);

    expect(() => decryptSecret({ ...envelope, key: other.key }, masterKey)).toThrow(/could not be decrypted/);
  });

  test("refuses an envelope from a scheme it does not know", () => {
    const envelope = encryptSecret("token", masterKey);

    expect(() => decryptSecret({ ...envelope, v: envelope.v + 1 }, masterKey)).toThrow(/Unsupported/);
  });

  test("never reveals why it failed", () => {
    // A caller learning "wrong key" versus "tampered value" helps only someone probing the store.
    try {
      decryptSecret(encryptSecret("token", masterKey), otherKey);
      throw new Error("expected decryption to fail");
    } catch (error) {
      expect((error as Error).message).toBe("A stored secret could not be decrypted");
    }
  });
});

describe("showing which secret is stored", () => {
  test("reveals only the last few characters", () => {
    const hint = secretHint("example-token-1234567890-abcdefghijklmnop");

    expect(hint.endsWith("mnop")).toBe(true);
    expect(hint).not.toContain("example-token");
  });

  test("masks a short secret completely, rather than disclosing half of it", () => {
    expect(secretHint("abcd")).not.toContain("abcd");
    expect(secretHint("ab")).not.toContain("ab");
  });
});

describe("comparing secrets", () => {
  test("matches identical values and rejects everything else", () => {
    expect(secretsMatch("token", "token")).toBe(true);
    expect(secretsMatch("token", "token ")).toBe(false);
    expect(secretsMatch("token", "other")).toBe(false);
    expect(secretsMatch("", "")).toBe(true);
  });
});
