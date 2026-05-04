import { argon2id } from "hash-wasm";

/**
 * Multi-device End-to-End Encryption (E2EE) implementation.
 *
 * Design:
 * 1. Secret Key: User-saved 16-character alphanumeric code.
 * 2. KEK (Key Encryption Key): Derived from Secret Key via Argon2id.
 * 3. DEK (Data Encryption Key): Random 256-bit key used for file content.
 * 4. Encrypted DEK: DEK encrypted with KEK, stored on server.
 * 5. HMAC-SHA256: Used for zero-knowledge deduplication.
 */
export class VaultEncryption {
  private static readonly VERIFICATION_PLAINTEXT = "syncagain-v1";

  /**
   * Data Encryption Key (DEK). Used for actual file encryption and HMAC.
   */
  private readonly dek: CryptoKey;

  private constructor(dek: CryptoKey) {
    this.dek = dek;
  }

  /**
   * Create a VaultEncryption instance by decrypting an encrypted DEK using a Secret Key.
   */
  static async fromSecretKey(
    secretKey: string,
    saltHex: string,
    encryptedDekHex: string,
  ): Promise<VaultEncryption> {
    const kek = await this.deriveKEK(secretKey, saltHex);
    const encryptedDek = hexToBytes(encryptedDekHex);
    const dekBytes = await this.decryptWithKey(encryptedDek, kek);
    // extractable=true so calculateHMAC() and exportDEK() can re-export the raw bytes.
    const dek = await crypto.subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, true, [
      "encrypt",
      "decrypt",
    ]);
    return new VaultEncryption(dek);
  }

  /**
   * Initialize a fresh E2EE setup:
   * 1. Generate a random Secret Key.
   * 2. Generate a random Salt.
   * 3. Derive KEK.
   * 4. Generate a random DEK.
   * 5. Encrypt DEK with KEK.
   *
   * Returns { secretKey, salt, encryptedDek, instance }.
   */
  static async setupNew(): Promise<{
    secretKey: string;
    salt: string;
    encryptedDek: string;
    instance: VaultEncryption;
  }> {
    const secretKey = this.generateSecretKey();
    const saltBytes = crypto.getRandomValues(new Uint8Array(32));
    const salt = bytesToHex(saltBytes);

    const kek = await this.deriveKEK(secretKey, salt);

    const dekBytes = crypto.getRandomValues(new Uint8Array(32));
    // extractable=true so calculateHMAC() and exportDEK() can re-export the raw bytes.
    const dek = await crypto.subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, true, [
      "encrypt",
      "decrypt",
    ]);

    const encryptedDekBytes = await this.encryptWithKey(dekBytes, kek);
    const encryptedDek = bytesToHex(new Uint8Array(encryptedDekBytes));

    return {
      secretKey,
      salt,
      encryptedDek,
      instance: new VaultEncryption(dek),
    };
  }

  /**
   * Derive a Key Encryption Key (KEK) from the Secret Key using Argon2id.
   */
  private static async deriveKEK(secretKey: string, saltHex: string): Promise<CryptoKey> {
    const salt = hexToBytes(saltHex);
    const hash = await argon2id({
      password: secretKey,
      salt,
      iterations: 3,
      memorySize: 64 * 1024, // 64MB
      parallelism: 1,
      hashLength: 32, // 256-bit key
      outputType: "binary",
    }) as Uint8Array;

    return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  /**
   * Generate a random 16-character alphanumeric Secret Key (e.g., H7K2-M9P4-L1X6-R8T5).
   */
  static generateSecretKey(): string {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No O/0, I/1 to avoid confusion
    const random = crypto.getRandomValues(new Uint8Array(16));
    let result = "";
    for (let i = 0; i < 16; i++) {
      if (i > 0 && i % 4 === 0) result += "-";
      result += charset[random[i] % charset.length];
    }
    return result;
  }

  /**
   * Encrypt data with the DEK.
   * Output: [ 12-byte IV | ciphertext + 16-byte GCM tag ]
   */
  async encrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    return VaultEncryption.encryptWithKey(data, this.dek);
  }

  /**
   * Decrypt data with the DEK.
   */
  async decrypt(data: ArrayBuffer): Promise<ArrayBuffer> {
    return VaultEncryption.decryptWithKey(data, this.dek);
  }

  /**
   * Calculate HMAC-SHA256 of the plaintext for deduplication.
   * Keyed by the DEK.
   */
  async calculateHMAC(data: ArrayBuffer): Promise<string> {
    // SubtleCrypto HMAC needs a specific key type. We can derive it or import DEK bytes as HMAC key.
    const dekBytes = await crypto.subtle.exportKey("raw", this.dek);
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      dekBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", hmacKey, data);
    return bytesToHex(new Uint8Array(signature));
  }

  /**
   * Create a verification token for the server.
   * Encrypts "syncagain-v1" with the DEK.
   */
  async createKeyVerificationToken(): Promise<string> {
    const plaintext = new TextEncoder().encode(VaultEncryption.VERIFICATION_PLAINTEXT);
    const ciphertext = await this.encrypt(plaintext.buffer);
    return btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  }

  /**
   * Verify a token from the server.
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

  /**
   * Export the raw DEK bytes for local storage (auto-unlock).
   */
  async exportDEK(): Promise<string> {
    const bytes = await crypto.subtle.exportKey("raw", this.dek);
    return bytesToHex(new Uint8Array(bytes));
  }

  /**
   * Import DEK from hex string.
   */
  static async importDEK(dekHex: string): Promise<VaultEncryption> {
    const bytes = hexToBytes(dekHex);
    // extractable=true so calculateHMAC() and exportDEK() can re-export the raw bytes.
    const dek = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, true, [
      "encrypt",
      "decrypt",
    ]);
    return new VaultEncryption(dek);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private static async encryptWithKey(data: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    const out = new Uint8Array(12 + ciphertext.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ciphertext), 12);
    return out.buffer;
  }

  private static async decryptWithKey(data: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
    const bytes = new Uint8Array(data);
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
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
