# obsidian-syncagain

An Obsidian plugin for bidirectional vault synchronization via a sync server. Multiple devices can sync simultaneously; changes made on one device appear on others in near real time through an SSE push channel.

## Features

- **Bidirectional sync** — upload local changes, download remote changes, propagate deletions
- **Multiple simultaneous clients** — SSE-based push notifications trigger immediate sync when another client modifies a file
- **Conflict serialization** — file locks prevent two clients uploading the same file at the same time
- **Content-based diffing** — MD5 comparison avoids redundant transfers
- **Per-user accounts** — individual email/password accounts with JWT authentication
- **Trash & recovery** — non-permanent deletions are recoverable; permanent deletion option also available
- **Safe first-sync for new devices** — when a new device joins an account that already has files, conflicting files are surfaced in a resolution modal rather than silently overwritten

## How it works

```text
Obsidian vault
      │
  FileTracker          (watches vault events, queues dirty files)
      │
  SyncManager          (runs on interval or on SSE event)
      │
  ├── upload dirty files
  │     ├── acquire lock  → 409? re-queue and retry next cycle
  │     ├── upload to server
  │     └── release lock
  │
  ├── download newer remote files
  │
  └── delete locally any files removed on server
```

A persistent SSE connection (`EventListener`) receives push events from the server. When another client uploads a file, the plugin triggers an immediate sync instead of waiting for the next interval.

## Installation

### Community plugin directory

1. In Obsidian, open **Settings → Community Plugins** and disable Safe Mode if prompted.
2. Click **Browse**, search for **SyncAgain**, and click **Install**.
3. Click **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, and `versions.json` from the [latest release](https://github.com/liverpool8056/obsidian-syncagain/releases/latest).
2. Copy them to:

   ```text
   <your-vault>/.obsidian/plugins/obsidian-syncagain/
   ```

3. In Obsidian → Settings → Community Plugins, enable **SyncAgain**.

## Configuration

Open Settings → SyncAgain:

| Setting | Description |
| --- | --- |
| **Server URL** | Base URL of your sync server, e.g. `http://192.168.1.10:8080` |
| **Account** | Sign up (opens browser) or sign in inline with email + password |
| **Sync interval** | How often (in minutes) to run a full sync cycle (default: 5) |
| **Enable sync** | Toggle to pause sync without changing other settings |
| **Deletion strategy** | Controlled by Obsidian's own trash setting (system trash or `.trash` folder) |

The plugin auto-generates a unique **Client ID** (UUID) per device, shown in settings for debugging.

### Account management

- **Create account** — opens your browser to the server's registration page; on completion the server redirects back to Obsidian with a JWT.
- **Sign in** — enter email and password directly in the settings tab.
- **Sign out** — clears the stored token and stops sync.

A signed-in user's email is shown in the settings tab. Token expiry (30 days by default) shows a notice asking you to sign in again.

### Deletion behaviour

When you delete a file in Obsidian, the plugin deletes it from the remote server so other devices propagate the deletion on their next sync cycle. Where the file ends up locally is determined by Obsidian's own **Files & Links → Deleted files** setting:

| Obsidian setting | Local behaviour |
| --- | --- |
| **Move to system trash** | File goes to the OS trash (recoverable via the OS) |
| **Move to .trash folder** | File goes to `.trash/` inside the vault (recoverable manually) |
| **Permanently delete** | File is removed immediately (no recovery) |

The `.trash/` folder is excluded from sync and is never uploaded to the server.

## Sync behaviour

### First sync on a new device

When the plugin starts on a device with no prior sync state, it checks whether the remote already has files:

- **Remote is empty** — the device is the first to join the account. All local files are uploaded unconditionally.
- **Remote has files** — the device is joining an existing account. Local files are compared against the remote by MD5:
  - **Same content** — no transfer; local state is seeded from remote.
  - **Local only** — file is uploaded to the server.
  - **Remote only** — file is downloaded to the vault.
  - **Different content (conflict)** — a resolution modal is shown listing all conflicting files with their local and remote modification times. The user chooses **Keep local** (upload local version) or **Keep remote** (download remote version) for all conflicts at once. If the modal is dismissed without choosing, a confirmation prompt explains that remote is the authoritative source and defaults to keeping the remote version.

### Upload

1. The vault watcher fires on file create, modify, rename, or delete.
2. The `FileTracker` queues the file as dirty (last-write-wins per path within a cycle).
3. On the next sync tick, the manager drains the queue and attempts upload:
   - Acquires a server-side lock on the file.
   - If the lock is held by another client (`409`), the file is re-queued for the next cycle.
   - Uploads the file; the server stores it in S3 and broadcasts a `file_changed` event.
   - Releases the lock.

### Download

After uploading, the manager fetches the full remote file list and compares MD5 hashes with the local sync state. Files that are newer on the server are downloaded and written to the vault. Downloads are suppressed from re-triggering uploads.

### Deletions

Files present in the last local sync state but absent from the current remote list are deleted from the vault locally.

### Reconnect after being offline

When a device that already has a sync state reconnects, it performs a startup scan before the first upload cycle:

- **Files modified while offline** — marked dirty; will be uploaded unless a remote deletion is detected (see below).
- **Files created while offline** (not in sync state) — uploaded unconditionally.
- **Files deleted locally while offline** — deletion is propagated to the server.

**Remote deletion takes priority over local edits.** If another client deleted a file on the server while this device was offline, the offline device will *not* re-upload it even if it was modified locally — the remote deletion wins. `reconcileRemote` then removes the local copy. Any unsaved local changes to that file are lost. Recovery is the user's responsibility (OS trash or Obsidian's `.trash/` folder depending on the deletion settings).

