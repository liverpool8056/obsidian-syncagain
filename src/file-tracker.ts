import { TFile, TAbstractFile } from "obsidian";

export interface TrackedFile {
  path: string;
  modifiedAt: number;
}

/**
 * Tracks vault files that have been created or modified since the last sync.
 * Uses a Map keyed by vault-relative path so that rapid re-saves of the same
 * file only produce one upload entry (last-write-wins on timestamp).
 */
export class FileTracker {
  private dirtyFiles: Map<string, TrackedFile> = new Map();
  private pendingDeletions: Set<string> = new Set();
  /** Paths that should be ignored on the next markDirty or handleDelete call (used for plugin-initiated writes/deletes). */
  private suppressOnce: Set<string> = new Set();

  /**
   * Suppress the next markDirty event for a path.
   * Call this before writing a downloaded file to the vault so the write
   * event doesn't re-queue the file as a local change.
   */
  suppressNext(path: string): void {
    this.suppressOnce.add(path);
  }

  markDirty(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    if (file.path.startsWith(".trash/")) return;
    if (this.suppressOnce.delete(file.path)) return;
    this.dirtyFiles.set(file.path, {
      path: file.path,
      modifiedAt: Date.now(),
    });
  }

  markDirtyByPath(path: string): void {
    if (path.startsWith(".trash/")) return;
    this.dirtyFiles.set(path, { path, modifiedAt: Date.now() });
  }

  handleRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile)) return;
    this.dirtyFiles.delete(oldPath);
    this.markDirty(file);
  }

  handleDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    this.dirtyFiles.delete(file.path);
    if (this.suppressOnce.delete(file.path)) return; // plugin-initiated delete, not a user action
    this.pendingDeletions.add(file.path);
  }

  /**
   * Atomically drains the dirty set and returns its contents.
   * Clears before the async upload so new modifications during upload
   * are captured in the next cycle rather than lost.
   */
  drainDirtyFiles(): TrackedFile[] {
    const snapshot = Array.from(this.dirtyFiles.values());
    this.dirtyFiles.clear();
    return snapshot;
  }

  /** Atomically drains and returns all paths the user has deleted locally. */
  drainPendingDeletions(): string[] {
    const snapshot = Array.from(this.pendingDeletions);
    this.pendingDeletions.clear();
    return snapshot;
  }

  markDeletedByPath(path: string): void {
    this.pendingDeletions.add(path);
  }

  /** Returns true if the path is currently queued for upload. */
  hasPendingUpload(path: string): boolean {
    return this.dirtyFiles.has(path);
  }

  get pendingCount(): number {
    return this.dirtyFiles.size;
  }
}
