/**
 * AES-256-GCM vault encryption.
 *
 * Key derivation: PBKDF2(SHA-256, 100 000 iterations) with a random 32-byte salt.
 * Encrypted format: [ 12-byte IV | ciphertext + 16-byte GCM auth tag ]
 *
 * The passphrase never leaves the device; the server only ever receives ciphertext.
 */
export class VaultEncryption {
  /** Known plaintext used for key verification tokens. */
  private static readonly VERIFICATION_PLAINTEXT = "syncagain-e2ee-v1";

  private constructor(private readonly key: CryptoKey) {}

  /**
   * Derive an AES-256-GCM key from `passphrase` and the hex-encoded `saltHex`.
   * `saltHex` must be the string produced by `VaultEncryption.generateSalt()`.
   */
  static async create(passphrase: string, saltHex: string): Promise<VaultEncryption> {
    const salt = hexToBytes(saltHex);
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return new VaultEncryption(key);
  }

  /** Generate a fresh random 32-byte salt, returned as a hex string for storage in settings. */
  static generateSalt(): string {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  }

  /**
   * Encrypt `data`. Output layout: `[ 12-byte IV | ciphertext | 16-byte GCM auth tag ]`.
   * A fresh random IV is generated for every call, so the same plaintext produces
   * different ciphertext each time (semantic security).
   */
  async encrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, data);
    const out = new Uint8Array(12 + ciphertext.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ciphertext), 12);
    return out.buffer;
  }

  /**
   * Decrypt data produced by `encrypt`.
   * Throws a `DOMException` if the data is malformed or the GCM auth tag fails —
   * the caller can catch this to detect files uploaded without encryption.
   */
  async decrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(data);
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, this.key, ciphertext);
  }

  /**
   * Produce an opaque key verification token by encrypting a known plaintext with
   * the derived key. The server stores this token and returns it in vault config so
   * any device can verify its local passphrase derives the same key — without the
   * server ever learning the key.
   *
   * The token is base64-encoded ciphertext (IV + ciphertext + GCM auth tag).
   */
  async createKeyVerificationToken(): Promise<string> {
    const plaintext = new TextEncoder().encode(VaultEncryption.VERIFICATION_PLAINTEXT);
    const ciphertext = await this.encrypt(plaintext.buffer);
    return btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  }

  /**
   * Verify that `token` (produced by `createKeyVerificationToken` with the correct key)
   * decrypts to the expected plaintext. Returns `true` if the key matches, `false` otherwise.
   */
  async verifyKeyToken(token: string): Promise<boolean> {
    try {
      const bytes = Uint8Array.from(atob(token), (c) => c.charCodeAt(0));
      const plaintext = await this.decrypt(bytes.buffer);
      const decoded = new TextDecoder().decode(plaintext);
      return decoded === VaultEncryption.VERIFICATION_PLAINTEXT;
    } catch {
      return false;
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
