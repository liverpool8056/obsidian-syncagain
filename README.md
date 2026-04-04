# obsidian-syncagain

An Obsidian plugin for bidirectional vault synchronization via a sync server. Multiple devices can sync simultaneously; changes made on one device appear on others in near real time through a persistent WebSocket control channel.

## Features

- **Bidirectional sync** — upload local changes, download remote changes, propagate deletions
- **Multiple simultaneous clients** — WebSocket push notifications trigger immediate sync when another client modifies a file
- **Multiple vaults per account** — each vault gets a stable UUID; a single account can sync independent vaults without any key collisions
- **End-to-end encryption** — optional AES-256-GCM encryption; the server only ever stores ciphertext; the passphrase never leaves the device
- **Conflict serialization** — file locks prevent two clients uploading the same file at the same time
- **Content-based diffing** — MD5 comparison avoids redundant transfers
- **Per-user accounts** — email/password accounts for cross-device sync, or anonymous accounts (no registration) for single-device use
- **Safe first-sync for new devices** — when a new device joins an account that already has files, conflicting files are surfaced in a resolution modal rather than silently overwritten

## How it works

```text
Obsidian vault
      │
  FileTracker          (watches vault events, queues dirty files)
      │
  SyncManager          (runs on interval or on WebSocket push event)
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

A persistent WebSocket control channel receives push events from the server. When another client uploads a file, the plugin triggers an immediate sync instead of waiting for the next interval.

## Installation

### Community plugin directory

1. In Obsidian, open **Settings → Community Plugins** and disable Safe Mode if prompted.
2. Click **Browse**, search for **SyncAgain**, and click **Install**.
3. Click **Enable**.

### Manual installation

1. Download `main.js`, `manifest.json`, `versions.json`, and `styles.css` from the [latest release](https://github.com/liverpool8056/obsidian-syncagain/releases/latest).
2. Copy them to:

   ```text
   <your-vault>/.obsidian/plugins/obsidian-syncagain/
   ```

3. In Obsidian → Settings → Community Plugins, enable **SyncAgain**.

## Configuration

Open Settings → SyncAgain:

| Setting | Description |
| --- | --- |
| **Server** | Base URL of your sync server, e.g. `http://192.168.1.10:8080` |
| **Account** | Sign up with email/password (opens browser), sign in inline with email + password, or use an anonymous account (no registration — single-device only) |
| **Enable sync** | Toggle to pause sync without changing other settings |
| **Sync interval** | How often (in minutes) to run a full sync cycle (default: 5) |
| **Deletion strategy** | Controlled by Obsidian's own trash setting (system trash or `.trash` folder) |
| **Enable encryption** | Encrypt all files with AES-256-GCM before uploading. Toggling re-uploads all files. |
| **Passphrase** | Derivation passphrase for the encryption key. Never sent to the server. Changing it re-uploads all files with the new key. |

### Connection status

The **Server** field in settings shows a badge reflecting the live state of the connection to the server:

| Badge | Meaning |
| --- | --- |
| **Connecting…** | WebSocket handshake in progress (or reconnecting after a drop) |
| **Connected** | WebSocket is open and the server is responding to pings |
| **Disconnected** | No active connection (server unreachable, URL empty, or plugin stopped) |

The connection is established as soon as a valid server URL is entered — **no sign-in is required**. This means you can confirm the server is reachable before creating an account. Once signed in, the same connection carries authentication and delivers real-time push events and server config; without a token it only reflects server reachability.

When you edit the server URL, the current connection is torn down immediately and a new attempt is made one second after you stop typing, so transient partial URLs never trigger spurious connection attempts.

### Account management

Two account types are supported:

- **Email account** — full account with email + password. Supports cross-device sync — multiple devices share the same identity by signing in with the same credentials.
  - **Create account** — opens your browser to the server's registration page; on completion the server redirects back to Obsidian with a JWT.
  - **Sign in** — enter email and password directly in the settings tab.
- **Anonymous account** — no registration required. The plugin generates a random `device_secret` on first use; this secret is the sole re-auth credential. Single-device only (no shared identity across devices). **If the secret is lost, the account is unrecoverable.**

Common actions:

- **Account detail** — opens your browser to the server's account page showing storage usage, registered vaults, associated devices, and plan info.
- **Sign out** — clears the stored token and stops sync.

A signed-in user's email (or "anonymous" for anonymous accounts) is shown in the settings tab. Token expiry (30 days by default) shows a notice asking you to sign in again.

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

The WebSocket control channel receives events from the server. On a `file_changed` event from another client, the plugin triggers an immediate sync for that file rather than waiting for the interval. On a `file_deleted` event, the deletion is handled on the next full sync cycle. Events for files belonging to a different vault on the same account are silently ignored.

