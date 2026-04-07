var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SyncAgainPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  serverUrl: "",
  clientId: "",
  syncIntervalMinutes: 5,
  syncEnabled: true,
  userId: "",
  userEmail: "",
  authToken: "",
  deletionStrategy: "non-permanent"
};
var SyncAgainSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.emailInput = "";
    this.passwordInput = "";
    this.signingIn = false;
    this.showSignInForm = false;
    this.connectionStatusEl = null;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Server").setHeading();
    new import_obsidian.Setting(containerEl).setName("Server URL").setDesc('Base URL of the sync server, e.g. "http://localhost:8080"').addText(
      (text) => text.setPlaceholder("").setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
        this.plugin.settings.serverUrl = value.trim();
        await this.plugin.saveSettings();
        this.plugin.restartSync();
      })
    );
    const connSetting = new import_obsidian.Setting(containerEl).setName("Connection");
    this.connectionStatusEl = connSetting.controlEl.createEl("span", {
      cls: "syncagain-conn-status"
    });
    this.renderConnectionStatus(this.plugin.sseStatus);
    new import_obsidian.Setting(containerEl).setName("Account").setHeading();
    const isSignedIn = Boolean(this.plugin.settings.authToken && this.plugin.settings.userId);
    if (isSignedIn) {
      new import_obsidian.Setting(containerEl).setName("Signed in").setDesc(this.plugin.settings.userEmail || this.plugin.settings.userId).addButton(
        (btn) => btn.setButtonText("Sign out").setWarning().onClick(async () => {
          this.plugin.settings.authToken = "";
          this.plugin.settings.userId = "";
          this.plugin.settings.userEmail = "";
          await this.plugin.saveSettings();
          this.plugin.signOut();
          this.display();
        })
      );
      new import_obsidian.Setting(containerEl).setName("User ID").setDesc("Your account ID on the server (read-only).").addText(
        (text) => text.setValue(this.plugin.settings.userId).setDisabled(true)
      );
    } else {
      new import_obsidian.Setting(containerEl).setName("Account").setDesc("Create a new account or sign in to an existing one.").addButton(
        (btn) => btn.setButtonText("Sign up").onClick(() => {
          const base = this.plugin.settings.serverUrl.replace(/\/+$/, "");
          if (!base) {
            new import_obsidian.Notice("Set the server URL first.");
            return;
          }
          const url = `${base}/register?client_id=${this.plugin.settings.clientId}`;
          window.open(url);
        })
      ).addButton(
        (btn) => btn.setButtonText("Sign in").setCta().onClick(() => {
          this.showSignInForm = !this.showSignInForm;
          this.display();
        })
      );
      if (this.showSignInForm) {
        new import_obsidian.Setting(containerEl).setName("Email").addText((text) => {
          text.setPlaceholder("").setValue(this.emailInput).onChange((v) => {
            this.emailInput = v.trim();
          });
        });
        new import_obsidian.Setting(containerEl).setName("Password").addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022").setValue(this.passwordInput).onChange((v) => {
            this.passwordInput = v;
          });
        });
        new import_obsidian.Setting(containerEl).addButton((btn) => {
          btn.setButtonText(this.signingIn ? "Signing in\u2026" : "Confirm").setCta().setDisabled(this.signingIn).onClick(async () => {
            if (!this.plugin.settings.serverUrl) {
              new import_obsidian.Notice("Set the server URL first.");
              return;
            }
            if (!this.emailInput) {
              new import_obsidian.Notice("Please enter your email.");
              return;
            }
            if (!this.passwordInput) {
              new import_obsidian.Notice("Please enter your password.");
              return;
            }
            this.signingIn = true;
            btn.setButtonText("Signing in\u2026").setDisabled(true);
            try {
              const result = await this.plugin.api.loginWithCredentials(
                this.emailInput,
                this.passwordInput
              );
              this.plugin.settings.authToken = result.token;
              this.plugin.settings.userId = result.userId;
              this.plugin.settings.userEmail = result.userEmail;
              await this.plugin.saveSettings();
              new import_obsidian.Notice(`Signed in as ${result.userEmail}`);
              this.passwordInput = "";
              this.signingIn = false;
              this.showSignInForm = false;
              if (this.plugin.settings.syncEnabled) {
                this.plugin.restartSync();
              }
              this.display();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new import_obsidian.Notice(`Sign-in failed: ${msg}`);
              this.signingIn = false;
              btn.setButtonText("Confirm").setDisabled(false);
            }
          });
        });
      }
    }
    if (!isSignedIn)
      return;
    new import_obsidian.Setting(containerEl).setName("Sync").setHeading();
    new import_obsidian.Setting(containerEl).setName("Enable sync").setDesc("Turn periodic file sync on or off.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.syncEnabled).onChange(async (value) => {
        this.plugin.settings.syncEnabled = value;
        await this.plugin.saveSettings();
        if (value) {
          this.plugin.startSync();
        } else {
          this.plugin.stopSync();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Sync interval (minutes)").setDesc("How often to run a full sync cycle.").addText(
      (text) => text.setPlaceholder("5").setValue(String(this.plugin.settings.syncIntervalMinutes)).onChange(async (value) => {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed > 0) {
          this.plugin.settings.syncIntervalMinutes = parsed;
          await this.plugin.saveSettings();
          this.plugin.restartSync();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("Deletion").setHeading();
    new import_obsidian.Setting(containerEl).setName("Deletion strategy").setDesc(
      "Non-permanent: deleted files are moved to a remote trash and can be recovered. Permanent: files are immediately deleted with no recovery option."
    ).addDropdown(
      (drop) => drop.addOption("non-permanent", "Non-permanent (recoverable)").addOption("permanent", "Permanent (no recovery)").setValue(this.plugin.settings.deletionStrategy).onChange(async (value) => {
        this.plugin.settings.deletionStrategy = value;
        await this.plugin.saveSettings();
        this.plugin.syncManager.deletionStrategy = value;
        this.display();
      })
    );
    if (this.plugin.settings.deletionStrategy === "non-permanent") {
      new import_obsidian.Setting(containerEl).setName("Trash").setHeading();
      const trashContainer = containerEl.createDiv({ cls: "syncagain-trash" });
      trashContainer.createEl("p", { text: "Loading\u2026" });
      void this.loadTrashView(trashContainer);
    }
    new import_obsidian.Setting(containerEl).setName("Info").setHeading();
    new import_obsidian.Setting(containerEl).setName("Device ID").setDesc("Unique identifier for this Obsidian instance (auto-generated, read-only).").addText(
      (text) => text.setValue(this.plugin.settings.clientId).setDisabled(true)
    );
  }
  // ── Connection status ──────────────────────────────────────────────────────
  /** Called by the plugin whenever the SSE connection state changes. */
  updateConnectionStatus(status) {
    this.plugin.sseStatus = status;
    this.renderConnectionStatus(status);
  }
  renderConnectionStatus(status) {
    if (!this.connectionStatusEl)
      return;
    const labels = {
      connected: "Connected",
      connecting: "Connecting\u2026",
      disconnected: "Disconnected"
    };
    this.connectionStatusEl.setText(labels[status]);
    this.connectionStatusEl.setAttribute(
      "class",
      `syncagain-conn-status syncagain-conn-status--${status}`
    );
  }
  // ── Trash view ─────────────────────────────────────────────────────────────
  async loadTrashView(container) {
    var _a;
    container.empty();
    container.createEl("p", { text: "Loading\u2026" });
    let files;
    try {
      files = await this.plugin.api.listTrash();
    } catch (e) {
      container.empty();
      container.createEl("p", { text: "Failed to load trash. Is the server reachable?" });
      return;
    }
    container.empty();
    if (files.length === 0) {
      container.createEl("p", { text: "Trash is empty." });
      return;
    }
    for (const entry of files) {
      const filename = (_a = entry.key.split("/").pop()) != null ? _a : entry.key;
      const originalPath = entry.key;
      new import_obsidian.Setting(container).setName(filename).setDesc(originalPath !== filename ? originalPath : "").addButton(
        (btn) => btn.setButtonText("Recover").setCta().onClick(async () => {
          btn.setButtonText("Recovering\u2026").setDisabled(true);
          try {
            await this.plugin.api.acquireLocks([originalPath]);
            try {
              await this.plugin.api.recoverFromTrash(originalPath);
              await this.plugin.syncManager.recoverKey(originalPath);
              new import_obsidian.Notice(`Recovered: ${filename}`);
            } finally {
              try {
                await this.plugin.api.releaseLocks([originalPath]);
              } catch (e) {
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new import_obsidian.Notice(`Recovery failed: ${msg}`);
          }
          void this.loadTrashView(container);
        })
      ).addButton(
        (btn) => btn.setButtonText("Delete").setWarning().onClick(() => {
          new ConfirmDeleteModal(this.app, filename, async () => {
            try {
              await this.plugin.api.deleteFromTrash(originalPath);
              new import_obsidian.Notice(`Permanently deleted: ${filename}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new import_obsidian.Notice(`Delete failed: ${msg}`);
            }
            void this.loadTrashView(container);
          }).open();
        })
      );
    }
  }
};
var ConfirmDeleteModal = class extends import_obsidian.Modal {
  constructor(app, filename, onConfirm) {
    super(app);
    this.filename = filename;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Permanently delete?" });
    contentEl.createEl("p", {
      text: `"${this.filename}" will be permanently deleted and cannot be recovered.`
    });
    new import_obsidian.Setting(contentEl).addButton(
      (btn) => btn.setButtonText("Cancel").onClick(() => this.close())
    ).addButton(
      (btn) => btn.setButtonText("Delete permanently").setWarning().onClick(async () => {
        this.close();
        await this.onConfirm();
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/file-tracker.ts
var import_obsidian2 = require("obsidian");
var FileTracker = class {
  constructor() {
    this.dirtyFiles = /* @__PURE__ */ new Map();
    this.pendingDeletions = /* @__PURE__ */ new Set();
    /** Paths that should be ignored on the next markDirty or handleDelete call (used for plugin-initiated writes/deletes). */
    this.suppressOnce = /* @__PURE__ */ new Set();
  }
  /**
   * Suppress the next markDirty event for a path.
   * Call this before writing a downloaded file to the vault so the write
   * event doesn't re-queue the file as a local change.
   */
  suppressNext(path) {
    this.suppressOnce.add(path);
  }
  markDirty(file) {
    if (!(file instanceof import_obsidian2.TFile))
      return;
    if (this.suppressOnce.delete(file.path))
      return;
    this.dirtyFiles.set(file.path, {
      path: file.path,
      modifiedAt: Date.now()
    });
  }
  markDirtyByPath(path) {
    this.dirtyFiles.set(path, { path, modifiedAt: Date.now() });
  }
  handleRename(file, oldPath) {
    if (!(file instanceof import_obsidian2.TFile))
      return;
    this.dirtyFiles.delete(oldPath);
    this.markDirty(file);
  }
  handleDelete(file) {
    if (!(file instanceof import_obsidian2.TFile))
      return;
    this.dirtyFiles.delete(file.path);
    if (this.suppressOnce.delete(file.path))
      return;
    this.pendingDeletions.add(file.path);
  }
  /**
   * Atomically drains the dirty set and returns its contents.
   * Clears before the async upload so new modifications during upload
   * are captured in the next cycle rather than lost.
   */
  drainDirtyFiles() {
    const snapshot = Array.from(this.dirtyFiles.values());
    this.dirtyFiles.clear();
    return snapshot;
  }
  /** Atomically drains and returns all paths the user has deleted locally. */
  drainPendingDeletions() {
    const snapshot = Array.from(this.pendingDeletions);
    this.pendingDeletions.clear();
    return snapshot;
  }
  markDeletedByPath(path) {
    this.pendingDeletions.add(path);
  }
  get pendingCount() {
    return this.dirtyFiles.size;
  }
};

// src/api-client.ts
var import_obsidian3 = require("obsidian");
var ApiError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
};
var ApiClient = class {
  constructor(serverUrl, clientId, token = null, onAuthFailure) {
    this.serverUrl = serverUrl;
    this.clientId = clientId;
    this.onAuthFailure = onAuthFailure;
    this.token = token || null;
  }
  /** Replace the cached token (e.g. after sign-in via URI callback). */
  setToken(token) {
    this.token = token;
  }
  /** Discard the cached token (e.g. on sign-out). */
  invalidateToken() {
    this.token = null;
  }
  // ── Auth ────────────────────────────────────────────────────────────────
  /**
   * Sign in with email + password and store the returned token.
   * Used by the inline sign-in form in the settings tab.
   * Returns `{ token, userId, userEmail }` on success.
   */
  async loginWithCredentials(email, password) {
    var _a;
    const res = await (0, import_obsidian3.requestUrl)({
      url: `${this.serverUrl}/api/auth/login`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, client_id: this.clientId }),
      throw: false
    });
    if (res.status >= 200 && res.status < 300) {
      const data = res.json;
      this.token = data.token;
      return { token: data.token, userId: data.user_id, userEmail: data.email };
    }
    let msg;
    try {
      msg = (_a = res.json.error) != null ? _a : String(res.status);
    } catch (e) {
      msg = String(res.status);
    }
    throw new ApiError(res.status, msg);
  }
  // ── Generic request helper ───────────────────────────────────────────────
  async request(method, path, body, extraHeaders) {
    var _a, _b, _c;
    if (!this.token) {
      (_a = this.onAuthFailure) == null ? void 0 : _a.call(this);
      throw new ApiError(401, "Not signed in. Please sign in in the SyncAgain settings.");
    }
    const res = await (0, import_obsidian3.requestUrl)({
      url: `${this.serverUrl}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...extraHeaders
      },
      body,
      throw: false
    });
    if (res.status === 401) {
      this.token = null;
      (_b = this.onAuthFailure) == null ? void 0 : _b.call(this);
      throw new ApiError(401, "Session expired. Please sign in again in the SyncAgain settings.");
    }
    if (res.status < 200 || res.status >= 300) {
      let msg = res.text;
      try {
        msg = (_c = res.json.error) != null ? _c : msg;
      } catch (e) {
      }
      throw new ApiError(res.status, msg);
    }
    if (res.status === 204)
      return void 0;
    return res.json;
  }
  // ── Files ────────────────────────────────────────────────────────────────
  async listFiles() {
    const data = await this.request("GET", "/api/files");
    return data.files;
  }
  async downloadFile(key) {
    var _a, _b;
    if (!this.token) {
      (_a = this.onAuthFailure) == null ? void 0 : _a.call(this);
      throw new ApiError(401, "Not signed in.");
    }
    const res = await (0, import_obsidian3.requestUrl)({
      url: `${this.serverUrl}/api/files/download?key=${encodeURIComponent(key)}`,
      headers: { Authorization: `Bearer ${this.token}` },
      throw: false
    });
    if (res.status === 401) {
      this.token = null;
      (_b = this.onAuthFailure) == null ? void 0 : _b.call(this);
      throw new ApiError(401, "Session expired. Please sign in again.");
    }
    if (res.status < 200 || res.status >= 300)
      throw new ApiError(res.status, `Download failed for '${key}'`);
    return res.arrayBuffer;
  }
  /** Upload `data` to `key`. The caller must hold the lock before calling this. */
  async uploadFile(key, data, contentType = "application/octet-stream") {
    var _a, _b, _c;
    if (!this.token) {
      (_a = this.onAuthFailure) == null ? void 0 : _a.call(this);
      throw new ApiError(401, "Not signed in.");
    }
    const boundary = `----SyncAgainBoundary${Date.now()}`;
    const enc = new TextEncoder();
    const keyPart = enc.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="key"\r
\r
${key}\r
`
    );
    const fileHeader = enc.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${key}"\r
Content-Type: ${contentType}\r
\r
`
    );
    const footer = enc.encode(`\r
--${boundary}--\r
`);
    const fileBytes = new Uint8Array(data);
    const body = new Uint8Array(keyPart.length + fileHeader.length + fileBytes.length + footer.length);
    body.set(keyPart, 0);
    body.set(fileHeader, keyPart.length);
    body.set(fileBytes, keyPart.length + fileHeader.length);
    body.set(footer, keyPart.length + fileHeader.length + fileBytes.length);
    const res = await (0, import_obsidian3.requestUrl)({
      url: `${this.serverUrl}/api/files/upload`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body: body.buffer,
      throw: false
    });
    if (res.status === 401) {
      this.token = null;
      (_b = this.onAuthFailure) == null ? void 0 : _b.call(this);
      throw new ApiError(401, "Session expired. Please sign in again.");
    }
    if (res.status < 200 || res.status >= 300) {
      let msg = res.text;
      try {
        msg = (_c = res.json.error) != null ? _c : msg;
      } catch (e) {
      }
      throw new ApiError(res.status, msg);
    }
  }
  /** Delete `key` on the server. The caller must hold the lock. */
  async deleteFile(key) {
    await this.request("DELETE", `/api/files?key=${encodeURIComponent(key)}`);
  }
  // ── Trash ─────────────────────────────────────────────────────────────────
  /**
   * Move `key` to the trash (`_delete/` prefix) on the server.
   * The caller must hold the lock on `key`. The server releases the lock.
   */
  async moveToTrash(key) {
    await this.request("POST", `/api/files/trash?key=${encodeURIComponent(key)}`);
  }
  /** List files currently in the trash. Returns entries with original-path keys. */
  async listTrash() {
    const data = await this.request("GET", "/api/files/trash");
    return data.files;
  }
  /**
   * Restore `key` from the trash to its original path.
   * The caller must hold the lock on `key`. The server releases the lock.
   */
  async recoverFromTrash(key) {
    await this.request("POST", `/api/files/recover?key=${encodeURIComponent(key)}`);
  }
  /**
   * Permanently delete `key` from the trash (no recovery possible).
   * No lock is required.
   */
  async deleteFromTrash(key) {
    await this.request("DELETE", `/api/files/trash?key=${encodeURIComponent(key)}`);
  }
  /**
   * Permanently delete `key` from the server (no recovery).
   * Writes a `_deleted/` tombstone so other clients propagate the deletion.
   * The caller must hold the lock on `key`. The server releases the lock.
   */
  async permanentDeleteFile(key) {
    await this.request("DELETE", `/api/files/permanent?key=${encodeURIComponent(key)}`);
  }
  // ── Locks ─────────────────────────────────────────────────────────────────
  /**
   * Acquire locks on the given keys.
   * Throws `ApiError` with status 409 if any key is locked by another client.
   */
  async acquireLocks(keys) {
    await this.request(
      "POST",
      "/api/locks",
      JSON.stringify({ client_id: this.clientId, files: keys }),
      { "Content-Type": "application/json" }
    );
  }
  async releaseLocks(keys) {
    await this.request(
      "DELETE",
      "/api/locks",
      JSON.stringify({ client_id: this.clientId, files: keys }),
      { "Content-Type": "application/json" }
    );
  }
  async listLocks() {
    const data = await this.request("GET", "/api/locks");
    return data.locks;
  }
  // ── SSE event stream ─────────────────────────────────────────────────────
  /** Returns an authenticated URL for the SSE endpoint. */
  buildEventsUrl() {
    if (!this.token)
      return null;
    return `${this.serverUrl}/api/events?token=${encodeURIComponent(this.token)}`;
  }
};

// src/metadata.ts
var EMPTY_SYNC_STATE = {
  version: 1,
  files: {},
  deletedFiles: []
};

// src/sync-manager.ts
function md5(buffer) {
  const S = [
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21
  ];
  const T = [
    3614090360,
    3905402710,
    606105819,
    3250441966,
    4118548399,
    1200080426,
    2821735955,
    4249261313,
    1770035416,
    2336552879,
    4294925233,
    2304563134,
    1804603682,
    4254626195,
    2792965006,
    1236535329,
    4129170786,
    3225465664,
    643717713,
    3921069994,
    3593408605,
    38016083,
    3634488961,
    3889429448,
    568446438,
    3275163606,
    4107603335,
    1163531501,
    2850285829,
    4243563512,
    1735328473,
    2368359562,
    4294588738,
    2272392833,
    1839030562,
    4259657740,
    2763975236,
    1272893353,
    4139469664,
    3200236656,
    681279174,
    3936430074,
    3572445317,
    76029189,
    3654602809,
    3873151461,
    530742520,
    3299628645,
    4096336452,
    1126891415,
    2878612391,
    4237533241,
    1700485571,
    2399980690,
    4293915773,
    2240044497,
    1873313359,
    4264355552,
    2734768916,
    1309151649,
    4149444226,
    3174756917,
    718787259,
    3951481745
  ];
  const bytes = new Uint8Array(buffer);
  const origLen = bytes.length;
  const padLen = (origLen % 64 < 56 ? 56 : 120) - origLen % 64;
  const padded = new Uint8Array(origLen + padLen + 8);
  padded.set(bytes);
  padded[origLen] = 128;
  const dv = new DataView(padded.buffer);
  dv.setUint32(origLen + padLen, origLen * 8 >>> 0, true);
  dv.setUint32(origLen + padLen + 4, Math.floor(origLen * 8 / 4294967296), true);
  const add = (x, y) => x + y >>> 0;
  const rol = (x, n) => (x << n | x >>> 32 - n) >>> 0;
  let a = 1732584193, b = 4023233417, c = 2562383102, d = 271733878;
  for (let i = 0; i < padded.length; i += 64) {
    const M = [];
    for (let j = 0; j < 16; j++)
      M.push(dv.getUint32(i + j * 4, true));
    let A = a, B = b, C = c, D = d;
    for (let j = 0; j < 64; j++) {
      let F, g;
      if (j < 16) {
        F = (B & C | ~B >>> 0 & D) >>> 0;
        g = j;
      } else if (j < 32) {
        F = (D & B | ~D >>> 0 & C) >>> 0;
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        F = (B ^ C ^ D) >>> 0;
        g = (3 * j + 5) % 16;
      } else {
        F = (C ^ (B | ~D >>> 0)) >>> 0;
        g = 7 * j % 16;
      }
      const temp = add(add(add(A, F), M[g]), T[j]);
      A = D;
      D = C;
      C = B;
      B = add(B, rol(temp, S[j]));
    }
    a = add(a, A);
    b = add(b, B);
    c = add(c, C);
    d = add(d, D);
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a, true);
  out.setUint32(4, b, true);
  out.setUint32(8, c, true);
  out.setUint32(12, d, true);
  return Array.from(new Uint8Array(out.buffer)).map((v) => v.toString(16).padStart(2, "0")).join("");
}
var SyncManager = class {
  constructor(vault, api, tracker) {
    this.vault = vault;
    this.api = api;
    this.tracker = tracker;
    this.state = EMPTY_SYNC_STATE;
    this.syncing = false;
    this.startupScanDone = false;
    /**
     * Controls how local deletions are handled on the server.
     * - "non-permanent": file is moved to `_delete/` (recoverable via the Trash view).
     * - "permanent": file is deleted and a tombstone is written (not recoverable).
     * Defaults to "non-permanent". Updated by the plugin when settings change.
     */
    this.deletionStrategy = "non-permanent";
  }
  get stateFile() {
    return `${this.vault.configDir}/plugins/obsidian-syncagain/sync-state.json`;
  }
  // ── State persistence ────────────────────────────────────────────────────
  async loadState() {
    try {
      const raw = await this.vault.adapter.read(this.stateFile);
      const parsed = JSON.parse(raw);
      this.state = { ...EMPTY_SYNC_STATE, ...parsed };
    } catch (e) {
      this.state = { ...EMPTY_SYNC_STATE };
    }
  }
  async saveState() {
    await this.vault.adapter.write(this.stateFile, JSON.stringify(this.state));
  }
  // ── Main sync entry point ─────────────────────────────────────────────────
  async sync() {
    var _a, _b, _c;
    if (this.syncing)
      return;
    this.syncing = true;
    (_a = this.onStatus) == null ? void 0 : _a.call(this, "syncing");
    try {
      await this.runSyncCycle();
      (_b = this.onStatus) == null ? void 0 : _b.call(this, "idle");
    } catch (err) {
      console.error("[SyncAgain] Sync error:", err);
      (_c = this.onStatus) == null ? void 0 : _c.call(this, "error");
    } finally {
      this.syncing = false;
    }
  }
  /** Trigger a targeted download for a specific key (from SSE events). */
  async syncKey(key) {
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
  async recoverKey(key) {
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
  detectOfflineChanges() {
    var _a;
    for (const file of this.vault.getFiles()) {
      if (this.state.deletedFiles.includes(file.path))
        continue;
      const known = this.state.files[file.path];
      if (!known || file.stat.mtime > ((_a = known.mtime) != null ? _a : 0)) {
        this.tracker.markDirtyByPath(file.path);
      }
    }
    for (const key of Object.keys(this.state.files)) {
      if (!this.vault.getFileByPath(key) && !this.state.deletedFiles.includes(key)) {
        this.tracker.markDeletedByPath(key);
      }
    }
  }
  async runSyncCycle() {
    if (!this.startupScanDone) {
      this.detectOfflineChanges();
      this.startupScanDone = true;
    }
    const deletedPaths = this.tracker.drainPendingDeletions();
    for (const path of deletedPaths) {
      try {
        await this.handleDeletion(path);
      } catch (err) {
        console.error(`[SyncAgain] Failed to handle deletion for '${path}':`, err);
        this.tracker.markDeletedByPath(path);
      }
    }
    const dirty = this.tracker.drainDirtyFiles();
    const failedPaths = [];
    for (const tracked of dirty) {
      if (this.state.deletedFiles.includes(tracked.path))
        continue;
      try {
        await this.uploadLocalFile(tracked.path);
      } catch (err) {
        console.error(`[SyncAgain] Upload failed for '${tracked.path}':`, err);
        failedPaths.push(tracked.path);
      }
    }
    for (const path of failedPaths) {
      this.tracker.markDirtyByPath(path);
    }
    const remoteFiles = await this.api.listFiles();
    await this.reconcileRemote(remoteFiles);
    await this.saveState();
  }
  // ── Upload ─────────────────────────────────────────────────────────────────
  async uploadLocalFile(path) {
    const file = this.vault.getFileByPath(path);
    if (!file) {
      return;
    }
    const data = await this.vault.readBinary(file);
    const hash = md5(data);
    const known = this.state.files[path];
    if ((known == null ? void 0 : known.md5) === hash)
      return;
    try {
      await this.api.acquireLocks([path]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        console.warn(`[SyncAgain] '${path}' is locked by another client \u2014 skipping upload.`);
        this.tracker.markDirtyByPath(path);
        return;
      }
      throw err;
    }
    try {
      await this.api.uploadFile(path, data);
      this.state.files[path] = { md5: hash, syncedAt: Date.now(), mtime: file.stat.mtime };
    } finally {
      try {
        await this.api.releaseLocks([path]);
      } catch (e) {
      }
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
  async handleDeletion(path) {
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
        console.warn(`[SyncAgain] '${path}' is locked \u2014 re-queuing deletion.`);
        this.tracker.markDeletedByPath(path);
        return;
      }
      throw err;
    }
    try {
      if (this.deletionStrategy === "non-permanent") {
        await this.api.moveToTrash(path);
      } else {
        await this.api.permanentDeleteFile(path);
      }
    } finally {
      try {
        await this.api.releaseLocks([path]);
      } catch (e) {
      }
    }
    if (!this.state.deletedFiles.includes(path)) {
      this.state.deletedFiles.push(path);
    }
    delete this.state.files[path];
  }
  // ── Download / reconcile ──────────────────────────────────────────────────
  async reconcileRemote(remoteFiles) {
    const tombstonePrefix = "_deleted/";
    const trashPrefix = "_delete/";
    const currentlyDeletedOnServer = /* @__PURE__ */ new Set();
    for (const remote of remoteFiles) {
      if (remote.key.startsWith(tombstonePrefix)) {
        currentlyDeletedOnServer.add(remote.key.slice(tombstonePrefix.length));
      } else if (remote.key.startsWith(trashPrefix)) {
        currentlyDeletedOnServer.add(remote.key.slice(trashPrefix.length));
      }
    }
    if (remoteFiles.length > 0) {
      this.state.deletedFiles = this.state.deletedFiles.filter(
        (k) => currentlyDeletedOnServer.has(k)
      );
    }
    const deletedSet = new Set(this.state.deletedFiles);
    const processedAsTombstone = /* @__PURE__ */ new Set();
    for (const remote of remoteFiles) {
      let originalKey = null;
      if (remote.key.startsWith(tombstonePrefix)) {
        originalKey = remote.key.slice(tombstonePrefix.length);
      } else if (remote.key.startsWith(trashPrefix)) {
        originalKey = remote.key.slice(trashPrefix.length);
      }
      if (!originalKey)
        continue;
      if (processedAsTombstone.has(originalKey))
        continue;
      processedAsTombstone.add(originalKey);
      if (deletedSet.has(originalKey))
        continue;
      await this.deleteLocalFile(originalKey);
    }
    const remoteKeys = new Set(remoteFiles.map((f) => f.key));
    for (const remote of remoteFiles) {
      if (remote.key.startsWith(tombstonePrefix))
        continue;
      if (remote.key.startsWith(trashPrefix))
        continue;
      if (deletedSet.has(remote.key))
        continue;
      const known = this.state.files[remote.key];
      const existsLocally = Boolean(this.vault.getFileByPath(remote.key));
      if ((known == null ? void 0 : known.md5) === remote.md5 && existsLocally)
        continue;
      await this.downloadKey(remote.key, remote);
    }
    const trackedKeys = Object.keys(this.state.files);
    if (remoteFiles.length > 0 || trackedKeys.length === 0) {
      for (const key of trackedKeys) {
        if (!remoteKeys.has(key) && !deletedSet.has(key)) {
          await this.deleteLocalFile(key);
        }
      }
    }
  }
  async downloadKey(key, remote) {
    var _a, _b;
    const data = await this.api.downloadFile(key);
    const hash = md5(data);
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
      md5: (_a = remote == null ? void 0 : remote.md5) != null ? _a : hash,
      syncedAt: Date.now(),
      mtime: (_b = writtenFile == null ? void 0 : writtenFile.stat.mtime) != null ? _b : Date.now()
    };
  }
  async deleteLocalFile(key) {
    const file = this.vault.getFileByPath(key);
    if (file) {
      this.tracker.suppressNext(key);
      await this.vault.delete(file);
    }
    delete this.state.files[key];
  }
  async ensureFolder(filePath) {
    const parts = filePath.split("/");
    parts.pop();
    if (parts.length === 0)
      return;
    const folder = parts.join("/");
    if (!this.vault.getFolderByPath(folder)) {
      await this.vault.createFolder(folder);
    }
  }
};

// src/event-listener.ts
var EventListener = class {
  constructor(api, ownClientId, onRemoteChange, onConnectionStatus) {
    this.api = api;
    this.ownClientId = ownClientId;
    this.onRemoteChange = onRemoteChange;
    this.onConnectionStatus = onConnectionStatus;
    this.es = null;
    this.retryMs = 1e3;
    this.maxRetryMs = 3e4;
    this.stopped = false;
    this.retryTimeout = null;
  }
  start() {
    var _a;
    this.stopped = false;
    (_a = this.onConnectionStatus) == null ? void 0 : _a.call(this, "connecting");
    this.connect();
  }
  stop() {
    var _a;
    this.stopped = true;
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    this.closeSource();
    (_a = this.onConnectionStatus) == null ? void 0 : _a.call(this, "disconnected");
  }
  connect() {
    var _a;
    if (this.stopped)
      return;
    try {
      const url = this.api.buildEventsUrl();
      if (!url) {
        (_a = this.onConnectionStatus) == null ? void 0 : _a.call(this, "disconnected");
        return;
      }
      const es = new EventSource(url);
      this.es = es;
      es.onopen = () => {
        var _a2;
        this.retryMs = 1e3;
        (_a2 = this.onConnectionStatus) == null ? void 0 : _a2.call(this, "connected");
      };
      es.onerror = () => {
        var _a2;
        es.close();
        this.es = null;
        (_a2 = this.onConnectionStatus) == null ? void 0 : _a2.call(this, "connecting");
        this.scheduleReconnect();
      };
      const handleEvent = (raw) => {
        try {
          const payload = JSON.parse(raw.data);
          if (payload.client_id === this.ownClientId)
            return;
          if (payload.event === "file_changed" || payload.event === "file_deleted") {
            this.onRemoteChange(payload);
          }
        } catch (e) {
        }
      };
      es.addEventListener("file_changed", handleEvent);
      es.addEventListener("file_deleted", handleEvent);
    } catch (e) {
      this.scheduleReconnect();
    }
  }
  scheduleReconnect() {
    if (this.stopped)
      return;
    this.retryTimeout = setTimeout(() => {
      this.connect();
    }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, this.maxRetryMs);
  }
  closeSource() {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }
};

// src/main.ts
var SyncAgainPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.sseStatus = "disconnected";
    this.syncIntervalId = null;
    this.statusBarEl = null;
  }
  async onload() {
    await this.loadSettings();
    if (!this.settings.clientId) {
      this.settings.clientId = crypto.randomUUID();
      await this.saveSettings();
    }
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar("off");
    this.tracker = new FileTracker();
    this.api = new ApiClient(
      this.settings.serverUrl,
      this.settings.clientId,
      this.settings.authToken || null,
      () => this.handleAuthFailure()
    );
    this.syncManager = new SyncManager(this.app.vault, this.api, this.tracker);
    this.syncManager.onStatus = (status) => this.updateStatusBar(status);
    this.syncManager.deletionStrategy = this.settings.deletionStrategy;
    this.eventListener = new EventListener(
      this.api,
      this.settings.clientId,
      (event) => {
        if (event.key) {
          if (event.event === "file_changed") {
            void this.syncManager.syncKey(event.key);
          } else if (event.event === "file_deleted") {
          }
        }
      },
      (status) => this.onSseStatus(status)
    );
    this.registerObsidianProtocolHandler("syncagain-auth", async (params) => {
      var _a;
      const token = params["token"];
      const userId = params["user_id"];
      const email = (_a = params["email"]) != null ? _a : "";
      if (!token || !userId) {
        new import_obsidian4.Notice("Auth callback is missing token or user ID.");
        return;
      }
      this.settings.authToken = token;
      this.settings.userId = userId;
      this.settings.userEmail = email;
      await this.saveSettings();
      this.api.setToken(token);
      new import_obsidian4.Notice(`Signed in as ${email || userId}`);
      if (this.settings.syncEnabled && this.settings.serverUrl) {
        this.restartSync();
      }
      this.settingTab.display();
    });
    this.app.workspace.onLayoutReady(async () => {
      this.registerEvent(
        this.app.vault.on("create", (file) => this.tracker.markDirty(file))
      );
      this.registerEvent(
        this.app.vault.on("modify", (file) => this.tracker.markDirty(file))
      );
      this.registerEvent(
        this.app.vault.on(
          "rename",
          (file, oldPath) => this.tracker.handleRename(file, oldPath)
        )
      );
      this.registerEvent(
        this.app.vault.on("delete", (file) => this.tracker.handleDelete(file))
      );
      await this.syncManager.loadState();
      if (this.settings.syncEnabled && this.settings.serverUrl && this.settings.authToken) {
        this.startSync();
      }
    });
    this.settingTab = new SyncAgainSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }
  onunload() {
    this.stopSync();
  }
  // ── Sync lifecycle ────────────────────────────────────────────────────────
  startSync() {
    if (!this.settings.authToken)
      return;
    this.stopSync();
    const intervalMs = this.settings.syncIntervalMinutes * 60 * 1e3;
    void this.syncManager.sync();
    this.syncIntervalId = window.setInterval(() => {
      void this.syncManager.sync();
    }, intervalMs);
    this.eventListener.start();
  }
  stopSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    this.eventListener.stop();
    this.updateStatusBar("off");
  }
  restartSync() {
    if (this.settings.syncEnabled && this.settings.authToken) {
      this.startSync();
    }
  }
  /** Called when the user signs out from the settings tab. */
  signOut() {
    this.api.invalidateToken();
    this.stopSync();
  }
  // ── Auth failure ──────────────────────────────────────────────────────────
  handleAuthFailure() {
    this.settings.authToken = "";
    this.settings.userId = "";
    void this.saveSettings();
    this.stopSync();
    new import_obsidian4.Notice(
      "Session expired or not signed in. Please sign in again in the plugin settings.",
      8e3
    );
  }
  // ── SSE connection status ─────────────────────────────────────────────────
  onSseStatus(status) {
    var _a;
    this.sseStatus = status;
    (_a = this.settingTab) == null ? void 0 : _a.updateConnectionStatus(status);
  }
  // ── Status bar ────────────────────────────────────────────────────────────
  updateStatusBar(status) {
    var _a, _b;
    if (!this.statusBarEl)
      return;
    const pending = (_b = (_a = this.tracker) == null ? void 0 : _a.pendingCount) != null ? _b : 0;
    switch (status) {
      case "syncing":
        this.statusBarEl.setText("Syncing");
        this.statusBarEl.title = "Sync in progress";
        break;
      case "idle":
        if (pending > 0) {
          this.statusBarEl.setText(`${pending} pending`);
          this.statusBarEl.title = `${pending} file${pending === 1 ? "" : "s"} pending upload`;
        } else {
          this.statusBarEl.setText("Synced");
          this.statusBarEl.title = "Vault is up to date";
        }
        break;
      case "error":
        this.statusBarEl.setText("Sync error");
        this.statusBarEl.title = "Last sync failed \u2014 will retry";
        break;
      case "off":
        this.statusBarEl.setText("Sync off");
        this.statusBarEl.title = "Sync is disabled or not signed in";
        break;
    }
  }
  // ── Settings ──────────────────────────────────────────────────────────────
  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
