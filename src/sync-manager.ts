import { FileManager, Vault } from "obsidian";

import { ApiClient, ApiError } from "./api-client";
import { FileTracker } from "./file-tracker";
import { ConflictFile, EMPTY_SYNC_STATE, FileSyncEntry, LocalSyncState, RemoteFileEntry } from "./metadata";
import { VaultEncryption } from "./vault-encryption";

// Pure-JS MD5 (RFC 1321) — avoids the Node.js 'crypto' module.
function md5(buffer: ArrayBuffer): string {
  // Per-round shift amounts
  const S = [
    7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
    5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
    4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
    6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,
  ];
  // Pre-computed T[i] = floor(2^32 * |sin(i+1)|)
  const T = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  const bytes = new Uint8Array(buffer);
  const origLen = bytes.length;
  const padLen = ((origLen % 64) < 56 ? 56 : 120) - (origLen % 64);
  const padded = new Uint8Array(origLen + padLen + 8);
  padded.set(bytes);
  padded[origLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(origLen + padLen,     (origLen * 8) >>> 0,                   true);
  dv.setUint32(origLen + padLen + 4, Math.floor((origLen * 8) / 0x100000000), true);

  const add = (x: number, y: number) => (x + y) >>> 0;
  const rol = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

  let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;

  for (let i = 0; i < padded.length; i += 64) {
    const M: number[] = [];
    for (let j = 0; j < 16; j++) M.push(dv.getUint32(i + j * 4, true));

    let A = a, B = b, C = c, D = d;

    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if      (j < 16) { F = ((B & C) | ((~B >>> 0) & D)) >>> 0; g = j; }
      else if (j < 32) { F = ((D & B) | ((~D >>> 0) & C)) >>> 0; g = (5 * j + 1) % 16; }
      else if (j < 48) { F = (B ^ C ^ D) >>> 0;                  g = (3 * j + 5) % 16; }
      else              { F = (C ^ (B | (~D >>> 0))) >>> 0;        g = (7 * j) % 16; }
      const temp = add(add(add(A, F), M[g]), T[j]);
      A = D; D = C; C = B; B = add(B, rol(temp, S[j]));
    }

    a = add(a, A); b = add(b, B); c = add(c, C); d = add(d, D);
  }

  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a, true); out.setUint32(4, b, true);
  out.setUint32(8, c, true); out.setUint32(12, d, true);
  return Array.from(new Uint8Array(out.buffer)).map(v => v.toString(16).padStart(2, "0")).join("");
}

/**
 * Orchestrates bidirectional sync between the local vault and the server.
 *
 * Sync cycle:
 *   1. Drain locally dirty files → upload each (acquire lock → upload → server releases lock).
 *   2. Fetch remote file list → download files that are newer or absent locally.
 *   3. Detect remote deletions → remove local copies.
 *   4. Persist local sync state.
 */
export type SyncStatus = "syncing" | "idle" | "error";

export class SyncManager {
  private state: LocalSyncState = EMPTY_SYNC_STATE;
  private syncing = false;
  private startupScanDone = false;
  /** True when no sync-state.json was found on load — signals a fresh device. */
  private isNewDevice = false;
  private encryption: VaultEncryption | null;

  /** Set by the plugin to receive sync status updates for the status bar. */
  onStatus?: (status: SyncStatus) => void;

  /**
   * Set by the plugin to handle first-sync conflicts.
   * Receives the list of conflicting files and returns the set of paths the
   * user chose to keep local. Paths absent from the set keep the remote version.
   */
  onFirstSyncConflict?: (conflicts: ConflictFile[]) => Promise<Set<string>>;

  /**
   * Set by the plugin to react when the server returns 402 for a paid feature.
   * Called at most once per feature per session — subsequent uploads of that
   * feature are silently dropped until the plugin re-enables E2EE.
   */
  onFeatureNotEnabled?: (feature: string) => void;

  /** Tracks which features have already triggered the one-shot notice. */
  private featureErrorNotified = new Set<string>();

  constructor(
    private readonly vault: Vault,
    private readonly fileManager: FileManager,
    private readonly api: ApiClient,
    private readonly tracker: FileTracker,
    encryption: VaultEncryption | null = null,
  ) {
    this.encryption = encryption;
  }

  /** Replace the active encryption instance (called when E2EE settings change). */
  setEncryption(enc: VaultEncryption | null): void {
    this.encryption = enc;
  }

