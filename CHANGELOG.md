# Table of Contents

- [Table of Contents](#table-of-contents)
  - [1.0.0](#100)
  - [1.0.1](#101)

## [1.0.0]

> Release date: 2026/04/05

### Summary

First version released. Bidirectional vault sync plugin with upload, download, and remote-reconcile logic, file-lock serialization to prevent concurrent uploads, SSE-based real-time push from other clients, JWT authentication, MD5-based content diffing to skip redundant transfers, and trash/recovery support for non-permanent deletions.

## [1.0.1]

> Release date: 2026/04/11

### Summary

#### New Features

1. Added a Connection block in the settings tab that reflects the live SSE connection status of the plugin to the remote server.
2. Added safe first-sync conflict resolution for new devices joining an existing account. When remote files are detected on first sync, local files are compared against the server by MD5. Files with identical content are pre-seeded into local state with no transfer. Files that only exist locally are uploaded. Files that only exist on the server are downloaded. Files that exist on both sides with different content are surfaced in a conflict resolution modal — the user can keep all local or all remote versions. Dismissing the modal without choosing prompts a confirmation that defaults to keeping the remote version.
3. Removed server-side tombstone/trash mechanism. Deletion is now propagated purely by absence: when a file disappears from the remote file list, other clients trash their local copy on the next reconcile cycle. Recovery is delegated to the user via Obsidian's own trash setting (OS trash or `.trash/` folder). The `.trash/` folder inside the vault is excluded from sync.
4. Multi-vault support: A single account can now sync multiple independent vaults simultaneously.
- Each vault is assigned a stable UUID (**Vault ID**) on first install, stored inside the vault's own settings file. The UUID survives OS-level vault folder renames without any reconfiguration.
- All S3 keys are namespaced as `{vaultId}/{vault-relative-path}`, so files from different vaults on the same account never collide.
- SSE events for files belonging to a different vault on the same account are silently ignored.
- On every sync start the plugin reports the current folder name to the server (`PUT /api/vaults/{vault_id}`), keeping the server-side `vault_id → folder name` mapping up to date.
- A **Vault ID** field is available in Settings → Sync for manual overrides. Existing installs default to an empty Vault ID (no prefix) and are fully backward compatible.
5. Settings tab redesign:
- The **Server URL** setting is renamed to **Server**. The connection status badge is now displayed inline next to the setting name instead of in a separate Connection row.
- Removed the standalone User ID, Vault ID, and Device ID (Info section) fields from the settings tab. These details are accessible via the server's account page instead.
- Added an **Account detail** button in the signed-in state that opens the browser to the server's `/account` page, showing storage usage, registered vaults, associated devices, and plan info.

#### Bug Fixes

1. Fixed an issue where uploading an empty file to Aliyun OSS would fail with HTTP 411 Length Required due to a missing `Content-Length` header; the header is now explicitly set to `0` for empty file bodies.
2. Fixed an issue where a device that modified a file while offline would re-upload it even though another client had deleted it from the server in the meantime. The sync cycle now takes a remote snapshot before the upload loop and skips re-uploading files that were previously synced but are now absent from the server; reconcile then propagates the deletion locally.


[1.0.0]: https://github.com/liverpool8056/obsidian-syncagain/commits/b904b66
[1.0.1]: https://github.com/liverpool8056/obsidian-syncagain/compare/b904b66...b1c77d6