This behaviour is intentional: the server is the authoritative source, and recovery is delegated to the OS/Obsidian trash mechanism rather than maintained server-side.

### Real-time push

The SSE connection receives events from the server. On `file_changed` or `file_deleted` events from *other* clients, the plugin triggers an immediate sync cycle rather than waiting for the interval.

## Development

### Prerequisites

- Node.js 16+
- An instance of [obsidian-sync-server](../obsidian-sync-server) running locally

### Setup

```bash
cd obsidian_syncagain
npm install
```

### Build

```bash
# Development (watch mode with source maps)
npm run dev

# Production (type-checked + minified)
npm run build
```

Output: `main.js` in the project root.

### Install to vault for testing

```bash
mkdir -p /path/to/vault/.obsidian/plugins/obsidian-syncagain
cp main.js manifest.json versions.json /path/to/vault/.obsidian/plugins/obsidian-syncagain/
```

Then reload Obsidian or use the "Reload plugin" action.

## Source layout

```text
src/
├── main.ts              # Plugin entry point — lifecycle, event wiring, auth callback handler
├── settings.ts          # Settings interface, SettingTab UI, account management, trash view
├── file-tracker.ts      # Tracks dirty files between sync cycles (last-write-wins per path)
├── sync-manager.ts      # Orchestrates upload / download / reconcile
├── api-client.ts        # Typed HTTP client with JWT auth, file/lock/trash/SSE APIs
├── event-listener.ts    # SSE connection manager with exponential-backoff reconnect
├── first-sync-modal.ts  # Conflict resolution modal shown on first sync of a new device
└── metadata.ts          # Type definitions (RemoteFileEntry, LocalSyncState, ConflictFile, SyncEvent)
```

## Known limitations

- **Locks serialize uploads, not edits.** The implementation for the plugin is based on an assumption that files are not modified simultanously from clients. If two clients edit the same file between sync intervals, the second to upload will overwrite the first. The system prevents simultaneous uploads but does not detect or merge divergent edits.
- **No rename tracking on server.** A renamed file is treated as a delete + create, which may briefly trigger a deletion on other clients before the new file arrives.
- **In-memory locks.** The server holds locks in memory. A server restart clears all locks; clients re-acquire on their next sync cycle.

## Requirements

- Obsidian 1.4.0+
- A running [obsidian-sync-server](../obsidian-sync-server) instance with S3-compatible storage

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