  private get stateFile(): string {
    return `${this.vault.configDir}/plugins/obsidian-syncagain/sync-state.json`;
  }

  // ── State persistence ────────────────────────────────────────────────────

  async loadState(): Promise<void> {
    try {
      const raw = await this.vault.adapter.read(this.stateFile);
      const parsed = JSON.parse(raw) as Partial<LocalSyncState>;
      this.state = { ...EMPTY_SYNC_STATE, ...parsed };
    } catch {
      this.state = { ...EMPTY_SYNC_STATE };
      this.isNewDevice = true;
    }
  }

  private async saveState(): Promise<void> {
    await this.vault.adapter.write(this.stateFile, JSON.stringify(this.state));
  }

  /**
   * Clear all synced-file state and mark every vault file dirty for re-upload.
   * Called when the E2EE setting changes so all files are re-uploaded with the
   * new encryption mode (or without encryption if it was disabled).
   */
  async resetSyncState(): Promise<void> {
    this.state = { ...EMPTY_SYNC_STATE };
    for (const file of this.vault.getFiles()) {
      if (!this.isExcluded(file.path)) {
        this.tracker.markDirtyByPath(file.path);
      }
    }
    await this.saveState();
  }

  /**
   * Clear tombstones for paths that exist on disk again.
   *
   * deletedFiles prevents reconcileRemote from re-downloading files the user
   * deleted locally, but it has no natural expiry. If the user re-creates a
   * file at a tombstoned path, every sync step would filter it out forever.
   */
  private reconcileTombstones(): void {
    if (this.state.deletedFiles.length === 0) return;
    this.state.deletedFiles = this.state.deletedFiles.filter(
      (path) => !this.vault.getFileByPath(path),
    );
  }

  // ── Main sync entry point ─────────────────────────────────────────────────

  async sync(): Promise<void> {
    if (this.syncing) return; // prevent overlapping cycles
    this.syncing = true;
    this.onStatus?.("syncing");
    try {
      await this.runSyncCycle();
      this.onStatus?.("idle");
    } catch (err) {
      console.error("[SyncAgain] Sync error:", err);
      this.onStatus?.("error");
    } finally {
      this.syncing = false;
    }
  }

  /** Trigger a targeted download for a specific key (from SSE events). */
  async syncKey(key: string): Promise<void> {
    try {
      await this.downloadKey(key);
      await this.saveState();
    } catch (err) {
      console.error(`[SyncAgain] Failed to sync key '${key}':`, err);
    }
  }

  // ── Sync cycle ─────────────────────────────────────────────────────────────

  /**
   * First-sync flow for a new device joining an account that already has files.
   *
   * Compares every local file against the remote list:
   * - Same content MD5  → pre-populate state; no transfer needed.
   * - Different content → collect as conflict; prompt user to keep local or remote.
   * - Local only        → mark dirty; uploadLocalFile will push it.
   * - Remote only       → left for reconcileRemote to download.
   *
   * When E2EE is enabled, `remote.plaintext_md5` (stored by the uploading client)
   * is used for comparison so the new device can match local plaintext against
   * the server-stored plaintext MD5 without downloading any ciphertext.
   * If `plaintext_md5` is absent (legacy unencrypted file), falls back to `remote.md5`.
   */
  private async runFirstSyncFlow(remoteFiles: RemoteFileEntry[]): Promise<void> {
    const remoteMap = new Map(remoteFiles.map((f) => [f.key, f]));

    const conflicts: ConflictFile[] = [];

    for (const file of this.vault.getFiles()) {
      if (this.isExcluded(file.path)) continue;
      const remote = remoteMap.get(file.path);
      if (!remote) {
        this.tracker.markDirtyByPath(file.path);
        continue;
      }

      const data = await this.vault.readBinary(file);
      const localMd5 = md5(data);
      const remoteContentMd5 = remote.plaintext_md5 ?? remote.md5;

      if (localMd5 === remoteContentMd5) {
        this.state.files[file.path] = {
          md5: remote.md5,
          syncedAt: Date.now(),
          mtime: file.stat.mtime,
          ...(remote.plaintext_md5 ? { plaintextMd5: localMd5 } : {}),
        };
      } else {
        conflicts.push({
          path: file.path,
          localMtime: file.stat.mtime,
          remoteMtime: remote.last_modified,
        });
      }
    }

    if (conflicts.length === 0) return;

    const keepLocalPaths = this.onFirstSyncConflict
      ? await this.onFirstSyncConflict(conflicts)
      : new Set<string>(); // default: keep remote

    for (const conflict of conflicts) {
      if (keepLocalPaths.has(conflict.path)) {
        this.tracker.markDirtyByPath(conflict.path);
      }
      // keep remote: reconcileRemote will download and overwrite the local file
    }
  }

