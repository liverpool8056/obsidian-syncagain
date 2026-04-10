# Table of Contents

- [Table of Contents](#table-of-contents)
  - [v1.0.0](#v100)
  - [v1.0.1](#v101)

## [v1.0.0]

> Release date: 2026/04/05

### Summary

First version released. Bidirectional vault sync plugin with upload, download, and remote-reconcile logic, file-lock serialization to prevent concurrent uploads, SSE-based real-time push from other clients, JWT authentication, MD5-based content diffing to skip redundant transfers, and trash/recovery support for non-permanent deletions.

## [v1.0.1]

> Release date: 2026/04/11

### Summary

#### New Features

1. Added a Connection block in the settings tab that reflects the live SSE connection status of the plugin to the remote server.
2. Added safe first-sync conflict resolution for new devices joining an existing account. When remote files are detected on first sync, local files are compared against the server by MD5. Files with identical content are pre-seeded into local state with no transfer. Files that only exist locally are uploaded. Files that only exist on the server are downloaded. Files that exist on both sides with different content are surfaced in a conflict resolution modal — the user can keep all local or all remote versions. Dismissing the modal without choosing prompts a confirmation that defaults to keeping the remote version.

#### Bug Fixes

1. Fixed an issue where uploading an empty file to Aliyun OSS would fail with HTTP 411 Length Required due to a missing `Content-Length` header; the header is now explicitly set to `0` for empty file bodies.

[v1.0.0]: https://github.com/liverpool8056/obsidian-syncagain/commits/b904b66
[v1.0.1]: https://github.com/liverpool8056/obsidian-syncagain/compare/b904b66...b1c77d6
