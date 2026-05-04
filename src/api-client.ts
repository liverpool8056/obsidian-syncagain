import { requestUrl } from "obsidian";
import { RemoteFileEntry } from "./metadata";

export interface LockEntry {
  key: string;
  client_id: string;
  acquired_at: string;
  expires_at: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Set when status === 402 — the name of the feature that is not enabled. */
    public readonly feature?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Vault-level E2EE state returned by GET /api/config. */
export interface VaultE2EEState {
  enabled: boolean;
  status: "DISABLED" | "MIGRATING" | "ACTIVE" | "MIGRATING_TO_OFF";
  salt?: string;
  encrypted_dek?: string;
  key_epoch: number;
  key_verification_token?: string;
  initiator_id?: string;
}

/**
 * Vault-level synced settings. Shared across all devices on the same vault.
 *
 * Only settings whose semantics are inherently per-vault belong here.
 * Per-device intent (e.g. whether *this* device is currently participating in sync,
 * which is `syncEnabled` in `data.json`) is intentionally not part of this type.
 * See `SYNCED_SETTINGS.md` §2 for the classification rule.
 */
export interface VaultSettings {
  sync_interval_minutes: number;
}

/** Per-vault feature state returned by GET /api/config. */
export interface VaultFeatureState {
  e2ee?: VaultE2EEState;
  /**
   * Effective synced settings — always populated. When the row hasn't been
   * initialised yet, the server returns in-code defaults and sets
   * `vault_settings_initialized` to false.
   */
  settings: VaultSettings;
  /**
   * `false` when `settings` is the in-code fallback default (server has never
   * received a PUT). The device that received `created: true` from the
   * handshake should PUT its local settings to initialise the row.
   * Joining devices must adopt server defaults and never upload.
   */
  vault_settings_initialized: boolean;
}

/** Full server config delivered via GET /api/config and inline in WebSocket pongs. */
export interface ServerConfig {
  user: {
    email: string;
    plan: string;
    storage_used_bytes: number;
    storage_limit_bytes: number;
  };
  /** Paid feature names enabled for this account (e.g. `["e2ee"]`). */
  features: string[];
  /** Negotiated per-vault feature state for the current vault. */
  vault: VaultFeatureState;
  config_version: number;
}

/** Subset of the server's `AccountResponse` used by the plugin. */
export interface AccountInfo {
  email: string;
  plan: string;
  status: string;
  storage_used_bytes: number;
  storage_limit_bytes: number;
  file_count: number;
  traffic_bytes: number;
  created_at: string;
  last_active_at: string | null;
  /** Paid feature names enabled for this account (e.g. `["e2ee"]`). */
  features: string[];
}

/**
 * Typed HTTP client for the obsidian-sync-server REST API.
 *
 * Authentication is token-based. The token is obtained externally (via
 * browser sign-up or inline sign-in form) and passed in at construction
 * time or set later via `setToken`. If the token is missing or expired
 * (HTTP 401), `onAuthFailure` is invoked and the error is re-thrown.
 */
export class ApiClient {
  private token: string | null;
  private remoteVaultId = "";

  constructor(
    private serverUrl: string,
    private clientId: string,
    token: string | null = null,
    private readonly onAuthFailure?: () => void,
  ) {
    this.token = token || null;
  }

  /** Replace the cached token (e.g. after sign-in via URI callback). */
  setToken(token: string): void {
    this.token = token;
  }

  /** Discard the cached token (e.g. on sign-out). */
  invalidateToken(): void {
    this.token = null;
  }

  /** Set the vault namespace prefix used for all file keys. */
  setRemoteVaultId(id: string): void {
    this.remoteVaultId = id;
  }

  /** Replace the base server URL (e.g. when the user edits it in settings). */
  setServerUrl(url: string): void {
    this.serverUrl = url;
  }

  /**
   * Convert a vault-local key to the server-side key by prepending the vault prefix.
   * Throws if remoteVaultId is not set — callers must wait for the vault handshake
   * before issuing any keyed operation, or files would land outside the vault namespace.
   */
  private remoteKey(key: string): string {
    if (!this.remoteVaultId) {
      throw new Error(
        "remoteVaultId is not set — vault handshake must complete before any file/lock operation",
      );
    }
    return `${this.remoteVaultId}/${key}`;
  }

