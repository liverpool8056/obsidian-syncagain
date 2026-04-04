/** A file that exists on both sides with different content, requiring user resolution. */
export interface ConflictFile {
  path: string;
  localMtime: number;   // ms timestamp
  remoteMtime: string;  // ISO-8601 from RemoteFileEntry.last_modified
}

/** Remote file entry returned by GET /api/files */
export interface RemoteFileEntry {
  key: string;
  size: number;
  md5: string;
  last_modified: string; // ISO-8601
  /**
   * Plaintext MD5 — set by the uploading client when E2EE is enabled.
   * Absent for files uploaded without encryption.
   * Enables new-device first-sync to compare local content without downloading ciphertext.
   */
  plaintext_md5?: string;
}

/** Per-file metadata stored in LocalSyncState. */
export interface FileSyncEntry {
  /** Ciphertext MD5. Matches the server's ETag. When E2EE is off, equals the plaintext MD5. */
  md5: string;
  syncedAt: number;
  mtime?: number;
  /**
   * Plaintext MD5 — only stored when E2EE is enabled.
   * Used for local upload dedup in place of `md5` so that re-encrypting the same content
   * (which produces different ciphertext each time) doesn't trigger spurious re-uploads.
   */
  plaintextMd5?: string;
}

/** Local sync state persisted between sessions */
export interface LocalSyncState {
  version: 1;
  /** key → metadata of the last successfully synced version */
  files: Record<string, FileSyncEntry>;
  /**
   * Keys that were intentionally deleted locally.
   * Prevents reconcileRemote from re-downloading them.
   */
  deletedFiles: string[];
}

export const EMPTY_SYNC_STATE: LocalSyncState = {
  version: 1,
  files: {},
  deletedFiles: [],
};
