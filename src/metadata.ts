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
  /** HMAC-SHA256(DEK, plaintext) — set by the uploading client when E2EE is enabled. */
  content_hmac?: string;
  /** Whether the file content on the server is currently encrypted. */
  is_encrypted?: boolean;
}

/** Per-file metadata stored in LocalSyncState. */
export interface FileSyncEntry {
  /** Ciphertext MD5. Matches the server's ETag. When E2EE is off, equals the plaintext MD5. */
  md5: string;
  syncedAt: number;
  mtime?: number;
  /**
   * HMAC-SHA256(DEK, plaintext) — only stored when E2EE is enabled.
   * Used for local upload dedup in place of `md5` so that re-encrypting the same content
   * (which produces different ciphertext each time) doesn't trigger spurious re-uploads.
   */
  contentHmac?: string;
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