  /**
   * Given a key from a server event (post user-prefix strip), return the vault-local
   * key, or null if the key does not belong to this vault. Returns null when
   * remoteVaultId is not yet set so unprefixed events cannot leak through.
   */
  resolveEventKey(key: string): string | null {
    if (!this.remoteVaultId) return null;
    const prefix = `${this.remoteVaultId}/`;
    if (!key.startsWith(prefix)) return null;
    return key.slice(prefix.length);
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  /**
   * Sign in with email + password and store the returned token.
   * Used by the inline sign-in form in the settings tab.
   * Returns `{ token, userId, userEmail }` on success.
   */
  async loginWithCredentials(
    email: string,
    password: string,
  ): Promise<{ token: string; userId: string; userEmail: string }> {
    const res = await requestUrl({
      url: `${this.serverUrl}/api/auth/login`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, client_id: this.clientId }),
      throw: false,
    });

    if (res.status >= 200 && res.status < 300) {
      const data = res.json as { token: string; user_id: string; email: string };
      this.token = data.token;
      return { token: data.token, userId: data.user_id, userEmail: data.email };
    }

    let msg: string;
    try {
      msg = (res.json as { error?: string }).error ?? String(res.status);
    } catch {
      msg = String(res.status);
    }
    throw new ApiError(res.status, msg);
  }

