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
var import_obsidian7 = require("obsidian");

// src/first-sync-modal.ts
var import_obsidian = require("obsidian");
function showConflictResolutionModal(app, conflicts) {
  return new Promise((resolve) => {
    new ConflictResolutionModal(app, conflicts, resolve).open();
  });
}
var ConflictResolutionModal = class extends import_obsidian.Modal {
  constructor(app, conflicts, resolve) {
    super(app);
    this.conflicts = conflicts;
    this.resolve = resolve;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Sync conflicts detected" });
    contentEl.createEl("p", {
      text: `${this.conflicts.length} file${this.conflicts.length === 1 ? "" : "s"} exist both locally and on the server with different content. Choose how to resolve all conflicts:`
    });
    const table = contentEl.createEl("table");
    const headerRow = table.createEl("thead").createEl("tr");
    headerRow.createEl("th", { text: "File" });
    headerRow.createEl("th", { text: "Local modified" });
    headerRow.createEl("th", { text: "Remote modified" });
    const tbody = table.createEl("tbody");
    for (const c of this.conflicts) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: c.path });
      row.createEl("td", { text: new Date(c.localMtime).toLocaleString() });
      row.createEl("td", { text: new Date(c.remoteMtime).toLocaleString() });
    }
    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Keep remote" }).addEventListener("click", () => {
      this.resolved = true;
      this.close();
      this.resolve(/* @__PURE__ */ new Set());
    });
    buttonRow.createEl("button", { text: "Keep local", cls: "mod-cta" }).addEventListener("click", () => {
      this.resolved = true;
      this.close();
      this.resolve(new Set(this.conflicts.map((c) => c.path)));
    });
  }
  onClose() {
    if (!this.resolved) {
      new ConflictConfirmModal(this.app, this.conflicts, this.resolve).open();
    }
    this.contentEl.empty();
  }
};
var ConflictConfirmModal = class extends import_obsidian.Modal {
  constructor(app, conflicts, resolve) {
    super(app);
    this.conflicts = conflicts;
    this.resolve = resolve;
    this.resolved = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Keep remote versions?" });
    contentEl.createEl("p", {
      text: "You have unresolved conflicts. Remote is the authoritative source for a device joining an existing account. All conflicting files will be overwritten with the remote version."
    });
    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
    buttonRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
      this.resolved = true;
      this.close();
      new ConflictResolutionModal(this.app, this.conflicts, this.resolve).open();
    });
    buttonRow.createEl("button", { text: "Confirm", cls: "mod-warning" }).addEventListener("click", () => {
      this.resolved = true;
      this.close();
      this.resolve(/* @__PURE__ */ new Set());
    });
  }
  onClose() {
    if (!this.resolved) {
      this.resolve(/* @__PURE__ */ new Set());
    }
    this.contentEl.empty();
  }
};

