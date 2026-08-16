/**
 * Envelope encryption for secrets held at rest.
 *
 * Server-only, and deliberately not exported from the package index — nothing in the browser
 * bundle may import this.
 *
 * Every secret gets its own single-use data key. The secret is encrypted with that key, and the
 * key is then encrypted with the master key from the environment. Two consequences make this worth
 * the extra step over encrypting each secret with the master key directly:
 *
 * 1. The master key encrypts only small, fixed-size, high-entropy values, never user data.
 * 2. Rotating the master key means re-encrypting one data key per secret, which can be done
 *    without ever decrypting the secrets themselves.
 *
 * AES-256-GCM throughout, so every ciphertext is authenticated: a value edited in the database
 * fails to decrypt rather than decrypting to something else.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";

const { secrets } = config;

export type EncryptedSecret = {
  /** Lets a future change to the scheme be recognised rather than mis-parsed. */
  v: number;
  /** The data key, encrypted with the master key. */
  key: SealedValue;
  /** The secret, encrypted with the data key. */
  data: SealedValue;
};

type SealedValue = {
  /** Initialisation vector, base64. Random per encryption — never reused with the same key. */
  iv: string;
  /** Ciphertext, base64. */
  ct: string;
  /** GCM authentication tag, base64. */
  tag: string;
};

export function secretsKeyError(message: string): Error {
  return Object.assign(new Error(message), { name: "SecretsKeyError" });
}

export function decryptionError(message: string): Error {
  return Object.assign(new Error(message), { name: "DecryptionError" });
}

/**
 * Parses the master key from its base64 form.
 *
 * The length is checked rather than assumed: a short key would otherwise be padded or rejected
 * deep inside the cipher, long after the process had started serving traffic.
 */
export function parseMasterKey(base64Key: string): Buffer {
  let key: Buffer;

  try {
    key = Buffer.from(base64Key, "base64");
  } catch {
    throw secretsKeyError("SECRETS_KEY is not valid base64");
  }

  if (key.length !== secrets.keyLengthBytes) {
    throw secretsKeyError(
      `SECRETS_KEY must decode to exactly ${secrets.keyLengthBytes} bytes (got ${key.length}). Generate one with: openssl rand -base64 ${secrets.keyLengthBytes}`,
    );
  }

  return key;
}

function seal(plaintext: Buffer, key: Buffer): SealedValue {
  const iv = randomBytes(secrets.ivLengthBytes);
  const cipher = createCipheriv(secrets.algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    iv: iv.toString("base64"),
    ct: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function open(sealed: SealedValue, key: Buffer): Buffer {
  const decipher = createDecipheriv(secrets.algorithm, key, Buffer.from(sealed.iv, "base64"));

  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));

  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]);
}

export function encryptSecret(plaintext: string, masterKey: Buffer): EncryptedSecret {
  const dataKey = randomBytes(secrets.keyLengthBytes);

  try {
    return {
      v: secrets.envelopeVersion,
      key: seal(dataKey, masterKey),
      data: seal(Buffer.from(plaintext, "utf8"), dataKey),
    };
  } finally {
    // The data key exists only to be sealed; leaving it in memory serves no purpose.
    dataKey.fill(0);
  }
}

export function decryptSecret(envelope: EncryptedSecret, masterKey: Buffer): string {
  if (envelope.v !== secrets.envelopeVersion) {
    throw decryptionError(`Unsupported secret envelope version ${envelope.v}`);
  }

  let dataKey: Buffer;

  try {
    dataKey = open(envelope.key, masterKey);
  } catch {
    // Never echoes the cause: whether the key was wrong or the value was edited is not something
    // a caller needs to know, and saying so helps anyone probing the store.
    throw decryptionError("A stored secret could not be decrypted");
  }

  try {
    return open(envelope.data, dataKey).toString("utf8");
  } catch {
    throw decryptionError("A stored secret could not be decrypted");
  } finally {
    dataKey.fill(0);
  }
}

/**
 * The last few characters of a secret, for showing which one is stored without revealing it.
 *
 * Anything shorter than the hint length is masked entirely rather than partly shown — a four
 * character secret would otherwise be half disclosed by its own hint.
 */
export function secretHint(plaintext: string): string {
  if (plaintext.length <= secrets.hintLength * 2) {
    return "•".repeat(secrets.hintMaskLength);
  }

  return `${"•".repeat(secrets.hintMaskLength)}${plaintext.slice(-secrets.hintLength)}`;
}

/** Constant-time comparison, for anywhere a secret is checked rather than decrypted. */
export function secretsMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  return timingSafeEqual(leftBytes, rightBytes);
}
