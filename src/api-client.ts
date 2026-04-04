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
  ) {
    super(message);
    this.name = "ApiError";
  }
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

  // ── Files ────────────────────────────────────────────────────────────────

  async listFiles(): Promise<RemoteFileEntry[]> {
    const data = await this.request<{ files: RemoteFileEntry[] }>("GET", "/api/files");
    return data.files;
  }

  async downloadFile(key: string): Promise<ArrayBuffer> {
    if (!this.token) {
      this.onAuthFailure?.();
      throw new ApiError(401, "Not signed in.");
    }
    const res = await requestUrl({
      url: `${this.serverUrl}/api/files/download?key=${encodeURIComponent(key)}`,
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

  /** Upload `data` to `key`. The caller must hold the lock before calling this. */
  async uploadFile(key: string, data: ArrayBuffer, contentType = "application/octet-stream"): Promise<void> {
    if (!this.token) {
      this.onAuthFailure?.();
      throw new ApiError(401, "Not signed in.");
    }

    // Manually construct multipart/form-data body since requestUrl doesn't accept FormData.
    const boundary = `----SyncAgainBoundary${Date.now()}`;
    const enc = new TextEncoder();
    const keyPart = enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\n${key}\r\n`,
    );
    const fileHeader = enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${key}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    );
    const footer = enc.encode(`\r\n--${boundary}--\r\n`);
    const fileBytes = new Uint8Array(data);
    const body = new Uint8Array(keyPart.length + fileHeader.length + fileBytes.length + footer.length);
    body.set(keyPart, 0);
    body.set(fileHeader, keyPart.length);
    body.set(fileBytes, keyPart.length + fileHeader.length);
    body.set(footer, keyPart.length + fileHeader.length + fileBytes.length);

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
    if (res.status < 200 || res.status >= 300) {
      let msg = res.text;
      try { msg = (res.json as { error?: string }).error ?? msg; } catch { /* ignore */ }
      throw new ApiError(res.status, msg);
    }
  }

  /** Delete `key` on the server. The caller must hold the lock. */
  async deleteFile(key: string): Promise<void> {
    await this.request("DELETE", `/api/files?key=${encodeURIComponent(key)}`);
  }

  // ── Trash ─────────────────────────────────────────────────────────────────

  /**
   * Move `key` to the trash (`_delete/` prefix) on the server.
   * The caller must hold the lock on `key`. The server releases the lock.
   */
  async moveToTrash(key: string): Promise<void> {
    await this.request("POST", `/api/files/trash?key=${encodeURIComponent(key)}`);
  }

  /** List files currently in the trash. Returns entries with original-path keys. */
  async listTrash(): Promise<RemoteFileEntry[]> {
    const data = await this.request<{ files: RemoteFileEntry[] }>("GET", "/api/files/trash");
    return data.files;
  }

  /**
   * Restore `key` from the trash to its original path.
   * The caller must hold the lock on `key`. The server releases the lock.
   */
  async recoverFromTrash(key: string): Promise<void> {
    await this.request("POST", `/api/files/recover?key=${encodeURIComponent(key)}`);
  }

  /**
   * Permanently delete `key` from the trash (no recovery possible).
   * No lock is required.
   */
  async deleteFromTrash(key: string): Promise<void> {
    await this.request("DELETE", `/api/files/trash?key=${encodeURIComponent(key)}`);
  }

  /**
   * Permanently delete `key` from the server (no recovery).
   * Writes a `_deleted/` tombstone so other clients propagate the deletion.
   * The caller must hold the lock on `key`. The server releases the lock.
   */
  async permanentDeleteFile(key: string): Promise<void> {
    await this.request("DELETE", `/api/files/permanent?key=${encodeURIComponent(key)}`);
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
      JSON.stringify({ client_id: this.clientId, files: keys }),
      { "Content-Type": "application/json" },
    );
  }

  async releaseLocks(keys: string[]): Promise<void> {
    await this.request(
      "DELETE",
      "/api/locks",
      JSON.stringify({ client_id: this.clientId, files: keys }),
      { "Content-Type": "application/json" },
    );
  }

  async listLocks(): Promise<LockEntry[]> {
    const data = await this.request<{ locks: LockEntry[] }>("GET", "/api/locks");
    return data.locks;
  }

  // ── SSE event stream ─────────────────────────────────────────────────────

  /** Returns an authenticated URL for the SSE endpoint. */
  buildEventsUrl(): string | null {
    if (!this.token) return null;
    return `${this.serverUrl}/api/events?token=${encodeURIComponent(this.token)}`;
  }
}