  // ── Generic request helper ───────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    if (!this.token) {
      this.onAuthFailure?.();
      throw new ApiError(401, "Not signed in. Please sign in in the SyncAgain settings.");
    }

    const res = await requestUrl({
      url: `${this.serverUrl}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...extraHeaders,
      },
      body,
      throw: false,
    });

    if (res.status === 401) {
      this.token = null;
      this.onAuthFailure?.();
      throw new ApiError(401, "Session expired. Please sign in again in the SyncAgain settings.");
    }

    if (res.status < 200 || res.status >= 300) {
      let msg = res.text;
      try { msg = (res.json as { error?: string }).error ?? msg; } catch { /* ignore */ }
      throw new ApiError(res.status, msg);
    }

    if (res.status === 204) return undefined as unknown as T;
    return res.json as T;
  }

  // ── Vault registry ───────────────────────────────────────────────────────

  /**
   * Vault handshake — called once on first startup when no remoteVaultId is stored.
   * If the account has no vaults, the server auto-creates one and returns
   * `{ created: true, vault: { vault_id, name } }`.
   * If vaults exist, the server returns `{ created: false, vaults: [...] }` and
   * the caller must show a picker.
   */
  async vaultHandshake(localName: string): Promise<
    | { created: true; vault: { vault_id: string; name: string } }
    | { created: false; vaults: { vault_id: string; name: string }[] }
  > {
    return this.request<
      | { created: true; vault: { vault_id: string; name: string } }
      | { created: false; vaults: { vault_id: string; name: string }[] }
    >(
      "POST",
      "/api/vaults/handshake",
      JSON.stringify({ local_name: localName }),
      { "Content-Type": "application/json" },
    );
  }

  /**
   * Create a new remote vault. The server generates the vault UUID.
   * Returns `{ vault_id, name }` on success.
   */
  async createVault(localName: string): Promise<{ vault_id: string; name: string }> {
    return this.request<{ vault_id: string; name: string }>(
      "POST",
      "/api/vaults",
      JSON.stringify({ name: localName }),
      { "Content-Type": "application/json" },
    );
  }

  /**
   * Register this device with an existing vault.
   * Upserts a vault_devices row for the calling client_id + vault_id.
   * Returns `{ vault_id }` on success; throws ApiError 404 if the vault
   * does not belong to the authenticated user.
   */
  async joinVault(vaultId: string): Promise<{ vault_id: string }> {
    return this.request<{ vault_id: string }>(
      "POST",
      `/api/vaults/${encodeURIComponent(vaultId)}/join`,
    );
  }

  /**
   * List all remote vaults registered to this account.
   * Server returns the array directly (not wrapped).
   */
  async listVaults(): Promise<{ vault_id: string; name: string }[]> {
    return this.request<{ vault_id: string; name: string }[]>("GET", "/api/vaults");
  }

  /**
   * Register or update the local folder name for this vault on the server,
   * and upsert the device association. Called on every sync start so the
   * server always has the current local folder name (handles OS-level renames)
   * and a fresh `last_seen` timestamp for this device.
   *
   * Silently no-ops when remoteVaultId is empty (vault not linked yet).
   */
  async registerVault(vaultName: string): Promise<void> {
    if (!this.remoteVaultId) return;
    try {
      await this.request(
        "PUT",
        `/api/vaults/${encodeURIComponent(this.remoteVaultId)}`,
        JSON.stringify({ name: vaultName }),
        { "Content-Type": "application/json" },
      );
    } catch (err) {
      // Non-fatal — a failed registration doesn't block sync.
      console.warn("[SyncAgain] Failed to register vault name:", err);
    }
  }

  // ── Account ──────────────────────────────────────────────────────────────

  /** Fetch the authenticated user's account info, including enabled features. */
  async getAccount(): Promise<AccountInfo> {
    return this.request<AccountInfo>("GET", "/api/account");
  }

  // ── Files ────────────────────────────────────────────────────────────────

  async listFiles(): Promise<RemoteFileEntry[]> {
    if (!this.remoteVaultId) {
      throw new Error(
        "remoteVaultId is not set — vault handshake must complete before listing files",
      );
    }
    const data = await this.request<{ files: RemoteFileEntry[] }>(
      "GET",
      `/api/files?vault_id=${encodeURIComponent(this.remoteVaultId)}`,
    );
    const prefix = `${this.remoteVaultId}/`;
    return data.files
      .filter((f) => f.key.startsWith(prefix))
      .map((f) => ({ ...f, key: f.key.slice(prefix.length) }));
  }

  async downloadFile(key: string): Promise<ArrayBuffer> {
    if (!this.token) {
      this.onAuthFailure?.();
      throw new ApiError(401, "Not signed in.");
    }
    const res = await requestUrl({
      url: `${this.serverUrl}/api/files/download?key=${encodeURIComponent(this.remoteKey(key))}`,
      headers: { Authorization: `Bearer ${this.token}` },
      throw: false,
    });
    if (res.status === 401) {
      this.token = null;
      this.onAuthFailure?.();
      throw new ApiError(401, "Session expired. Please sign in again.");
    }
    if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, `Download failed for '${key}'`);
    return res.arrayBuffer;
  }

  /**
   * Upload `data` to `key`. The caller must hold the lock before calling this.
   */
  async uploadFile(
    key: string,
    data: ArrayBuffer,
    options: {
      contentHmac?: string;
      isEncrypted?: boolean;
      contentType?: string;
    } = {},
  ): Promise<void> {
    if (!this.token) {
      this.onAuthFailure?.();
      throw new ApiError(401, "Not signed in.");
    }

    if (!this.remoteVaultId) {
      throw new Error("remoteVaultId is not set — vault handshake must complete before uploading");
    }

    // Manually construct multipart/form-data body since requestUrl doesn't accept FormData.
    const boundary = `----SyncAgainBoundary${Date.now()}`;
    const enc = new TextEncoder();

    const parts: Uint8Array[] = [];

    const addPart = (name: string, value: string) => {
      parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    };

    addPart("vault_id", this.remoteVaultId);
    addPart("key", key);

    if (options.contentHmac) {
      addPart("content_hmac", options.contentHmac);
    }
    if (options.isEncrypted !== undefined) {
      addPart("is_encrypted", options.isEncrypted ? "true" : "false");
    }

    const contentType = options.contentType || "application/octet-stream";
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${key}"\r\nContent-Type: ${contentType}\r\n\r\n`));
    parts.push(new Uint8Array(data));
    parts.push(enc.encode(`\r\n--${boundary}--\r\n`));

    const totalLength = parts.reduce((acc, p) => acc + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const p of parts) {
      body.set(p, offset);
      offset += p.length;
    }

    const res = await requestUrl({
      url: `${this.serverUrl}/api/files/upload`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: body.buffer,
      throw: false,
    });

    if (res.status === 401) {
      this.token = null;
      this.onAuthFailure?.();
      throw new ApiError(401, "Session expired. Please sign in again.");
    }
    if (res.status === 402) {
      let feature: string | undefined;
      try {
        feature = (res.json as { feature?: string }).feature;
      } catch {
        /* ignore */
      }
      throw new ApiError(402, "feature_not_enabled", feature);
    }
    if (res.status < 200 || res.status >= 300) {
      let msg = res.text;
      try {
        msg = (res.json as { error?: string }).error ?? msg;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, msg);
    }
  }

  /** Delete `key` on the server. The caller must hold the lock. */
  async deleteFile(key: string): Promise<void> {
    await this.request(
      "DELETE",
      `/api/files?vault_id=${encodeURIComponent(this.remoteVaultId)}&key=${encodeURIComponent(key)}`,
    );
  }

  // ── Locks ─────────────────────────────────────────────────────────────────

  /**
   * Acquire locks on the given keys.
   * Throws `ApiError` with status 409 if any key is locked by another client.
   */
  async acquireLocks(keys: string[]): Promise<void> {
    await this.request(
      "POST",
      "/api/locks",
      JSON.stringify({ client_id: this.clientId, files: keys.map((k) => this.remoteKey(k)) }),
      { "Content-Type": "application/json" },
    );
  }

  async releaseLocks(keys: string[]): Promise<void> {
    await this.request(
      "DELETE",
      "/api/locks",
      JSON.stringify({ client_id: this.clientId, files: keys.map((k) => this.remoteKey(k)) }),
      { "Content-Type": "application/json" },
    );
  }

  async listLocks(): Promise<LockEntry[]> {
    const data = await this.request<{ locks: LockEntry[] }>("GET", "/api/locks");
    return data.locks;
  }

  // ── WebSocket control channel ────────────────────────────────────────────

  /**
   * Returns the WebSocket URL for the control channel endpoint.
   * The scheme is converted from http(s) → ws(s) automatically.
   * The auth token is appended as a query parameter when available; the
   * connection is always attempted regardless of auth state so the status
   * badge reflects server reachability independently of login.
   */
  buildWsUrl(): string | null {
    if (!this.serverUrl) return null;
    const base = this.serverUrl.replace(/^http/, "ws");
    const url = `${base}/api/ws`;
    const params = new URLSearchParams();
    if (this.token) params.set("token", this.token);
    if (this.remoteVaultId) params.set("vault_id", this.remoteVaultId);
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }

  /** Fetch the full server config (entitlements + vault state + config version). */
  async getConfig(): Promise<ServerConfig> {
    return this.request<ServerConfig>("GET", "/api/config");
  }

  /**
   * Set or rotate vault E2EE state on the server.
   * Called by the E2EE negotiator when registering E2EE for the first time or
   * after a passphrase rotation on this device.
   */
  async putVaultEncryption(
    remoteVaultId: string,
    payload: {
      status: "DISABLED" | "MIGRATING" | "ACTIVE" | "MIGRATING_TO_OFF";
      epoch: number;
      salt?: string;
      encrypted_dek?: string;
      token?: string;
    },
  ): Promise<void> {
    await this.request(
      "PUT",
      `/api/vaults/${encodeURIComponent(remoteVaultId)}/encryption`,
      JSON.stringify(payload),
      { "Content-Type": "application/json" },
    );
  }

  /**
   * Push vault-level settings to the server. Body fields are all optional —
   * only included keys are merged on the server side. The server bumps
   * `config_version`, so other devices receive the update in their next pong.
   */
  async updateVaultSettings(
    remoteVaultId: string,
    settings: Partial<VaultSettings>,
  ): Promise<void> {
    await this.request(
      "PUT",
      `/api/vaults/${encodeURIComponent(remoteVaultId)}/settings`,
      JSON.stringify(settings),
      { "Content-Type": "application/json" },
    );
  }

}
