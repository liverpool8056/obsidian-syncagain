import { createHash } from "crypto";
import { Vault } from "obsidian";

import { ApiClient, ApiError } from "./api-client";
import { FileTracker } from "./file-tracker";
import { EMPTY_SYNC_STATE, LocalSyncState, RemoteFileEntry } from "./metadata";

const STATE_FILE = ".obsidian/plugins/obsidian-syncagain/sync-state.json";

function md5(data: ArrayBuffer): string {
  return createHash("md5").update(Buffer.from(data)).digest("hex");
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
export type DeletionStrategy = "permanent" | "non-permanent";

export class SyncManager {
  private state: LocalSyncState = EMPTY_SYNC_STATE;
  private syncing = false;
  private startupScanDone = false;

  /** Set by the plugin to receive sync status updates for the status bar. */
  onStatus?: (status: SyncStatus) => void;

  /**
   * Controls how local deletions are handled on the server.
   * - "non-permanent": file is moved to `_delete/` (recoverable via the Trash view).
   * - "permanent": file is deleted and a tombstone is written (not recoverable).
   * Defaults to "non-permanent". Updated by the plugin when settings change.
   */
  deletionStrategy: DeletionStrategy = "non-permanent";

  constructor(
    private readonly vault: Vault,
    private readonly api: ApiClient,
    private readonly tracker: FileTracker,
  ) {}

  // ── State persistence ────────────────────────────────────────────────────

  async loadState(): Promise<void> {
    try {
      const raw = await this.vault.adapter.read(STATE_FILE);
      const parsed = JSON.parse(raw) as Partial<LocalSyncState>;
      this.state = { ...EMPTY_SYNC_STATE, ...parsed };
    } catch {
      this.state = { ...EMPTY_SYNC_STATE };
    }
  }

  private async saveState(): Promise<void> {
    await this.vault.adapter.write(STATE_FILE, JSON.stringify(this.state));
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

  /**
   * Finalize a trash recovery: remove the key from `deletedFiles`, download
   * the file from its restored remote path, and persist updated state.
   * Called after the server has already moved `_delete/<key>` back to `<key>`.
   */
  async recoverKey(key: string): Promise<void> {
    this.state.deletedFiles = this.state.deletedFiles.filter((k) => k !== key);
    try {
      await this.downloadKey(key);
      await this.saveState();
    } catch (err) {
      console.error(`[SyncAgain] Failed to download recovered key '${key}':`, err);
      throw err;
    }
  }

  // ── Sync cycle ─────────────────────────────────────────────────────────────

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
    if (!this.startupScanDone) {
      this.detectOfflineChanges();
      this.startupScanDone = true;
    }

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

    // Step 3 & 4 — reconcile with remote.
    const remoteFiles = await this.api.listFiles();
    await this.reconcileRemote(remoteFiles);

    await this.saveState();
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  private async uploadLocalFile(path: string): Promise<void> {
    const file = this.vault.getFileByPath(path);
    if (!file) {
      // File was deleted locally — tombstone already handled in runSyncCycle; nothing to upload.
      return;
    }

    const data = await this.vault.readBinary(file);
    const hash = md5(data);

    // Skip if the remote already has this exact version.
    const known = this.state.files[path];
    if (known?.md5 === hash) return;

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
      await this.api.uploadFile(path, data);
      this.state.files[path] = { md5: hash, syncedAt: Date.now(), mtime: file.stat.mtime };
    } finally {
      // Server releases the lock on successful upload, but release explicitly
      // here in case of an upload error to avoid holding stale locks.
      try { await this.api.releaseLocks([path]); } catch { /* best-effort */ }
    }
  }

  /**
   * Handle a locally deleted file according to the current deletion strategy.
   *
   * - "non-permanent": acquires a lock, moves the file to `_delete/<path>` on the
   *   server (preserving it for recovery), and releases the lock. The `_delete/`
   *   entry acts as the deletion signal to other clients — no zero-byte tombstone
   *   is needed.
   * - "permanent": acquires a lock, calls the permanent-delete endpoint which
   *   removes the original and writes a `_deleted/<path>` zero-byte tombstone so
   *   other clients propagate the deletion. The lock is released by the server.
   *
   * Files that were never uploaded to the server are marked deleted locally
   * without any server call.
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
      if (this.deletionStrategy === "non-permanent") {
        await this.api.moveToTrash(path);
        // Server releases the lock on success.
      } else {
        await this.api.permanentDeleteFile(path);
        // Server releases the lock on success.
      }
    } finally {
      // Best-effort release in case of a server-side error.
      try { await this.api.releaseLocks([path]); } catch { /* ignore */ }
    }

    if (!this.state.deletedFiles.includes(path)) {
      this.state.deletedFiles.push(path);
    }
    delete this.state.files[path];
  }

  // ── Download / reconcile ──────────────────────────────────────────────────

  private async reconcileRemote(remoteFiles: RemoteFileEntry[]): Promise<void> {
    const tombstonePrefix = "_deleted/";
    const trashPrefix = "_delete/";

    // Build the set of keys that are currently in trash or have a tombstone on
    // the server. Used below to auto-revive locally-deleted entries whose
    // server-side deletion marker is gone (i.e. the file was recovered).
    const currentlyDeletedOnServer = new Set<string>();
    for (const remote of remoteFiles) {
      if (remote.key.startsWith(tombstonePrefix)) {
        currentlyDeletedOnServer.add(remote.key.slice(tombstonePrefix.length));
      } else if (remote.key.startsWith(trashPrefix)) {
        currentlyDeletedOnServer.add(remote.key.slice(trashPrefix.length));
      }
    }

    // Auto-revive: if a key was locally deleted but the server no longer has a
    // trash/tombstone entry for it (meaning it was recovered), remove it from
    // deletedFiles so the download loop can pick it up again.
    // Guard against clearing the list when the server returns nothing (transient
    // error) — only revive when we got a real response.
    if (remoteFiles.length > 0) {
      this.state.deletedFiles = this.state.deletedFiles.filter((k) =>
        currentlyDeletedOnServer.has(k),
      );
    }

    // Only files the user explicitly deleted on this device — used to prevent
    // re-downloading intentional local deletions.
    const deletedSet = new Set(this.state.deletedFiles);

    // Process deletion signals from other clients:
    //   _deleted/<key>  — permanent delete tombstone (zero-byte file)
    //   _delete/<key>   — non-permanent delete (file moved to trash by another client)
    // Both mean: delete the local copy.
    // We intentionally do NOT add these to state.deletedFiles so that if the file
    // is later restored on the server it will be picked up by the download loop.

    const processedAsTombstone = new Set<string>();
    for (const remote of remoteFiles) {
      let originalKey: string | null = null;
      if (remote.key.startsWith(tombstonePrefix)) {
        originalKey = remote.key.slice(tombstonePrefix.length);
      } else if (remote.key.startsWith(trashPrefix)) {
        originalKey = remote.key.slice(trashPrefix.length);
      }
      if (!originalKey) continue;
      if (processedAsTombstone.has(originalKey)) continue; // dedup within this cycle
      processedAsTombstone.add(originalKey);
      if (deletedSet.has(originalKey)) continue; // user already deleted this locally
      await this.deleteLocalFile(originalKey);
    }

    const remoteKeys = new Set(remoteFiles.map((f) => f.key));

    // Download files that are new or changed on the server, or missing locally.
    // Skip deletion-signal keys and files the user deleted on this client.
    for (const remote of remoteFiles) {
      if (remote.key.startsWith(tombstonePrefix)) continue;
      if (remote.key.startsWith(trashPrefix)) continue;
      if (deletedSet.has(remote.key)) continue;
      const known = this.state.files[remote.key];
      const existsLocally = Boolean(this.vault.getFileByPath(remote.key));
      if (known?.md5 === remote.md5 && existsLocally) continue; // already in sync
      await this.downloadKey(remote.key, remote);
    }

    // Remove local files that were deleted on the server (absent from remote list).
    // Skip entirely if the remote returned nothing but we have tracked files —
    // an empty list most likely means a transient error, not intentional deletion.
    const trackedKeys = Object.keys(this.state.files);
    if (remoteFiles.length > 0 || trackedKeys.length === 0) {
      for (const key of trackedKeys) {
        if (!remoteKeys.has(key) && !deletedSet.has(key)) {
          await this.deleteLocalFile(key);
        }
      }
    }
  }

  private async downloadKey(key: string, remote?: RemoteFileEntry): Promise<void> {
    const data = await this.api.downloadFile(key);
    const hash = md5(data);

    // Suppress the vault write event so FileTracker doesn't re-queue it.
    this.tracker.suppressNext(key);

    const existingFile = this.vault.getFileByPath(key);
    if (existingFile) {
      await this.vault.modifyBinary(existingFile, data);
    } else {
      await this.ensureFolder(key);
      await this.vault.createBinary(key, data);
    }

    const writtenFile = this.vault.getFileByPath(key);
    this.state.files[key] = {
      md5: remote?.md5 ?? hash,
      syncedAt: Date.now(),
      mtime: writtenFile?.stat.mtime ?? Date.now(),
    };
  }

  private async deleteLocalFile(key: string): Promise<void> {
    const file = this.vault.getFileByPath(key);
    if (file) {
      this.tracker.suppressNext(key);
      await this.vault.delete(file);
    }
    delete this.state.files[key];
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
