/** Remote file entry returned by GET /api/files */
export interface RemoteFileEntry {
  key: string;
  size: number;
  md5: string;
  last_modified: string; // ISO-8601
}

/** Local sync state persisted between sessions */
export interface LocalSyncState {
  version: 1;
  /** key → metadata of the last successfully synced version */
  files: Record<string, { md5: string; syncedAt: number; mtime?: number }>;
  /**
   * Keys that were intentionally deleted locally.
   * Prevents reconcileRemote from re-downloading them.
   * A tombstone is also uploaded to `_deleted/<key>` on the server so other
   * clients can propagate the deletion.
   */
  deletedFiles: string[];
}

export const EMPTY_SYNC_STATE: LocalSyncState = {
  version: 1,
  files: {},
  deletedFiles: [],
};