  /**
   * On the first sync cycle, scan all vault files to detect changes that
   * occurred while the plugin was offline (no vault events were fired).
   *
   * - Files with a newer mtime than stored → mark dirty (upload candidate).
   *   MD5 is checked at upload time, so unchanged content is still skipped.
   * - Files absent from disk but present in state → mark deleted (offline deletion).
   * - Files present on disk but absent from state → mark dirty (new local files).
   *
   * mtime is used only as a cheap pre-filter; MD5 remains the authoritative
   * change detector and prevents unnecessary uploads.
   */
  private detectOfflineChanges(): void {
    for (const file of this.vault.getFiles()) {
      if (this.isExcluded(file.path)) continue;
      if (this.state.deletedFiles.includes(file.path)) continue;
      const known = this.state.files[file.path];
      if (!known || file.stat.mtime > (known.mtime ?? 0)) {
        this.tracker.markDirtyByPath(file.path);
      }
    }
    for (const key of Object.keys(this.state.files)) {
      if (!this.vault.getFileByPath(key) && !this.state.deletedFiles.includes(key)) {
        this.tracker.markDeletedByPath(key);
      }
    }
  }

  private async runSyncCycle(): Promise<void> {
    this.reconcileTombstones();

    if (!this.startupScanDone) {
      if (this.isNewDevice) {
        const remoteFiles = await this.api.listFiles();
        if (remoteFiles.length > 0) {
          await this.runFirstSyncFlow(remoteFiles);
        } else {
          this.detectOfflineChanges();
        }
      } else {
        this.detectOfflineChanges();
      }
      this.startupScanDone = true;
    }

    // Snapshot of the remote file set taken before any uploads.
    // Used below to detect files deleted by another client while this device
    // was offline, so we don't blindly re-upload them.
    const remoteSnapshot = await this.api.listFiles();
    const remoteSnapshotKeys = new Set(remoteSnapshot.map((f) => f.key));

    // Step 1 — handle locally deleted files.
    const deletedPaths = this.tracker.drainPendingDeletions();
    for (const path of deletedPaths) {
      try {
        await this.handleDeletion(path);
      } catch (err) {
        console.error(`[SyncAgain] Failed to handle deletion for '${path}':`, err);
        this.tracker.markDeletedByPath(path); // re-queue for next cycle
      }
    }

    // Step 2 — upload local changes.
    const dirty = this.tracker.drainDirtyFiles();
    const failedPaths: string[] = [];

    for (const tracked of dirty) {
      // Skip if user deleted this file before the upload ran.
      if (this.state.deletedFiles.includes(tracked.path)) continue;
      // "Remote deletion wins" — but only when the remote snapshot is non-empty.
      // An empty snapshot is most likely a transient error; reconcileRemote treats
      // it that way too, and the two must agree or dirty entries get silently lost.
      if (
        remoteSnapshot.length > 0
        && this.state.files[tracked.path]
        && !remoteSnapshotKeys.has(tracked.path)
      ) continue;
      try {
        await this.uploadLocalFile(tracked.path);
      } catch (err) {
        console.error(`[SyncAgain] Upload failed for '${tracked.path}':`, err);
        failedPaths.push(tracked.path);
      }
    }

    // Re-queue failed uploads so they're retried next cycle.
    for (const path of failedPaths) {
      this.tracker.markDirtyByPath(path);
    }

    // Fresh fetch after uploads so reconcileRemote sees our own changes.
    const remoteFiles = await this.api.listFiles();
    try {
      await this.reconcileRemote(remoteFiles);
    } catch (err) {
      console.error("[SyncAgain] reconcileRemote failed:", err);
    }

    // Step 6 — upload local files absent on server.
    try {
      await this.uploadAbsentFiles(remoteFiles);
    } catch (err) {
      console.error("[SyncAgain] uploadAbsentFiles failed:", err);
    }

    await this.saveState();
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  private async uploadLocalFile(path: string): Promise<void> {
    const file = this.vault.getFileByPath(path);
    if (!file) {
      // File was deleted locally — tombstone already handled in runSyncCycle; nothing to upload.
      return;
    }

    const plainData = await this.vault.readBinary(file);
    const plaintextHash = md5(plainData);

    // Skip if content is unchanged since last sync.
    // When E2EE is on, compare against plaintextMd5 (since ciphertext changes each upload).
    // When E2EE is off, md5 == plaintextMd5, so the fallback to md5 is correct in both cases.
    const known = this.state.files[path];
    if ((known?.plaintextMd5 ?? known?.md5) === plaintextHash) return;

    // Acquire lock — abort if held by another client.
    try {
      await this.api.acquireLocks([path]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        console.warn(`[SyncAgain] '${path}' is locked by another client — skipping upload.`);
        this.tracker.markDirtyByPath(path);
        return;
      }
      throw err;
    }

    try {
      let uploadData: ArrayBuffer;
      let plaintextMd5: string | undefined;

      if (this.encryption) {
        uploadData = await this.encryption.encrypt(plainData);
        plaintextMd5 = plaintextHash;
      } else {
        uploadData = plainData;
      }

      const ciphertextHash = this.encryption ? md5(uploadData) : plaintextHash;

      try {
        await this.api.uploadFile(path, uploadData, plaintextMd5);
      } catch (uploadErr) {
        // 402 Payment Required — a paid feature (e.g. E2EE) is not enabled for
        // this account. Fire the one-shot callback, disable encryption for the
        // remainder of this session, and re-queue the file for a plain upload.
        if (uploadErr instanceof ApiError && uploadErr.status === 402) {
          const feature = uploadErr.feature ?? "unknown";
          if (!this.featureErrorNotified.has(feature)) {
            this.featureErrorNotified.add(feature);
            this.onFeatureNotEnabled?.(feature);
          }
          if (feature === "e2ee") {
            this.encryption = null;
          }
          this.tracker.markDirtyByPath(path);
          return;
        }
        throw uploadErr;
      }

      const entry: FileSyncEntry = { md5: ciphertextHash, syncedAt: Date.now(), mtime: file.stat.mtime };
      if (plaintextMd5 !== undefined) entry.plaintextMd5 = plaintextMd5;
      this.state.files[path] = entry;
    } finally {
      // Server releases the lock on successful upload, but release explicitly
      // here in case of an upload error to avoid holding stale locks.
      try { await this.api.releaseLocks([path]); } catch { /* best-effort */ }
    }
  }

  /**
   * Handle a locally deleted file.
   *
   * Acquires a lock, deletes the file from the server, and releases the lock.
   * Other clients detect the deletion via absence on the next reconcile cycle.
   * Files that were never uploaded are marked deleted locally without a server call.
   */
  private async handleDeletion(path: string): Promise<void> {
    // If the file was never uploaded, just mark it deleted locally.
    if (!this.state.files[path]) {
      if (!this.state.deletedFiles.includes(path)) {
        this.state.deletedFiles.push(path);
      }
      return;
    }

    try {
      await this.api.acquireLocks([path]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        console.warn(`[SyncAgain] '${path}' is locked — re-queuing deletion.`);
        this.tracker.markDeletedByPath(path);
        return;
      }
      throw err;
    }

    try {
      await this.api.deleteFile(path);
    } finally {
      try { await this.api.releaseLocks([path]); } catch { /* ignore */ }
    }

    if (!this.state.deletedFiles.includes(path)) {
      this.state.deletedFiles.push(path);
    }
    delete this.state.files[path];
  }

  // ── Download / reconcile ──────────────────────────────────────────────────

  private async reconcileRemote(remoteFiles: RemoteFileEntry[]): Promise<void> {
    // Files the user intentionally deleted on this device — skip re-downloading.
    const deletedSet = new Set(this.state.deletedFiles);
    const remoteKeys = new Set(remoteFiles.map((f) => f.key));

    // Download files that are new or changed on the server, or missing locally.
    for (const remote of remoteFiles) {
      if (deletedSet.has(remote.key)) continue;
      const known = this.state.files[remote.key];
      const existsLocally = Boolean(this.vault.getFileByPath(remote.key));
      if (known?.md5 === remote.md5 && existsLocally) continue;
      // Skip files that are already queued for upload — they will overwrite the server
      // version on the next cycle. Downloading now would replace the local copy and
      // stall the upload (the dedup check would see no change after the download).
      if (this.tracker.hasPendingUpload(remote.key)) continue;
      try {
        await this.downloadKey(remote.key, remote);
      } catch (err) {
        console.error(`[SyncAgain] Failed to download '${remote.key}':`, err);
      }
    }

    // Remove local files that were deleted on the server (absent from remote list).
    // Skip entirely if the remote returned nothing but we have tracked files —
    // an empty list most likely means a transient error, not intentional deletion.
    const trackedKeys = Object.keys(this.state.files);
    if (remoteFiles.length > 0 || trackedKeys.length === 0) {
      for (const key of trackedKeys) {
        if (!remoteKeys.has(key) && !deletedSet.has(key)) {
          try {
            await this.deleteLocalFile(key);
          } catch (err) {
            console.error(`[SyncAgain] Failed to delete local '${key}':`, err);
          }
        }
      }
    }
  }

  // ── Upload absent files ────────────────────────────────────────────────────

  /**
   * Upload vault files that exist locally but have no corresponding entry on
   * the server. This is a safety net for files that slipped through dirty
   * tracking (e.g. created while sync was disabled) and a "flush" step run
   * before sync is disabled.
   */
  private async uploadAbsentFiles(remoteFiles: RemoteFileEntry[]): Promise<void> {
    const remoteKeySet = new Set(remoteFiles.map((f) => f.key));
    const deletedSet = new Set(this.state.deletedFiles);
    for (const file of this.vault.getFiles()) {
      if (this.isExcluded(file.path)) continue;
      if (deletedSet.has(file.path)) continue;
      if (remoteKeySet.has(file.path)) continue;
      // File is absent on the server — any state.files entry is stale bookkeeping
      // and would cause uploadLocalFile's dedup to skip the re-upload.
      delete this.state.files[file.path];
      try {
        await this.uploadLocalFile(file.path);
      } catch (err) {
        console.error(`[SyncAgain] Failed to upload absent file '${file.path}':`, err);
      }
    }
  }

  private async downloadKey(key: string, remote?: RemoteFileEntry): Promise<void> {
    const rawData = await this.api.downloadFile(key);

    // Determine if the downloaded bytes are encrypted:
    // - `remote.plaintext_md5` present → server recorded this as an E2EE upload.
    // - No remote entry (SSE-triggered path) → infer from whether E2EE is active.
    const isEncrypted = remote ? Boolean(remote.plaintext_md5) : Boolean(this.encryption);

    let plainData: ArrayBuffer;
    if (isEncrypted && this.encryption) {
      try {
        plainData = await this.encryption.decrypt(rawData);
      } catch {
        // GCM auth failure — file is not valid ciphertext (e.g. uploaded before E2EE
        // was toggled on). Use raw bytes; the upload loop will re-encrypt and overwrite.
        plainData = rawData;
      }
    } else {
      plainData = rawData;
    }

    // Suppress the vault write event so FileTracker doesn't re-queue it.
    this.tracker.suppressNext(key);

    const existingFile = this.vault.getFileByPath(key);
    if (existingFile) {
      await this.vault.modifyBinary(existingFile, plainData);
    } else {
      await this.ensureFolder(key);
      await this.vault.createBinary(key, plainData);
    }

    const writtenFile = this.vault.getFileByPath(key);
    const ciphertextMd5 = remote?.md5 ?? md5(rawData);
    const plaintextMd5 = isEncrypted ? md5(plainData) : undefined;

    const entry: FileSyncEntry = {
      md5: ciphertextMd5,
      syncedAt: Date.now(),
      mtime: writtenFile?.stat.mtime ?? Date.now(),
    };
    if (plaintextMd5 !== undefined) entry.plaintextMd5 = plaintextMd5;
    this.state.files[key] = entry;
  }

  private async deleteLocalFile(key: string): Promise<void> {
    const file = this.vault.getFileByPath(key);
    if (file) {
      this.tracker.suppressNext(key);
      await this.fileManager.trashFile(file);
    }
    delete this.state.files[key];
  }

  /** Returns true for paths that should never be synced (Obsidian's local trash folder). */
  private isExcluded(path: string): boolean {
    return path.startsWith(".trash/");
  }

  private async ensureFolder(filePath: string): Promise<void> {
    const parts = filePath.split("/");
    parts.pop(); // remove filename
    if (parts.length === 0) return;
    const folder = parts.join("/");
    if (!this.vault.getFolderByPath(folder)) {
      await this.vault.createFolder(folder);
    }
  }
}