## Multi-vault support

A single account can sync multiple independent remote vaults. Remote vault identities are **server-generated** — the plugin does not create vault IDs locally.

### How vault provisioning works

The first time the plugin starts on a new vault (with no stored remote vault ID), it performs a **vault handshake** with the server:

- **No remote vaults on the account yet** — the server automatically creates a new remote vault, registers this device, and returns its ID. The plugin stores the ID and sync begins immediately with no user interaction.
- **Existing remote vaults on the account** — the server returns a list of available vaults. A picker is shown inside Obsidian with two options:
  - **Pick an existing vault** — the plugin explicitly registers this device with the chosen vault, stores the ID, and begins syncing.
  - **Create new vault** — the server creates a fresh remote vault, registers this device, and returns the new ID. Use this when you want a completely separate remote vault rather than joining one that already exists.

Dismissing the picker without choosing aborts startup and shows a notice — sync will not begin until a vault is selected or created.

The server-assigned vault ID is stored in `.obsidian/plugins/obsidian-syncagain/data.json` inside each vault, so it survives OS-level vault folder renames without reconfiguration. The handshake only runs once — on all subsequent startups the stored ID is used directly.

### Setting up a second vault

1. Install and enable the plugin in the second vault.
2. Sign in with the same account credentials.
3. The vault picker appears. Choose **Create new vault** to give this vault its own isolated remote storage, or pick an existing vault if you want to share remote state with another local vault.

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
cp main.js manifest.json versions.json styles.css /path/to/vault/.obsidian/plugins/obsidian-syncagain/
```

Then reload Obsidian or use the "Reload plugin" action.

## Source layout

```text
src/
├── main.ts                # Plugin entry point — lifecycle, event wiring, auth callback handler
├── settings.ts            # Settings interface, SettingTab UI, account management
├── file-tracker.ts        # Tracks dirty files between sync cycles (last-write-wins per path)
├── sync-manager.ts        # Orchestrates upload / download / reconcile
├── api-client.ts          # Typed HTTP client with JWT auth, file/lock APIs
├── control-channel.ts     # WebSocket connection, ping/pong loop, offline detection, reconnect with backoff
├── feature-negotiation.ts # FeatureNegotiationCoordinator + FeatureNegotiator interface + consistency validation
├── features/
│   └── e2ee-negotiator.ts # E2EE-specific handshake logic
├── vault-encryption.ts    # AES-256-GCM encryption/decryption + PBKDF2 key derivation
├── first-sync-modal.ts    # Conflict resolution modal shown on first sync of a new device
└── metadata.ts            # Type definitions (RemoteFileEntry, LocalSyncState, FileSyncEntry, ConflictFile)
```

## End-to-end encryption

When encryption is enabled, every file is encrypted with AES-256-GCM before it leaves the device. The server never has access to plaintext.

### How it works

- **Key derivation** — a 256-bit AES key is derived from your passphrase and a random 32-byte salt using PBKDF2-SHA256 with 100 000 iterations. The salt is generated once when you first enable encryption and stored in your plugin settings.
- **Per-file IV** — every upload uses a fresh random 12-byte IV. The same file content produces different ciphertext each time, so the server cannot detect whether a file was modified.
- **Wire format** — `[12-byte IV | ciphertext | 16-byte GCM auth tag]`.
- **Plaintext MD5 metadata** — the plugin sends the plaintext MD5 alongside each encrypted upload. The server stores it as opaque metadata and returns it in file listings. This lets a new device compare its local files against the server without downloading ciphertext, preserving the first-sync conflict resolution workflow.

### Privacy tradeoff

The server stores plaintext MD5 hashes. MD5 reveals nothing about file content, but a malicious server operator could use it to confirm whether you store a specific known file (by precomputing its MD5). For a self-hosted server this is an acceptable tradeoff for usable first-sync behaviour.

### Toggling encryption

Toggling E2EE on or off (or changing the passphrase) triggers a full re-upload of all vault files with the new encryption mode. The server retains ciphertext until the re-upload completes — there is no window where files are left unencrypted mid-cycle.

## Known limitations

- **Locks serialize uploads, not edits.** The implementation for the plugin is based on an assumption that files are not modified simultanously from clients. If two clients edit the same file between sync intervals, the second to upload will overwrite the first. The system prevents simultaneous uploads but does not detect or merge divergent edits.
- **No rename tracking on server.** A renamed file is treated as a delete + create, which may briefly trigger a deletion on other clients before the new file arrives.
- **In-memory locks.** The server holds locks in memory. A server restart clears all locks; clients re-acquire on their next sync cycle.

## Requirements

- Obsidian 1.4.0+
- A running [obsidian-sync-server](../obsidian-sync-server) instance with S3-compatible storage

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