// src/vault-picker-modal.ts
var import_obsidian2 = require("obsidian");
function showVaultPickerModal(app, vaults, plugin) {
  new VaultPickerModal(app, vaults, plugin).open();
}
var VaultPickerModal = class extends import_obsidian2.Modal {
  constructor(app, vaults, plugin) {
    super(app);
    this.vaults = vaults;
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Connect to a remote vault" });
    contentEl.createEl("p", {
      text: "Choose an existing vault to sync with this device, or create a new one.",
      cls: "setting-item-description"
    });
    for (const v of this.vaults) {
      new import_obsidian2.Setting(contentEl).setName(v.name).setDesc(`ID: ${v.vault_id}`).addButton(
        (btn) => btn.setButtonText("Connect").setCta().onClick(async () => {
          btn.setButtonText("Connecting\u2026").setDisabled(true);
          try {
            await this.plugin.api.joinVault(v.vault_id);
            this.plugin.settings.remoteVaultId = v.vault_id;
            this.plugin.api.setRemoteVaultId(v.vault_id);
            await this.plugin.saveSettings();
            this.close();
            this.plugin.startSync();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new import_obsidian2.Notice(`Failed to connect to vault: ${msg}`);
            btn.setButtonText("Connect").setDisabled(false);
          }
        })
      );
    }
    new import_obsidian2.Setting(contentEl).setName("Create new vault").setDesc("Start fresh with a new remote vault for this device.").addButton(
      (btn) => btn.setButtonText("Create vault").onClick(async () => {
        btn.setButtonText("Creating\u2026").setDisabled(true);
        try {
          const result = await this.plugin.api.createVault(this.plugin.app.vault.getName());
          this.plugin.settings.remoteVaultId = result.vault_id;
          this.plugin.api.setRemoteVaultId(result.vault_id);
          await this.plugin.saveSettings();
          this.close();
          this.plugin.startSync();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          new import_obsidian2.Notice(`Failed to create vault: ${msg}`);
          btn.setButtonText("Create vault").setDisabled(false);
        }
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/settings.ts
var import_obsidian3 = require("obsidian");
var DEFAULT_ACCOUNT = {
  userId: "",
  userEmail: "",
  authToken: "",
  remoteVaultId: "",
  syncEnabled: false,
  encryptionEnabled: false,
  encryptionPassphrase: "",
  encryptionSalt: "",
  deviceSecret: ""
};
var DEFAULT_SETTINGS = {
  clientId: "",
  serverUrl: "",
  syncIntervalMinutes: 5,
  ...DEFAULT_ACCOUNT
};
var SyncAgainSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.emailInput = "";
    this.passwordInput = "";
    this.signingIn = false;
    this.showSignInForm = false;
    this.connectionStatusEl = null;
    this.syncToggle = null;
    /** Pending timer to reconnect after the server URL field stops changing. */
    this.serverUrlDebounceTimer = null;
    /** Cached remote vault list for the vault picker; null = not yet fetched. */
    this.vaultList = null;
    this.loadingVaults = false;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const serverUrlSetting = new import_obsidian3.Setting(containerEl).setName("Server").setDesc('Base URL of the sync server, e.g. "http://localhost:8080"').addText(
      (text) => text.setPlaceholder("").setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
        const newUrl = value.trim();
        this.plugin.settings.serverUrl = newUrl;
        await this.plugin.saveSettings();
        this.plugin.api.setServerUrl(newUrl);
        this.plugin.stopSync();
        if (this.serverUrlDebounceTimer !== null) {
          clearTimeout(this.serverUrlDebounceTimer);
        }
        this.serverUrlDebounceTimer = setTimeout(() => {
          this.serverUrlDebounceTimer = null;
          this.plugin.restartSync();
        }, 1e3);
      })
    );
    this.connectionStatusEl = serverUrlSetting.nameEl.createEl("span", {
      cls: "syncagain-badge"
    });
    this.renderConnectionStatus(this.plugin.connectionStatus);
    new import_obsidian3.Setting(containerEl).setName("Account").setHeading();
    const isAnonymous = this.plugin.settings.userId === this.plugin.settings.clientId && !this.plugin.settings.userEmail;
    const isSignedIn = Boolean(
      this.plugin.settings.authToken && this.plugin.settings.userId && !isAnonymous
    );
    if (isSignedIn) {
      new import_obsidian3.Setting(containerEl).setName("Signed in").setDesc(this.plugin.settings.userEmail || this.plugin.settings.userId).addButton(
        (btn) => btn.setButtonText("Account detail").onClick(() => {
          const base = this.plugin.settings.serverUrl.replace(/\/+$/, "");
          window.open(`${base}/account`);
        })
      ).addButton(
        (btn) => btn.setButtonText("Sign out").setWarning().onClick(async () => {
          this.vaultList = null;
          this.loadingVaults = false;
          await this.plugin.signOutToAnonymousOrInitial();
        })
      );
      const otherAccounts = Object.values(this.plugin.pluginData.accounts).filter(
        (a) => a.userId && a.userId !== this.plugin.settings.userId
      );
      if (otherAccounts.length > 0) {
        const switchSetting = new import_obsidian3.Setting(containerEl).setName("Switch account").setDesc("Switch to another signed-in account.");
        for (const acct of otherAccounts) {
          switchSetting.addButton(
            (btn) => btn.setButtonText(acct.userEmail || acct.userId).onClick(async () => {
              await this.plugin.switchAccount(acct.userId);
              this.vaultList = null;
              this.loadingVaults = false;
              this.display();
            })
          );
        }
      }
    } else {
      new import_obsidian3.Setting(containerEl).setName("Account").setDesc("Create a new account or sign in to an existing one.").addButton(
        (btn) => btn.setButtonText("Sign up").onClick(() => {
          const base = this.plugin.settings.serverUrl.replace(/\/+$/, "");
          if (!base) {
            new import_obsidian3.Notice("Set the server URL first.");
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
        new import_obsidian3.Setting(containerEl).setName("Email").addText((text) => {
          text.setPlaceholder("").setValue(this.emailInput).onChange((v) => {
            this.emailInput = v.trim();
          });
        });
        new import_obsidian3.Setting(containerEl).setName("Password").addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022").setValue(this.passwordInput).onChange((v) => {
            this.passwordInput = v;
          });
        });
        new import_obsidian3.Setting(containerEl).addButton((btn) => {
          btn.setButtonText(this.signingIn ? "Signing in\u2026" : "Confirm").setCta().setDisabled(this.signingIn).onClick(async () => {
            if (!this.plugin.settings.serverUrl) {
              new import_obsidian3.Notice("Set the server URL first.");
              return;
            }
            if (!this.emailInput) {
              new import_obsidian3.Notice("Please enter your email.");
              return;
            }
            if (!this.passwordInput) {
              new import_obsidian3.Notice("Please enter your password.");
              return;
            }
            this.signingIn = true;
            btn.setButtonText("Signing in\u2026").setDisabled(true);
            try {
              const result = await this.plugin.api.loginWithCredentials(
                this.emailInput,
                this.passwordInput
              );
              await this.plugin.switchAccount(result.userId, {
                authToken: result.token,
                userEmail: result.userEmail
              });
              new import_obsidian3.Notice(`Signed in as ${result.userEmail}`);
              this.passwordInput = "";
              this.signingIn = false;
              this.showSignInForm = false;
              this.display();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new import_obsidian3.Notice(`Sign-in failed: ${msg}`);
              this.signingIn = false;
              btn.setButtonText("Confirm").setDisabled(false);
            }
          });
        });
      }
    }
    new import_obsidian3.Setting(containerEl).setName("Sync").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Enable sync").setDesc("Turn periodic file sync on or off.").addToggle((toggle) => {
      this.syncToggle = toggle;
      toggle.setValue(this.plugin.settings.syncEnabled).onChange(async (value) => {
        this.plugin.settings.syncEnabled = value;
        await this.plugin.saveSettings();
        if (value) {
          this.plugin.startSync();
        } else {
          void this.plugin.syncManager.sync().finally(() => this.plugin.stopSync());
        }
        this.display();
      });
    });
    new import_obsidian3.Setting(containerEl).setName("Sync interval (minutes)").setDesc("How often to run a full sync cycle.").addText(
      (text) => text.setPlaceholder("5").setValue(String(this.plugin.settings.syncIntervalMinutes)).onChange(async (value) => {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed > 0) {
          this.plugin.settings.syncIntervalMinutes = parsed;
          await this.plugin.saveSettings();
          this.plugin.restartSync();
        }
      })
    );
    if (isSignedIn && this.plugin.settings.syncEnabled) {
      new import_obsidian3.Setting(containerEl).setName("Vault").setHeading();
      if (this.plugin.settings.remoteVaultId) {
        new import_obsidian3.Setting(containerEl).setName("Remote vault").setDesc(`Linked \u2014 VaultID: ${this.plugin.settings.remoteVaultId}`);
      } else {
        if (this.loadingVaults) {
          containerEl.createEl("p", { text: "Loading remote vaults\u2026", cls: "setting-item-description" });
        } else if (this.vaultList === null) {
          this.loadingVaults = true;
          this.plugin.api.listVaults().then((vaults) => {
            this.vaultList = vaults;
            this.loadingVaults = false;
            this.display();
          }).catch(() => {
            this.vaultList = [];
            this.loadingVaults = false;
            this.display();
          });
          containerEl.createEl("p", { text: "Loading remote vaults\u2026", cls: "setting-item-description" });
        } else if (this.vaultList.length === 0) {
          new import_obsidian3.Setting(containerEl).setName("Remote vault").setDesc("A new remote vault will be created automatically.");
        } else {
          new import_obsidian3.Setting(containerEl).setName("Remote vault").setDesc("Connect this device to an existing vault.");
          for (const v of this.vaultList) {
            new import_obsidian3.Setting(containerEl).setName(v.name).setDesc(`ID: ${v.vault_id}`).addButton(
              (btn) => btn.setButtonText("Connect").onClick(async () => {
                btn.setButtonText("Connecting\u2026").setDisabled(true);
                try {
                  await this.plugin.api.joinVault(v.vault_id);
                  this.plugin.settings.remoteVaultId = v.vault_id;
                  this.plugin.api.setRemoteVaultId(v.vault_id);
                  await this.plugin.saveSettings();
                  this.vaultList = null;
                  this.plugin.restartSync();
                  this.display();
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  new import_obsidian3.Notice(`Failed to connect: ${msg}`);
                  btn.setButtonText("Connect").setDisabled(false);
                }
              })
            );
          }
          new import_obsidian3.Setting(containerEl).setName("Or create a new vault").setDesc("Start fresh with a new remote vault for this device.").addButton(
            (btn) => btn.setButtonText("Create vault").onClick(async () => {
              btn.setButtonText("Creating\u2026").setDisabled(true);
              try {
                const result = await this.plugin.api.createVault(this.plugin.app.vault.getName());
                this.plugin.settings.remoteVaultId = result.vault_id;
                this.plugin.api.setRemoteVaultId(result.vault_id);
                await this.plugin.saveSettings();
                this.vaultList = null;
                this.plugin.restartSync();
                this.display();
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                new import_obsidian3.Notice(`Failed to create vault: ${msg}`);
                btn.setButtonText("Create vault").setDisabled(false);
              }
            })
          );
        }
      }
    }
    if (isSignedIn) {
      new import_obsidian3.Setting(containerEl).setName("End-to-end encryption").setHeading();
      new import_obsidian3.Setting(containerEl).setName("Encryption status").setDesc(
        "End-to-end encryption can be toggled from the account info page. Files are encrypted with AES-256-GCM before uploading when enabled."
      ).addText((text) => {
        text.setValue(this.plugin.settings.encryptionEnabled ? "Enabled" : "Disabled").setDisabled(true);
        text.inputEl.addClass("syncagain-encryption-status-input");
      });
      new import_obsidian3.Setting(containerEl).setName("Passphrase").setDesc(
        "Never sent to the server. Changing it re-uploads all files with the new key."
      ).addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022").setValue(this.plugin.settings.encryptionPassphrase).onChange(async (value) => {
          this.plugin.settings.encryptionPassphrase = value;
          await this.plugin.saveSettings();
        });
        text.inputEl.addEventListener("blur", () => {
          if (this.plugin.settings.encryptionEnabled && this.plugin.settings.encryptionPassphrase) {
            void this.plugin.reinitEncryption();
          }
        });
      });
    }
  }
  // ── Connection status ──────────────────────────────────────────────────────
  /** Called by the plugin whenever the WebSocket connection state changes. */
  updateConnectionStatus(status) {
    this.plugin.connectionStatus = status;
    this.renderConnectionStatus(status);
  }
  renderConnectionStatus(status) {
    if (!this.connectionStatusEl)
      return;
    const config = {
      connected: { label: "Connected", color: "syncagain-badge-green" },
      connecting: { label: "Connecting\u2026", color: "syncagain-badge-yellow" },
      disconnected: { label: "Disconnected", color: "syncagain-badge-gray" }
    };
    const { label, color } = config[status];
    this.connectionStatusEl.setText(label);
    this.connectionStatusEl.setAttribute("class", `syncagain-badge ${color}`);
  }
};

