# Table of Contents

- [Table of Contents](#table-of-contents)
  - [1.0.0](#100)
  - [1.1.0](#110)

## [1.0.0]

> Release date: 2026/04/05

### Summary

First version released. Bidirectional vault sync plugin with upload, download, and remote-reconcile logic, file-lock serialization to prevent concurrent uploads, Websocket-based real-time push from other clients, JWT authentication, MD5-based content diffing to skip redundant transfers, and multiple vaults support.

## [1.1.0]

> Release date: 2026/06/14

### Summary
1. Fix an issue where file moved to another location would be pulled again to the original location.
2. Support "Forgot Password" 
3. Support a checkbox to **forget** cached account data when logging out

[1.0.0]: https://github.com/liverpool8056/obsidian-syncagain/commits/b904b66...1.0.0
[1.1.0]: https://github.com/liverpool8056/obsidian-syncagain/commits/1.0.0...1.1.0