// src/file-tracker.ts
var import_obsidian4 = require("obsidian");
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
    if (!(file instanceof import_obsidian4.TFile))
      return;
    if (file.path.startsWith(".trash/"))
      return;
    if (this.suppressOnce.delete(file.path))
      return;
    this.dirtyFiles.set(file.path, {
      path: file.path,
      modifiedAt: Date.now()
    });
  }
  markDirtyByPath(path) {
    if (path.startsWith(".trash/"))
      return;
    this.dirtyFiles.set(path, { path, modifiedAt: Date.now() });
  }
  handleRename(file, oldPath) {
    if (!(file instanceof import_obsidian4.TFile))
      return;
    this.dirtyFiles.delete(oldPath);
    this.markDirty(file);
  }
  handleDelete(file) {
    if (!(file instanceof import_obsidian4.TFile))
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
  /** Returns true if the path is currently queued for upload. */
  hasPendingUpload(path) {
    return this.dirtyFiles.has(path);
  }
  get pendingCount() {
    return this.dirtyFiles.size;
  }
};

// src/api-client.ts
var import_obsidian5 = require("obsidian");
var ApiError = class extends Error {
  constructor(status, message, feature) {
    super(message);
    this.status = status;
    this.feature = feature;
    this.name = "ApiError";
  }
};
var ApiClient = class {
  constructor(serverUrl, clientId, token = null, onAuthFailure) {
    this.serverUrl = serverUrl;
    this.clientId = clientId;
    this.onAuthFailure = onAuthFailure;
    this.remoteVaultId = "";
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
  /** Set the vault namespace prefix used for all file keys. */
  setRemoteVaultId(id) {
    this.remoteVaultId = id;
  }
  /** Replace the base server URL (e.g. when the user edits it in settings). */
  setServerUrl(url) {
    this.serverUrl = url;
  }
  /**
   * Convert a vault-local key to the server-side key by prepending the vault prefix.
   * Throws if remoteVaultId is not set — callers must wait for the vault handshake
   * before issuing any keyed operation, or files would land outside the vault namespace.
   */
  remoteKey(key) {
    if (!this.remoteVaultId) {
      throw new Error(
        "remoteVaultId is not set \u2014 vault handshake must complete before any file/lock operation"
      );
    }
    return `${this.remoteVaultId}/${key}`;
  }
  /**
   * Given a key from a server event (post user-prefix strip), return the vault-local
   * key, or null if the key does not belong to this vault. Returns null when
   * remoteVaultId is not yet set so unprefixed events cannot leak through.
   */
  resolveEventKey(key) {
    if (!this.remoteVaultId)
      return null;
    const prefix = `${this.remoteVaultId}/`;
    if (!key.startsWith(prefix))
      return null;
    return key.slice(prefix.length);
  }
  // ── Auth ────────────────────────────────────────────────────────────────
  /**
   * Register a new anonymous account using only client_id + device_secret.
   * The server uses client_id as user_id and hashes device_secret.
   * Returns `{ token, userId }` on success.
   */
  async registerAnonymous(clientId, deviceSecret) {
    var _a;
    const res = await (0, import_obsidian5.requestUrl)({
      url: `${this.serverUrl}/api/auth/register`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, device_secret: deviceSecret }),
      throw: false
    });
    if (res.status >= 200 && res.status < 300) {
      const data = res.json;
      this.token = data.token;
      return { token: data.token, userId: data.user_id };
    }
    let msg;
    try {
      msg = (_a = res.json.error) != null ? _a : String(res.status);
    } catch (e) {
      msg = String(res.status);
    }
    throw new ApiError(res.status, msg);
  }
  /**
   * Re-authenticate an anonymous account using client_id + device_secret.
   * Used automatically when the JWT expires on an anonymous account.
   * Returns `{ token, userId }` on success.
   */
  async loginAnonymous(clientId, deviceSecret) {
    var _a;
    const res = await (0, import_obsidian5.requestUrl)({
      url: `${this.serverUrl}/api/auth/login`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, device_secret: deviceSecret }),
      throw: false
    });
    if (res.status >= 200 && res.status < 300) {
      const data = res.json;
      this.token = data.token;
      return { token: data.token, userId: data.user_id };
    }
    let msg;
    try {
      msg = (_a = res.json.error) != null ? _a : String(res.status);
    } catch (e) {
      msg = String(res.status);
    }
    throw new ApiError(res.status, msg);
  }
  /**
   * Sign in with email + password and store the returned token.
   * Used by the inline sign-in form in the settings tab.
   * Returns `{ token, userId, userEmail }` on success.
   */
  async loginWithCredentials(email, password) {
    var _a;
    const res = await (0, import_obsidian5.requestUrl)({
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
    const res = await (0, import_obsidian5.requestUrl)({
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
  // ── Vault registry ───────────────────────────────────────────────────────
  /**
   * Vault handshake — called once on first startup when no remoteVaultId is stored.
   * If the account has no vaults, the server auto-creates one and returns
   * `{ created: true, vault: { vault_id, name } }`.
   * If vaults exist, the server returns `{ created: false, vaults: [...] }` and
   * the caller must show a picker.
   */
  async vaultHandshake(localName) {
    return this.request(
      "POST",
      "/api/vaults/handshake",
      JSON.stringify({ local_name: localName }),
      { "Content-Type": "application/json" }
    );
  }
  /**
   * Create a new remote vault. The server generates the vault UUID.
   * Returns `{ vault_id, name }` on success.
   */
  async createVault(localName) {
    return this.request(
      "POST",
      "/api/vaults",
      JSON.stringify({ name: localName }),
      { "Content-Type": "application/json" }
    );
  }
  /**
   * Register this device with an existing vault.
   * Upserts a vault_devices row for the calling client_id + vault_id.
   * Returns `{ vault_id }` on success; throws ApiError 404 if the vault
   * does not belong to the authenticated user.
   */
  async joinVault(vaultId) {
    return this.request(
      "POST",
      `/api/vaults/${encodeURIComponent(vaultId)}/join`
    );
  }
  /**
   * List all remote vaults registered to this account.
   * Server returns the array directly (not wrapped).
   */
  async listVaults() {
    return this.request("GET", "/api/vaults");
  }
  /**
   * Register or update the local folder name for this vault on the server,
   * and upsert the device association. Called on every sync start so the
   * server always has the current local folder name (handles OS-level renames)
   * and a fresh `last_seen` timestamp for this device.
   *
   * Silently no-ops when remoteVaultId is empty (vault not linked yet).
   */
  async registerVault(vaultName) {
    if (!this.remoteVaultId)
      return;
    try {
      await this.request(
        "PUT",
        `/api/vaults/${encodeURIComponent(this.remoteVaultId)}`,
        JSON.stringify({ name: vaultName }),
        { "Content-Type": "application/json" }
      );
    } catch (err) {
      console.warn("[SyncAgain] Failed to register vault name:", err);
    }
  }
  // ── Account ──────────────────────────────────────────────────────────────
  /** Fetch the authenticated user's account info, including enabled features. */
  async getAccount() {
    return this.request("GET", "/api/account");
  }
  // ── Files ────────────────────────────────────────────────────────────────
  async listFiles() {
    if (!this.remoteVaultId) {
      throw new Error(
        "remoteVaultId is not set \u2014 vault handshake must complete before listing files"
      );
    }
    const data = await this.request("GET", "/api/files");
    const prefix = `${this.remoteVaultId}/`;
    return data.files.filter((f) => f.key.startsWith(prefix)).map((f) => ({ ...f, key: f.key.slice(prefix.length) }));
  }
  async downloadFile(key) {
    var _a, _b;
    if (!this.token) {
      (_a = this.onAuthFailure) == null ? void 0 : _a.call(this);
      throw new ApiError(401, "Not signed in.");
    }
    const res = await (0, import_obsidian5.requestUrl)({
      url: `${this.serverUrl}/api/files/download?key=${encodeURIComponent(this.remoteKey(key))}`,
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
  /**
   * Upload `data` to `key`. The caller must hold the lock before calling this.
   * Pass `plaintextMd5` when E2EE is enabled so the server can store it for
   * first-sync dedup on new devices.
   */
  async uploadFile(key, data, plaintextMd5, contentType = "application/octet-stream") {
    var _a, _b, _c;
    if (!this.token) {
      (_a = this.onAuthFailure) == null ? void 0 : _a.call(this);
      throw new ApiError(401, "Not signed in.");
    }
    const serverKey = this.remoteKey(key);
    const boundary = `----SyncAgainBoundary${Date.now()}`;
    const enc = new TextEncoder();
    const keyPart = enc.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="key"\r
\r
${serverKey}\r
`
    );
    const plaintextMd5Part = plaintextMd5 ? enc.encode(`--${boundary}\r
Content-Disposition: form-data; name="plaintext_md5"\r
\r
${plaintextMd5}\r
`) : new Uint8Array(0);
    const fileHeader = enc.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${serverKey}"\r
Content-Type: ${contentType}\r
\r
`
    );
    const footer = enc.encode(`\r
--${boundary}--\r
`);
    const fileBytes = new Uint8Array(data);
    const body = new Uint8Array(keyPart.length + plaintextMd5Part.length + fileHeader.length + fileBytes.length + footer.length);
    body.set(keyPart, 0);
    body.set(plaintextMd5Part, keyPart.length);
    body.set(fileHeader, keyPart.length + plaintextMd5Part.length);
    body.set(fileBytes, keyPart.length + plaintextMd5Part.length + fileHeader.length);
    body.set(footer, keyPart.length + plaintextMd5Part.length + fileHeader.length + fileBytes.length);
    const res = await (0, import_obsidian5.requestUrl)({
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
    if (res.status === 402) {
      let feature;
      try {
        feature = res.json.feature;
      } catch (e) {
      }
      throw new ApiError(402, "feature_not_enabled", feature);
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
    await this.request("DELETE", `/api/files?key=${encodeURIComponent(this.remoteKey(key))}`);
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
      JSON.stringify({ client_id: this.clientId, files: keys.map((k) => this.remoteKey(k)) }),
      { "Content-Type": "application/json" }
    );
  }
  async releaseLocks(keys) {
    await this.request(
      "DELETE",
      "/api/locks",
      JSON.stringify({ client_id: this.clientId, files: keys.map((k) => this.remoteKey(k)) }),
      { "Content-Type": "application/json" }
    );
  }
  async listLocks() {
    const data = await this.request("GET", "/api/locks");
    return data.locks;
  }
  // ── WebSocket control channel ────────────────────────────────────────────
  /**
   * Returns the WebSocket URL for the control channel endpoint.
   * The scheme is converted from http(s) → ws(s) automatically.
   * The auth token is appended as a query parameter when available; the
   * connection is always attempted regardless of auth state so the status
   * badge reflects server reachability independently of login.
   */
  buildWsUrl() {
    if (!this.serverUrl)
      return null;
    const base = this.serverUrl.replace(/^http/, "ws");
    const url = `${base}/api/ws`;
    const params = new URLSearchParams();
    if (this.token)
      params.set("token", this.token);
    if (this.remoteVaultId)
      params.set("vault_id", this.remoteVaultId);
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }
  /** Fetch the full server config (entitlements + vault state + config version). */
  async getConfig() {
    return this.request("GET", "/api/config");
  }
  /**
   * Set or rotate vault E2EE state on the server.
   * Called by the E2EE negotiator when registering E2EE for the first time or
   * after a passphrase rotation on this device.
   */
  async putVaultEncryption(remoteVaultId, payload) {
    await this.request(
      "PUT",
      `/api/vaults/${encodeURIComponent(remoteVaultId)}/encryption`,
      JSON.stringify(payload),
      { "Content-Type": "application/json" }
    );
  }
  // ── SSE event stream (legacy — kept for reference) ───────────────────────
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
  constructor(vault, fileManager, api, tracker, encryption = null) {
    this.vault = vault;
    this.fileManager = fileManager;
    this.api = api;
    this.tracker = tracker;
    this.state = EMPTY_SYNC_STATE;
    this.syncing = false;
    this.startupScanDone = false;
    /** True when no sync-state.json was found on load — signals a fresh device. */
    this.isNewDevice = false;
    /** Tracks which features have already triggered the one-shot notice. */
    this.featureErrorNotified = /* @__PURE__ */ new Set();
    this.encryption = encryption;
  }
  /** Replace the active encryption instance (called when E2EE settings change). */
  setEncryption(enc) {
    this.encryption = enc;
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
      this.isNewDevice = true;
    }
  }
  async saveState() {
    await this.vault.adapter.write(this.stateFile, JSON.stringify(this.state));
  }
  /**
   * Clear all synced-file state and mark every vault file dirty for re-upload.
   * Called when the E2EE setting changes so all files are re-uploaded with the
   * new encryption mode (or without encryption if it was disabled).
   */
  async resetSyncState() {
    this.state = { ...EMPTY_SYNC_STATE };
    for (const file of this.vault.getFiles()) {
      if (!this.isExcluded(file.path)) {
        this.tracker.markDirtyByPath(file.path);
      }
    }
    await this.saveState();
  }
  /**
   * Clear tombstones for paths that exist on disk again.
   *
   * deletedFiles prevents reconcileRemote from re-downloading files the user
   * deleted locally, but it has no natural expiry. If the user re-creates a
   * file at a tombstoned path, every sync step would filter it out forever.
   */
  reconcileTombstones() {
    if (this.state.deletedFiles.length === 0)
      return;
    this.state.deletedFiles = this.state.deletedFiles.filter(
      (path) => !this.vault.getFileByPath(path)
    );
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
  // ── Sync cycle ─────────────────────────────────────────────────────────────
  /**
   * First-sync flow for a new device joining an account that already has files.
   *
   * Compares every local file against the remote list:
   * - Same content MD5  → pre-populate state; no transfer needed.
   * - Different content → collect as conflict; prompt user to keep local or remote.
   * - Local only        → mark dirty; uploadLocalFile will push it.
   * - Remote only       → left for reconcileRemote to download.
   *
   * When E2EE is enabled, `remote.plaintext_md5` (stored by the uploading client)
   * is used for comparison so the new device can match local plaintext against
   * the server-stored plaintext MD5 without downloading any ciphertext.
   * If `plaintext_md5` is absent (legacy unencrypted file), falls back to `remote.md5`.
   */
  async runFirstSyncFlow(remoteFiles) {
    var _a;
    const remoteMap = new Map(remoteFiles.map((f) => [f.key, f]));
    const conflicts = [];
    for (const file of this.vault.getFiles()) {
      if (this.isExcluded(file.path))
        continue;
      const remote = remoteMap.get(file.path);
      if (!remote) {
        this.tracker.markDirtyByPath(file.path);
        continue;
      }
      const data = await this.vault.readBinary(file);
      const localMd5 = md5(data);
      const remoteContentMd5 = (_a = remote.plaintext_md5) != null ? _a : remote.md5;
      if (localMd5 === remoteContentMd5) {
        this.state.files[file.path] = {
          md5: remote.md5,
          syncedAt: Date.now(),
          mtime: file.stat.mtime,
          ...remote.plaintext_md5 ? { plaintextMd5: localMd5 } : {}
        };
      } else {
        conflicts.push({
          path: file.path,
          localMtime: file.stat.mtime,
          remoteMtime: remote.last_modified
        });
      }
    }
    if (conflicts.length === 0)
      return;
    const keepLocalPaths = this.onFirstSyncConflict ? await this.onFirstSyncConflict(conflicts) : /* @__PURE__ */ new Set();
    for (const conflict of conflicts) {
      if (keepLocalPaths.has(conflict.path)) {
        this.tracker.markDirtyByPath(conflict.path);
      }
    }
  }
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
      if (this.isExcluded(file.path))
        continue;
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
    this.reconcileTombstones();
    if (!this.startupScanDone) {
      if (this.isNewDevice) {
        const remoteFiles2 = await this.api.listFiles();
        if (remoteFiles2.length > 0) {
          await this.runFirstSyncFlow(remoteFiles2);
        } else {
          this.detectOfflineChanges();
        }
      } else {
        this.detectOfflineChanges();
      }
      this.startupScanDone = true;
    }
    const remoteSnapshot = await this.api.listFiles();
    const remoteSnapshotKeys = new Set(remoteSnapshot.map((f) => f.key));
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
      if (remoteSnapshot.length > 0 && this.state.files[tracked.path] && !remoteSnapshotKeys.has(tracked.path))
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
    try {
      await this.reconcileRemote(remoteFiles);
    } catch (err) {
      console.error("[SyncAgain] reconcileRemote failed:", err);
    }
    try {
      await this.uploadAbsentFiles(remoteFiles);
    } catch (err) {
      console.error("[SyncAgain] uploadAbsentFiles failed:", err);
    }
    await this.saveState();
  }
  // ── Upload ─────────────────────────────────────────────────────────────────
  async uploadLocalFile(path) {
    var _a, _b, _c;
    const file = this.vault.getFileByPath(path);
    if (!file) {
      return;
    }
    const plainData = await this.vault.readBinary(file);
    const plaintextHash = md5(plainData);
    const known = this.state.files[path];
    if (((_a = known == null ? void 0 : known.plaintextMd5) != null ? _a : known == null ? void 0 : known.md5) === plaintextHash)
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
      let uploadData;
      let plaintextMd5;
      if (this.encryption) {
        uploadData = await this.encryption.encrypt(plainData);
        plaintextMd5 = plaintextHash;
      } else {
        uploadData = plainData;
      }
      const ciphertextHash = this.encryption ? md5(uploadData) : plaintextHash;
      try {
        await this.api.uploadFile(path, uploadData, plaintextMd5);
      } catch (uploadErr) {
        if (uploadErr instanceof ApiError && uploadErr.status === 402) {
          const feature = (_b = uploadErr.feature) != null ? _b : "unknown";
          if (!this.featureErrorNotified.has(feature)) {
            this.featureErrorNotified.add(feature);
            (_c = this.onFeatureNotEnabled) == null ? void 0 : _c.call(this, feature);
          }
          if (feature === "e2ee") {
            this.encryption = null;
          }
          this.tracker.markDirtyByPath(path);
          return;
        }
        throw uploadErr;
      }
      const entry = { md5: ciphertextHash, syncedAt: Date.now(), mtime: file.stat.mtime };
      if (plaintextMd5 !== void 0)
        entry.plaintextMd5 = plaintextMd5;
      this.state.files[path] = entry;
    } finally {
      try {
        await this.api.releaseLocks([path]);
      } catch (e) {
      }
    }
  }
  /**
   * Handle a locally deleted file.
   *
   * Acquires a lock, deletes the file from the server, and releases the lock.
   * Other clients detect the deletion via absence on the next reconcile cycle.
   * Files that were never uploaded are marked deleted locally without a server call.
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
      await this.api.deleteFile(path);
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
    const deletedSet = new Set(this.state.deletedFiles);
    const remoteKeys = new Set(remoteFiles.map((f) => f.key));
    for (const remote of remoteFiles) {
      if (deletedSet.has(remote.key))
        continue;
      const known = this.state.files[remote.key];
      const existsLocally = Boolean(this.vault.getFileByPath(remote.key));
      if ((known == null ? void 0 : known.md5) === remote.md5 && existsLocally)
        continue;
      if (this.tracker.hasPendingUpload(remote.key))
        continue;
      try {
        await this.downloadKey(remote.key, remote);
      } catch (err) {
        console.error(`[SyncAgain] Failed to download '${remote.key}':`, err);
      }
    }
    const trackedKeys = Object.keys(this.state.files);
    if (remoteFiles.length > 0 || trackedKeys.length === 0) {
      for (const key of trackedKeys) {
        if (!remoteKeys.has(key) && !deletedSet.has(key)) {
          try {
            await this.deleteLocalFile(key);
          } catch (err) {
            console.error(`[SyncAgain] Failed to delete local '${key}':`, err);
          }
        }
      }
    }
  }
  // ── Upload absent files ────────────────────────────────────────────────────
  /**
   * Upload vault files that exist locally but have no corresponding entry on
   * the server. This is a safety net for files that slipped through dirty
   * tracking (e.g. created while sync was disabled) and a "flush" step run
   * before sync is disabled.
   */
  async uploadAbsentFiles(remoteFiles) {
    const remoteKeySet = new Set(remoteFiles.map((f) => f.key));
    const deletedSet = new Set(this.state.deletedFiles);
    for (const file of this.vault.getFiles()) {
      if (this.isExcluded(file.path))
        continue;
      if (deletedSet.has(file.path))
        continue;
      if (remoteKeySet.has(file.path))
        continue;
      delete this.state.files[file.path];
      try {
        await this.uploadLocalFile(file.path);
      } catch (err) {
        console.error(`[SyncAgain] Failed to upload absent file '${file.path}':`, err);
      }
    }
  }
  async downloadKey(key, remote) {
    var _a, _b;
    const rawData = await this.api.downloadFile(key);
    const isEncrypted = remote ? Boolean(remote.plaintext_md5) : Boolean(this.encryption);
    let plainData;
    if (isEncrypted && this.encryption) {
      try {
        plainData = await this.encryption.decrypt(rawData);
      } catch (e) {
        plainData = rawData;
      }
    } else {
      plainData = rawData;
    }
    this.tracker.suppressNext(key);
    const existingFile = this.vault.getFileByPath(key);
    if (existingFile) {
      await this.vault.modifyBinary(existingFile, plainData);
    } else {
      await this.ensureFolder(key);
      await this.vault.createBinary(key, plainData);
    }
    const writtenFile = this.vault.getFileByPath(key);
    const ciphertextMd5 = (_a = remote == null ? void 0 : remote.md5) != null ? _a : md5(rawData);
    const plaintextMd5 = isEncrypted ? md5(plainData) : void 0;
    const entry = {
      md5: ciphertextMd5,
      syncedAt: Date.now(),
      mtime: (_b = writtenFile == null ? void 0 : writtenFile.stat.mtime) != null ? _b : Date.now()
    };
    if (plaintextMd5 !== void 0)
      entry.plaintextMd5 = plaintextMd5;
    this.state.files[key] = entry;
  }
  async deleteLocalFile(key) {
    const file = this.vault.getFileByPath(key);
    if (file) {
      this.tracker.suppressNext(key);
      await this.fileManager.trashFile(file);
    }
    delete this.state.files[key];
  }
  /** Returns true for paths that should never be synced (Obsidian's local trash folder). */
  isExcluded(path) {
    return path.startsWith(".trash/");
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

// src/control-channel.ts
var PING_INTERVAL_MS = 3e4;
var PONG_TIMEOUT_MS = PING_INTERVAL_MS * 2;
var ControlChannel = class {
  constructor(api, ownClientId, onRemoteChange, onConfig, onConnectionStatus) {
    this.api = api;
    this.ownClientId = ownClientId;
    this.onRemoteChange = onRemoteChange;
    this.onConfig = onConfig;
    this.onConnectionStatus = onConnectionStatus;
    this.ws = null;
    this.stopped = false;
    this.retryMs = 1e3;
    this.maxRetryMs = 3e4;
    this.retryTimeout = null;
    this.pingInterval = null;
    this.pongTimeout = null;
    this.seq = 0;
    this.lastConfigVersion = 0;
  }
  start() {
    var _a;
    this.stopped = false;
    this.clearAllTimers();
    this.closeWs();
    (_a = this.onConnectionStatus) == null ? void 0 : _a.call(this, "connecting");
    this.connect();
  }
  stop() {
    var _a;
    this.stopped = true;
    this.clearAllTimers();
    this.closeWs();
    (_a = this.onConnectionStatus) == null ? void 0 : _a.call(this, "disconnected");
  }
  connect() {
    var _a;
    if (this.stopped)
      return;
    const url = this.api.buildWsUrl();
    if (!url) {
      (_a = this.onConnectionStatus) == null ? void 0 : _a.call(this, "disconnected");
      return;
    }
    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        var _a2;
        this.retryMs = 1e3;
        (_a2 = this.onConnectionStatus) == null ? void 0 : _a2.call(this, "connected");
        this.sendPing(0);
        this.startPingLoop();
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
        }
      };
      ws.onerror = () => {
        var _a2;
        (_a2 = this.onConnectionStatus) == null ? void 0 : _a2.call(this, "connecting");
      };
      ws.onclose = () => {
        var _a2;
        this.ws = null;
        this.clearPingLoop();
        if (!this.stopped) {
          (_a2 = this.onConnectionStatus) == null ? void 0 : _a2.call(this, "connecting");
          this.scheduleReconnect();
        }
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  }
  handleMessage(msg) {
    if (msg.type === "pong") {
      this.clearPongTimeout();
      this.lastConfigVersion = msg.config_version;
      if (msg.config) {
        this.onConfig(msg.config);
      }
    } else if (msg.type === "file_changed" || msg.type === "file_deleted") {
      if (msg.client_id === this.ownClientId)
        return;
      this.onRemoteChange({ event: msg.type, key: msg.path });
    }
  }
  sendPing(overrideConfigVersion) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
      return;
    const ping = {
      type: "ping",
      seq: ++this.seq,
      last_config_version: overrideConfigVersion != null ? overrideConfigVersion : this.lastConfigVersion
    };
    this.ws.send(JSON.stringify(ping));
    this.clearPongTimeout();
    this.pongTimeout = setTimeout(() => {
      var _a;
      (_a = this.onConnectionStatus) == null ? void 0 : _a.call(this, "disconnected");
      this.closeWs();
    }, PONG_TIMEOUT_MS);
  }
  startPingLoop() {
    this.clearPingLoop();
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, PING_INTERVAL_MS);
  }
  clearPingLoop() {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.clearPongTimeout();
  }
  clearPongTimeout() {
    if (this.pongTimeout !== null) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }
  clearAllTimers() {
    this.clearPingLoop();
    if (this.retryTimeout !== null) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
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
  closeWs() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
};

// src/vault-encryption.ts
var _VaultEncryption = class {
  constructor(key) {
    this.key = key;
  }
  /**
   * Derive an AES-256-GCM key from `passphrase` and the hex-encoded `saltHex`.
   * `saltHex` must be the string produced by `VaultEncryption.generateSalt()`.
   */
  static async create(passphrase, saltHex) {
    const salt = hexToBytes(saltHex);
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    return new _VaultEncryption(key);
  }
  /** Generate a fresh random 32-byte salt, returned as a hex string for storage in settings. */
  static generateSalt() {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  }
  /**
   * Encrypt `data`. Output layout: `[ 12-byte IV | ciphertext | 16-byte GCM auth tag ]`.
   * A fresh random IV is generated for every call, so the same plaintext produces
   * different ciphertext each time (semantic security).
   */
  async encrypt(data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, data);
    const out = new Uint8Array(12 + ciphertext.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ciphertext), 12);
    return out.buffer;
  }
  /**
   * Decrypt data produced by `encrypt`.
   * Throws a `DOMException` if the data is malformed or the GCM auth tag fails —
   * the caller can catch this to detect files uploaded without encryption.
   */
  async decrypt(data) {
    const bytes = new Uint8Array(data);
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, this.key, ciphertext);
  }
  /**
   * Produce an opaque key verification token by encrypting a known plaintext with
   * the derived key. The server stores this token and returns it in vault config so
   * any device can verify its local passphrase derives the same key — without the
   * server ever learning the key.
   *
   * The token is base64-encoded ciphertext (IV + ciphertext + GCM auth tag).
   */
  async createKeyVerificationToken() {
    const plaintext = new TextEncoder().encode(_VaultEncryption.VERIFICATION_PLAINTEXT);
    const ciphertext = await this.encrypt(plaintext.buffer);
    return btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  }
  /**
   * Verify that `token` (produced by `createKeyVerificationToken` with the correct key)
   * decrypts to the expected plaintext. Returns `true` if the key matches, `false` otherwise.
   */
  async verifyKeyToken(token) {
    try {
      const bytes = Uint8Array.from(atob(token), (c) => c.charCodeAt(0));
      const plaintext = await this.decrypt(bytes.buffer);
      const decoded = new TextDecoder().decode(plaintext);
      return decoded === _VaultEncryption.VERIFICATION_PLAINTEXT;
    } catch (e) {
      return false;
    }
  }
};
var VaultEncryption = _VaultEncryption;
/** Known plaintext used for key verification tokens. */
VaultEncryption.VERIFICATION_PLAINTEXT = "syncagain-e2ee-v1";
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// src/feature-negotiation.ts
var import_obsidian6 = require("obsidian");
var FeatureGate = class {
  static validateConsistency(serverFeatures, settings, plugin) {
    const locallyEnabled = {
      e2ee: settings.encryptionEnabled
    };
    for (const [feature, enabled] of Object.entries(locallyEnabled)) {
      if (enabled && !serverFeatures.includes(feature)) {
        plugin.disableFeature(feature);
        new import_obsidian6.Notice(
          `"${feature}" is not available on your current plan and has been disabled.`,
          8e3
        );
      }
    }
  }
};
var FeatureNegotiationCoordinator = class {
  constructor() {
    this.negotiators = [];
  }
  register(negotiator) {
    this.negotiators.push(negotiator);
  }
  async negotiateAll(serverFeatures, vaultState, local, plugin) {
    const results = [];
    for (const negotiator of this.negotiators) {
      if (!serverFeatures.includes(negotiator.featureId))
        continue;
      const result = await negotiator.negotiate(vaultState, local, plugin);
      results.push(result);
    }
    return results;
  }
};

// src/features/e2ee-negotiator.ts
var E2EENegotiator = class {
  constructor() {
    this.featureId = "e2ee";
  }
  async negotiate(vaultState, local, plugin) {
    const e2ee = vaultState.e2ee;
    if (!e2ee) {
      if (local.encryptionEnabled && local.encryptionPassphrase) {
        try {
          if (!local.encryptionSalt) {
            local.encryptionSalt = VaultEncryption.generateSalt();
            await plugin.saveSettings();
          }
          const enc = await VaultEncryption.create(local.encryptionPassphrase, local.encryptionSalt);
          const token = await enc.createKeyVerificationToken();
          await plugin.api.putVaultEncryption(local.remoteVaultId, {
            enabled: true,
            epoch: 1,
            key_verification_token: token
          });
        } catch (err) {
          return {
            status: "blocked",
            reason: `Failed to register E2EE with server: ${err instanceof Error ? err.message : String(err)}`
          };
        }
      }
      return { status: "ok" };
    }
    if (e2ee.enabled) {
      if (!local.encryptionPassphrase) {
        return {
          status: "blocked",
          reason: "E2EE is active on this vault \u2014 enter your passphrase in plugin settings to continue."
        };
      }
      if (!local.encryptionSalt) {
        return {
          status: "blocked",
          reason: "E2EE is active but no local salt is stored. Re-enter your passphrase in plugin settings."
        };
      }
      try {
        const enc = await VaultEncryption.create(local.encryptionPassphrase, local.encryptionSalt);
        const valid = await enc.verifyKeyToken(e2ee.key_verification_token);
        if (!valid) {
          return {
            status: "blocked",
            reason: "E2EE passphrase is incorrect or was rotated on another device. Update your passphrase in plugin settings."
          };
        }
        if (!local.encryptionEnabled) {
          local.encryptionEnabled = true;
          await plugin.saveSettings();
          return { status: "reconfigured" };
        }
        return { status: "ok" };
      } catch (e) {
        return { status: "blocked", reason: "Failed to verify E2EE passphrase." };
      }
    }
    if (local.encryptionEnabled) {
      local.encryptionEnabled = false;
      await plugin.saveSettings();
      return { status: "reconfigured" };
    }
    return { status: "ok" };
  }
};

// src/main.ts
var SyncAgainPlugin = class extends import_obsidian7.Plugin {
  constructor() {
    super(...arguments);
    this.connectionStatus = "disconnected";
    /** Feature names granted to this account by the server (e.g. ["e2ee"]). */
    this.accountFeatures = [];
    /** Most recent server config received via WebSocket pong. */
    this.serverConfig = null;
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
    this.api.setRemoteVaultId(this.settings.remoteVaultId);
    const enc = await this.buildEncryption();
    this.syncManager = new SyncManager(this.app.vault, this.app.fileManager, this.api, this.tracker, enc);
    this.syncManager.onStatus = (status) => this.updateStatusBar(status);
    this.syncManager.onFirstSyncConflict = (conflicts) => showConflictResolutionModal(this.app, conflicts);
    this.syncManager.onFeatureNotEnabled = (feature) => this.handleFeatureNotEnabled(feature);
    this.coordinator = new FeatureNegotiationCoordinator();
    this.coordinator.register(new E2EENegotiator());
    this.controlChannel = new ControlChannel(
      this.api,
      this.settings.clientId,
      (event) => {
        if (!event.key)
          return;
        const localKey = this.api.resolveEventKey(event.key);
        if (localKey === null)
          return;
        if (event.event === "file_changed") {
          void this.syncManager.syncKey(localKey);
        }
      },
      (config) => {
        void this.onConfig(config);
      },
      (status) => this.onControlChannelStatus(status)
    );
    this.registerObsidianProtocolHandler("syncagain-auth", async (params) => {
      var _a;
      const token = params["token"];
      const userId = params["user_id"];
      const email = (_a = params["email"]) != null ? _a : "";
      if (!token || !userId) {
        new import_obsidian7.Notice("Auth callback is missing token or user ID.");
        return;
      }
      await this.switchAccount(userId, { authToken: token, userEmail: email });
      new import_obsidian7.Notice(`Signed in as ${email || userId}`);
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
      if (this.settings.serverUrl) {
        this.connectControlChannel();
      }
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
  /**
   * Connect the WebSocket control channel.
   * Only connects when sync is enabled — the channel is pointless when sync is off.
   */
  connectControlChannel() {
    if (!this.settings.serverUrl || !this.settings.syncEnabled)
      return;
    this.controlChannel.start();
  }
  /**
   * Start the sync loop (upload/download cycle + interval).
   * The control channel must already be connected (or connecting) before this
   * is called. If no vault is linked yet, defers to initVaultIfNeeded which
   * will call startSync() again once a vault is available.
   * If the user is not signed in, triggers anonymous registration first.
   */
  startSync() {
    if (!this.settings.authToken) {
      void this.doRegisterAnonymous();
      return;
    }
    this.connectControlChannel();
    if (!this.settings.remoteVaultId) {
      void this.initVaultIfNeeded();
      return;
    }
    this.clearSyncInterval();
    void this.api.registerVault(this.app.vault.getName());
    this.startSyncLoop();
  }
  async initVaultIfNeeded() {
    var _a;
    try {
      const result = await this.api.vaultHandshake(this.app.vault.getName());
      if (result.created) {
        this.settings.remoteVaultId = result.vault.vault_id;
        this.api.setRemoteVaultId(result.vault.vault_id);
        await this.saveSettings();
        this.startSync();
      } else {
        showVaultPickerModal(this.app, result.vaults, this);
      }
    } catch (err) {
      console.warn("[SyncAgain] Vault handshake failed:", err);
      new import_obsidian7.Notice("Failed to connect to remote vault. Check server URL and try again.", 8e3);
      (_a = this.settingTab) == null ? void 0 : _a.display();
    }
  }
  /**
   * Register a new anonymous account, then start sync.
   * Called by startSync() when no authToken is present.
   * No-ops silently if serverUrl is not set.
   */
  async doRegisterAnonymous() {
    if (!this.settings.serverUrl)
      return;
    try {
      const deviceSecret = crypto.randomUUID();
      const result = await this.api.registerAnonymous(this.settings.clientId, deviceSecret);
      await this.switchAccount(result.userId, {
        authToken: result.token,
        deviceSecret,
        syncEnabled: true
      });
      new import_obsidian7.Notice("Sync started. Create an account to sync across multiple devices.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new import_obsidian7.Notice(`Anonymous registration failed: ${msg}`);
    }
  }
  stopSync() {
    this.clearSyncInterval();
    this.controlChannel.stop();
    this.updateStatusBar("off");
  }
  restartSync() {
    this.connectControlChannel();
    if (this.settings.authToken && this.settings.syncEnabled) {
      this.startSync();
    }
  }
  /** Called when the user signs out from the settings tab. */
  signOut() {
    this.api.invalidateToken();
    this.stopSync();
  }
  // ── Config + feature negotiation ──────────────────────────────────────────
  /**
   * Called by ControlChannel each time a pong delivers a (new) server config.
   * Runs on every connect / reconnect since the control channel always sends
   * last_config_version: 0 on (re)connect to force a full config delivery.
   *
   * Responsibilities:
   *   3. FeatureGate.validateConsistency — generic tamper/plan-downgrade guard
   *   4. FeatureNegotiationCoordinator.negotiateAll — feature-specific handshakes
   *   5. If blocked → pause loop, surface to user, hold
   *   6. Apply outcomes (settings already updated by negotiators)
   *   6b. Resume loop if it was paused by a prior disconnect or block (user toggle owns
   *       the loop; this only restores it to the state the toggle last set)
   *
   * onConfig does NOT start the loop from scratch — that is startSync()'s job.
   */
  async onConfig(config) {
    var _a, _b, _c;
    this.serverConfig = config;
    this.accountFeatures = (_a = config.features) != null ? _a : [];
    (_b = this.settingTab) == null ? void 0 : _b.display();
    FeatureGate.validateConsistency(config.features, this.settings, this);
    const results = await this.coordinator.negotiateAll(
      config.features,
      config.vault,
      this.settings,
      this
    );
    const blocked = results.filter((r) => r.status === "blocked");
    if (blocked.length > 0) {
      this.clearSyncInterval();
      for (const b of blocked) {
        if (b.status === "blocked") {
          new import_obsidian7.Notice(b.reason, 1e4);
          (_c = b.userAction) == null ? void 0 : _c.call(b);
        }
      }
      return;
    }
    const enc = await this.buildEncryption();
    this.syncManager.setEncryption(enc);
    if (this.settings.syncEnabled && this.settings.remoteVaultId && this.syncIntervalId === null) {
      this.startSyncLoop();
    }
  }
  startSyncLoop() {
    this.clearSyncInterval();
    const intervalMs = this.settings.syncIntervalMinutes * 60 * 1e3;
    void this.syncManager.sync();
    this.syncIntervalId = window.setInterval(() => {
      void this.syncManager.sync();
    }, intervalMs);
  }
  clearSyncInterval() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }
  // ── Auth failure ──────────────────────────────────────────────────────────
  handleAuthFailure() {
    const { deviceSecret } = this.settings;
    if (deviceSecret) {
      void this.reAuthAnonymous();
      return;
    }
    void this.switchAccount("").then(() => {
      new import_obsidian7.Notice(
        "Session expired or not signed in. Please sign in again in the plugin settings.",
        8e3
      );
    });
  }
  /** Re-authenticate an anonymous account using the stored device secret. */
  async reAuthAnonymous() {
    try {
      const result = await this.api.loginAnonymous(
        this.settings.clientId,
        this.settings.deviceSecret
      );
      this.settings.authToken = result.token;
      await this.saveSettings();
      this.api.setToken(result.token);
      this.restartSync();
    } catch (e) {
      await this.switchAccount("");
      new import_obsidian7.Notice(
        "Anonymous session could not be renewed. The device secret may be lost.",
        8e3
      );
    }
  }
  // ── WebSocket control channel status ──────────────────────────────────────
  onControlChannelStatus(status) {
    var _a;
    this.connectionStatus = status;
    (_a = this.settingTab) == null ? void 0 : _a.updateConnectionStatus(status);
    if (status === "disconnected") {
      this.clearSyncInterval();
    }
  }
  // ── Feature disable (called by FeatureGate and mid-upload 402 handler) ────
  /**
   * Disable a feature locally. Updates settings only; the caller is responsible for
   * rebuilding encryption and restarting the sync loop if needed.
   */
  disableFeature(feature) {
    if (feature === "e2ee" && this.settings.encryptionEnabled) {
      this.settings.encryptionEnabled = false;
      void this.saveSettings();
    }
  }
  /**
   * Invoked when the server returns 402 for a paid feature mid-upload.
   * Disables the feature, updates SyncManager immediately, and notifies the user.
   */
  handleFeatureNotEnabled(feature) {
    if (feature === "e2ee" && this.settings.encryptionEnabled) {
      this.disableFeature(feature);
      this.syncManager.setEncryption(null);
      new import_obsidian7.Notice(
        "End-to-end encryption is not available on your current plan. E2EE has been disabled. Files will sync without encryption.",
        1e4
      );
      this.settingTab.display();
    }
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
  // ── Encryption ────────────────────────────────────────────────────────────
  /**
   * Derive a VaultEncryption instance from current settings, or null if E2EE is
   * disabled or the passphrase / salt are not set.
   */
  async buildEncryption() {
    const { encryptionEnabled, encryptionPassphrase, encryptionSalt } = this.settings;
    if (!encryptionEnabled || !encryptionPassphrase || !encryptionSalt)
      return null;
    return VaultEncryption.create(encryptionPassphrase, encryptionSalt);
  }
  /**
   * Called when the passphrase changes in the settings tab.
   * Re-derives the key, updates the server's key_verification_token, installs the
   * new key on SyncManager, resets sync state so all files are re-uploaded with the
   * new encryption, then restarts sync.
   */
  async reinitEncryption() {
    var _a, _b, _c, _d;
    const enc = await this.buildEncryption();
    this.syncManager.setEncryption(enc);
    if (enc && this.settings.remoteVaultId) {
      try {
        const token = await enc.createKeyVerificationToken();
        const currentEpoch = (_d = (_c = (_b = (_a = this.serverConfig) == null ? void 0 : _a.vault) == null ? void 0 : _b.e2ee) == null ? void 0 : _c.key_epoch) != null ? _d : 0;
        await this.api.putVaultEncryption(this.settings.remoteVaultId, {
          enabled: true,
          epoch: currentEpoch + 1,
          key_verification_token: token
        });
      } catch (err) {
        console.warn("[SyncAgain] Failed to update key verification token:", err);
      }
    }
    await this.syncManager.resetSyncState();
    this.restartSync();
  }
  // ── Settings ──────────────────────────────────────────────────────────────
  async loadSettings() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u;
    const raw = (_a = await this.loadData()) != null ? _a : {};
    const isLegacy = !("accounts" in raw);
    if (isLegacy) {
      const legacyUserId = (_b = raw["userId"]) != null ? _b : "";
      const legacyAccount = {
        userId: legacyUserId,
        userEmail: (_c = raw["userEmail"]) != null ? _c : "",
        authToken: (_d = raw["authToken"]) != null ? _d : "",
        remoteVaultId: (_e = raw["vaultId"]) != null ? _e : "",
        syncEnabled: (_f = raw["syncEnabled"]) != null ? _f : false,
        encryptionEnabled: (_g = raw["encryptionEnabled"]) != null ? _g : false,
        encryptionPassphrase: (_h = raw["encryptionPassphrase"]) != null ? _h : "",
        encryptionSalt: (_i = raw["encryptionSalt"]) != null ? _i : "",
        deviceSecret: (_j = raw["deviceSecret"]) != null ? _j : ""
      };
      this.pluginData = {
        clientId: (_k = raw["clientId"]) != null ? _k : "",
        serverUrl: (_l = raw["serverUrl"]) != null ? _l : "",
        syncIntervalMinutes: (_m = raw["syncIntervalMinutes"]) != null ? _m : 5,
        currentUserId: legacyUserId,
        accounts: legacyUserId ? { [legacyUserId]: legacyAccount } : {}
      };
    } else {
      const rawAccounts = (_n = raw.accounts) != null ? _n : {};
      const migratedAccounts = {};
      for (const [uid, rawAcct] of Object.entries(rawAccounts)) {
        const a = rawAcct;
        migratedAccounts[uid] = {
          ...DEFAULT_ACCOUNT,
          ...a,
          remoteVaultId: (_p = (_o = a.remoteVaultId) != null ? _o : a["vaultId"]) != null ? _p : ""
        };
      }
      this.pluginData = {
        clientId: (_q = raw.clientId) != null ? _q : "",
        serverUrl: (_r = raw.serverUrl) != null ? _r : "",
        syncIntervalMinutes: (_s = raw.syncIntervalMinutes) != null ? _s : 5,
        currentUserId: (_t = raw.currentUserId) != null ? _t : "",
        accounts: migratedAccounts
      };
    }
    const account = (_u = this.pluginData.accounts[this.pluginData.currentUserId]) != null ? _u : { ...DEFAULT_ACCOUNT };
    this.settings = {
      clientId: this.pluginData.clientId,
      serverUrl: this.pluginData.serverUrl,
      syncIntervalMinutes: this.pluginData.syncIntervalMinutes,
      ...account
    };
  }
  async saveSettings() {
    const { clientId, serverUrl, syncIntervalMinutes, ...account } = this.settings;
    this.pluginData.clientId = clientId;
    this.pluginData.serverUrl = serverUrl;
    this.pluginData.syncIntervalMinutes = syncIntervalMinutes;
    const userId = this.pluginData.currentUserId;
    if (userId) {
      this.pluginData.accounts[userId] = { ...DEFAULT_ACCOUNT, ...account };
    }
    await this.saveData(this.pluginData);
  }
  /**
   * Switch the active account.
   *
   * - Saves the current account's state before switching.
   * - Loads the target account's config (creates a fresh default if unknown).
   * - Merges any `patch` fields (used when logging in to set the fresh token/email).
   * - Restarts sync with the new credentials, or stops sync for the initial state.
   *
   * Pass `userId = ""` for the initial/signed-out state (no active account, sync off).
   * For a user-initiated sign-out use `signOutToAnonymousOrInitial()` instead — it
   * restores the anonymous account if one exists before falling back to initial state.
   */
  async switchAccount(userId, patch) {
    var _a, _b;
    await this.saveSettings();
    this.pluginData.currentUserId = userId;
    const existing = (_a = this.pluginData.accounts[userId]) != null ? _a : { ...DEFAULT_ACCOUNT, userId };
    const account = { ...existing, ...patch };
    if (userId) {
      this.pluginData.accounts[userId] = account;
    }
    this.settings = {
      clientId: this.pluginData.clientId,
      serverUrl: this.pluginData.serverUrl,
      syncIntervalMinutes: this.pluginData.syncIntervalMinutes,
      ...account
    };
    await this.saveData(this.pluginData);
    if (this.settings.authToken) {
      this.api.setToken(this.settings.authToken);
    } else {
      this.api.invalidateToken();
    }
    this.api.setRemoteVaultId(this.settings.remoteVaultId);
    this.controlChannel.stop();
    if (userId) {
      if (this.settings.serverUrl && this.settings.syncEnabled) {
        this.connectControlChannel();
      }
      if (this.settings.syncEnabled) {
        this.startSync();
      }
    } else {
      this.signOut();
    }
    (_b = this.settingTab) == null ? void 0 : _b.display();
  }
  /**
   * Called when the user explicitly signs out via the settings UI.
   *
   * Restores the anonymous account (accounts[clientId] with no email) if one
   * exists, so sync continues with the prior anonymous session. Falls back to
   * the initial state (no account, sync off) when no anonymous account exists.
   *
   * Auth-failure sign-outs (token expiry, re-auth failure) skip this and go
   * straight to initial state via switchAccount("") — unexpected expiry should
   * not silently resume anonymous sync.
   */
  async signOutToAnonymousOrInitial() {
    const anonAccount = this.pluginData.accounts[this.pluginData.clientId];
    if (anonAccount && !anonAccount.userEmail) {
      await this.switchAccount(this.pluginData.clientId);
    } else {
      await this.switchAccount("");
    }
  }
};
