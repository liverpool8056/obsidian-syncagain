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
var import_obsidian8 = require("obsidian");

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
    this.setTitle("Sync conflicts detected");
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
    this.setTitle("Keep remote versions?");
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
    this.setTitle("Connect to a remote vault");
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
var DEFAULT_SETTINGS = {
  clientId: "",
  serverUrl: "",
  syncIntervalMinutes: 5,
  userId: "",
  userEmail: "",
  authToken: "",
  remoteVaultId: "",
  syncEnabled: false,
  encryptionEnabled: false,
  encryptionStatus: "DISABLED",
  encryptionSecretKey: "",
  encryptionSalt: "",
  encryptionDEK: "",
  cachedVaultKeys: {}
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
    /**
     * Debounces PUT /api/vaults/{vault_id}/settings so rapid keystrokes on the
     * sync-interval input don't spam the API. Toggle changes share the same
     * timer so they're flushed alongside any pending interval edit.
     */
    this.syncedSettingsPushTimer = null;
    /** Cached remote vault list for the vault picker; null = not yet fetched. */
    this.vaultList = null;
    this.loadingVaults = false;
    /**
     * Buffer of pending field changes flushed to the server after 1 s of
     * inactivity. Successive calls before the timer fires merge into the same
     * payload so a toggle change and a number-input edit go out as one PUT.
     */
    this.pendingSyncedSettings = {};
  }
  display() {
    var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    console.debug(
      `[SyncAgain] settings tab display() \u2014 encryptionStatus=${this.plugin.settings.encryptionStatus} serverE2eeStatus=${(_d = (_c = (_b = (_a2 = this.plugin.serverConfig) == null ? void 0 : _a2.vault) == null ? void 0 : _b.e2ee) == null ? void 0 : _c.status) != null ? _d : "<no-config>"} serverInitiator=${(_h = (_g = (_f = (_e = this.plugin.serverConfig) == null ? void 0 : _e.vault) == null ? void 0 : _f.e2ee) == null ? void 0 : _g.initiator_id) != null ? _h : "<none>"} localClientId=${this.plugin.settings.clientId}`
    );
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
    const isSignedIn = Boolean(
      this.plugin.settings.authToken && this.plugin.settings.userId
    );
    if (isSignedIn) {
      new import_obsidian3.Setting(containerEl).setName("Signed in").setDesc(this.plugin.settings.userEmail || this.plugin.settings.userId).addButton(
        (btn) => btn.setButtonText("Account detail").onClick(() => {
          const base = this.plugin.settings.serverUrl.replace(/\/+$/, "");
          window.open(`${base}/account`);
        })
      ).addButton(
        (btn) => btn.setButtonText("Sign out").setWarning().onClick(() => this.confirmSignOut())
      );
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
              await this.plugin.signIn({
                userId: result.userId,
                userEmail: result.userEmail,
                authToken: result.token
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
        new import_obsidian3.Setting(containerEl).setDesc("Forgot your password?").addButton(
          (btn) => btn.setButtonText("Reset password").onClick(() => {
            const base = this.plugin.settings.serverUrl.replace(/\/+$/, "");
            if (!base) {
              new import_obsidian3.Notice("Set the server URL first.");
              return;
            }
            window.open(`${base}/forgot-password`);
          })
        );
      }
    }
    new import_obsidian3.Setting(containerEl).setName("Sync").setHeading();
    new import_obsidian3.Setting(containerEl).setName("Enable sync").setDesc("Turn periodic file sync on or off on this device.").addToggle((toggle) => {
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
    new import_obsidian3.Setting(containerEl).setName("Sync interval (minutes)").setDesc("How often to run a full sync cycle. Synced across all your devices.").addText(
      (text) => text.setPlaceholder("5").setValue(String(this.plugin.settings.syncIntervalMinutes)).onChange(async (value) => {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed > 0) {
          this.plugin.settings.syncIntervalMinutes = parsed;
          await this.plugin.saveSettings();
          this.queueSyncedSettingsPush({ sync_interval_minutes: parsed });
          this.plugin.restartSync();
        }
      })
    );
    if (isSignedIn && this.plugin.settings.syncEnabled) {
      new import_obsidian3.Setting(containerEl).setName("Vault").setHeading();
      if (this.plugin.settings.remoteVaultId) {
        new import_obsidian3.Setting(containerEl).setName("Remote vault").setDesc(`Linked \u2014 vault ID: ${this.plugin.settings.remoteVaultId}`);
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
        "E2EE status is synchronized with the server. Files are encrypted with AES-256-GCM before uploading when ACTIVE."
      ).addText((text) => {
        text.setValue(this.plugin.settings.encryptionStatus).setDisabled(true);
        text.inputEl.addClass("syncagain-encryption-status-input");
      });
      if (this.plugin.settings.encryptionStatus === "DISABLED") {
        const e2eeEntitled = this.plugin.accountFeatures.includes("e2ee");
        if (e2eeEntitled) {
          new import_obsidian3.Setting(containerEl).setName("Enable encryption").setDesc(
            "Generates a secret key and starts re-uploading every file in encrypted form. You will need the secret key to unlock the vault on other devices \u2014 losing it means losing access to your data. Save it in a password manager before continuing."
          ).addButton(
            (btn) => btn.setButtonText("Start migration").setCta().onClick(async () => {
              await this.plugin.startE2EEMigration();
              if (this.plugin.settings.encryptionSecretKey) {
                new SecretKeyModal(this.app, this.plugin.settings.encryptionSecretKey).open();
              }
              this.display();
            })
          );
        } else {
          new import_obsidian3.Setting(containerEl).setName("Enable encryption").setDesc(
            "End-to-end encryption is not available on your current plan. Contact the server admin to enable the e2ee feature on your account."
          );
        }
      }
      const serverE2ee = (_k = (_j = (_i = this.plugin.serverConfig) == null ? void 0 : _i.vault) == null ? void 0 : _j.e2ee) != null ? _k : null;
      const isInitiator = !!(serverE2ee == null ? void 0 : serverE2ee.initiator_id) && serverE2ee.initiator_id === this.plugin.settings.clientId;
      if (this.plugin.settings.encryptionStatus === "MIGRATING") {
        if (isInitiator) {
          new import_obsidian3.Setting(containerEl).setName("Migration in progress").setDesc(
            "Files are being re-uploaded encrypted. Wait until the sync queue is empty (no pending uploads), then click 'Finalize migration' to switch the vault into the ACTIVE state. Other devices stay locked until you finalize."
          ).addButton(
            (btn) => btn.setButtonText("Show secret key").onClick(() => {
              if (this.plugin.settings.encryptionSecretKey) {
                new SecretKeyModal(this.app, this.plugin.settings.encryptionSecretKey).open();
              } else {
                new import_obsidian3.Notice("No secret key stored locally on this device.");
              }
            })
          ).addButton(
            (btn) => btn.setButtonText("Finalize migration").setCta().onClick(async () => {
              await this.plugin.finalizeE2EEMigration();
              this.display();
            })
          );
        } else {
          new import_obsidian3.Setting(containerEl).setName("Migration in progress (another device)").setDesc(
            "Another device is migrating this vault to E2EE. Uploads from this device are blocked until the initiator finalizes. If you have the secret key, you can unlock the vault on this device to read the encrypted files."
          );
        }
      }
      if (this.plugin.settings.encryptionStatus === "ACTIVE") {
        new import_obsidian3.Setting(containerEl).setName("Disable encryption").setDesc(
          "Start a rollback to plaintext. Once started, every device will need to wait for the initiator to finalize before sync resumes."
        ).addButton(
          (btn) => btn.setButtonText("Start rollback").setWarning().onClick(async () => {
            await this.plugin.startE2EERollback();
            this.display();
          })
        );
      }
      if (this.plugin.settings.encryptionStatus === "MIGRATING_TO_OFF") {
        if (isInitiator) {
          new import_obsidian3.Setting(containerEl).setName("Rollback in progress").setDesc("Files are being re-uploaded in plaintext. Once finished, click finalize.").addButton(
            (btn) => btn.setButtonText("Finalize rollback").setWarning().onClick(async () => {
              await this.plugin.finalizeE2EERollback();
              this.display();
            })
          );
        } else {
          new import_obsidian3.Setting(containerEl).setName("Rollback in progress (another device)").setDesc(
            "Another device is rolling this vault back to plaintext. Uploads from this device are blocked until the initiator finalizes."
          );
        }
      }
      if (this.plugin.settings.encryptionStatus !== "DISABLED") {
        let secretKeyInput = null;
        const secretKeySetting = new import_obsidian3.Setting(containerEl).setName("Secret key").setDesc(
          "The 16-character key used to derive the encryption key. Required to unlock this vault on a new device. Edit it here only if you are entering a key from another device."
        ).addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("xxxx-xxxx-xxxx-xxxx").setValue(this.plugin.settings.encryptionSecretKey).onChange(async (value) => {
            this.plugin.settings.encryptionSecretKey = value;
            await this.plugin.saveSettings();
          });
          secretKeyInput = text.inputEl;
        });
        const showBtn = secretKeySetting.controlEl.createEl("button", {
          text: "Show",
          cls: "syncagain-show-secret-btn"
        });
        showBtn.onClickEvent(() => {
          if (!secretKeyInput)
            return;
          if (secretKeyInput.type === "password") {
            secretKeyInput.type = "text";
            showBtn.setText("Hide");
          } else {
            secretKeyInput.type = "password";
            showBtn.setText("Show");
          }
        });
        const copyBtn = secretKeySetting.controlEl.createEl("button", {
          text: "Copy",
          cls: "syncagain-show-secret-btn"
        });
        copyBtn.onClickEvent(async () => {
          const value = this.plugin.settings.encryptionSecretKey;
          if (!value) {
            new import_obsidian3.Notice("No secret key stored locally.");
            return;
          }
          await navigator.clipboard.writeText(value);
          new import_obsidian3.Notice("Secret key copied to clipboard.");
        });
      }
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
  queueSyncedSettingsPush(patch) {
    if (!this.plugin.settings.remoteVaultId)
      return;
    Object.assign(this.pendingSyncedSettings, patch);
    if (this.syncedSettingsPushTimer !== null) {
      clearTimeout(this.syncedSettingsPushTimer);
    }
    this.syncedSettingsPushTimer = setTimeout(() => {
      this.syncedSettingsPushTimer = null;
      const payload = this.pendingSyncedSettings;
      this.pendingSyncedSettings = {};
      void this.plugin.api.updateVaultSettings(this.plugin.settings.remoteVaultId, payload).catch((err) => {
        console.warn("[SyncAgain] Failed to push vault settings:", err);
      });
    }, 1e3);
  }
  /**
   * Sign out, first prompting (when there is cached E2EE key material) whether
   * to also purge this account's saved secret key from the device. With no key
   * material to retain, signs out directly without the prompt.
   */
  confirmSignOut() {
    const finish = async (purgeCachedKeys) => {
      this.vaultList = null;
      this.loadingVaults = false;
      await this.plugin.signOut({ purgeCachedKeys });
      this.display();
    };
    const hasKeyMaterial = Boolean(this.plugin.settings.encryptionDEK || this.plugin.settings.encryptionSecretKey) || Object.keys(this.plugin.settings.cachedVaultKeys).some(
      (k) => k.startsWith(`${this.plugin.settings.userId}:`)
    );
    if (!hasKeyMaterial) {
      void finish(false);
      return;
    }
    new SignOutModal(this.app, (purgeCachedKeys) => void finish(purgeCachedKeys)).open();
  }
};
var SignOutModal = class extends import_obsidian3.Modal {
  constructor(app, onConfirm) {
    super(app);
    this.onConfirm = onConfirm;
    this.purge = false;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Remove cached data");
    new import_obsidian3.Setting(contentEl).setName("Confirm if you want to remove cached account data").setDesc(
      "Delete cached secret key on this device for this account. You can leave off without checking to avoid re-entering it when you sign back in and rejoin the same vault."
    ).addToggle((t) => t.setValue(this.purge).onChange((v) => this.purge = v));
    const buttonRow = contentEl.createDiv({ cls: "syncagain-secret-key-buttons" });
    buttonRow.createEl("button", { text: "Cancel" }).onClickEvent(() => this.close());
    const signOutBtn = buttonRow.createEl("button", { text: "Sign out", cls: "mod-warning" });
    signOutBtn.onClickEvent(() => {
      this.close();
      this.onConfirm(this.purge);
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SecretKeyModal = class extends import_obsidian3.Modal {
  constructor(app, secretKey) {
    super(app);
    this.secretKey = secretKey;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Save your secret key");
    const warning = contentEl.createEl("p");
    warning.setText(
      "This key is the only way to unlock your vault on another device. If you lose it, your encrypted files cannot be recovered \u2014 not even by us. Store it in a password manager now."
    );
    const keyEl = contentEl.createEl("pre", { cls: "syncagain-secret-key-display" });
    keyEl.setText(this.secretKey);
    const buttonRow = contentEl.createDiv({ cls: "syncagain-secret-key-buttons" });
    const copyBtn = buttonRow.createEl("button", { text: "Copy to clipboard", cls: "mod-cta" });
    copyBtn.onClickEvent(async () => {
      await navigator.clipboard.writeText(this.secretKey);
      new import_obsidian3.Notice("Secret key copied to clipboard.");
    });
    const closeBtn = buttonRow.createEl("button", { text: "I have saved it" });
    closeBtn.onClickEvent(() => this.close());
  }
  onClose() {
    this.contentEl.empty();
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
    if (!oldPath.startsWith(".trash/")) {
      this.pendingDeletions.add(oldPath);
    }
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
   * Sign in with email + password and store the returned token.
   * Used by the inline sign-in form in the settings tab.
   * Returns `{ token, userId, userEmail }` on success.
   */
  async loginWithCredentials(email, password) {
    var _a2;
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
      msg = (_a2 = res.json.error) != null ? _a2 : String(res.status);
    } catch (e) {
      msg = String(res.status);
    }
    throw new ApiError(res.status, msg);
  }
  // ── Generic request helper ───────────────────────────────────────────────
  async request(method, path, body, extraHeaders) {
    var _a2, _b, _c;
    if (!this.token) {
      (_a2 = this.onAuthFailure) == null ? void 0 : _a2.call(this);
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
    const data = await this.request(
      "GET",
      `/api/files?vault_id=${encodeURIComponent(this.remoteVaultId)}`
    );
    const prefix = `${this.remoteVaultId}/`;
    return data.files.filter((f) => f.key.startsWith(prefix)).map((f) => ({ ...f, key: f.key.slice(prefix.length) }));
  }
  async downloadFile(key) {
    var _a2, _b;
    if (!this.token) {
      (_a2 = this.onAuthFailure) == null ? void 0 : _a2.call(this);
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
   */
  async uploadFile(key, data, options = {}) {
    var _a2, _b, _c;
    if (!this.token) {
      (_a2 = this.onAuthFailure) == null ? void 0 : _a2.call(this);
      throw new ApiError(401, "Not signed in.");
    }
    if (!this.remoteVaultId) {
      throw new Error("remoteVaultId is not set \u2014 vault handshake must complete before uploading");
    }
    const boundary = `----SyncAgainBoundary${Date.now()}`;
    const enc = new TextEncoder();
    const parts = [];
    const addPart = (name, value) => {
      parts.push(enc.encode(`--${boundary}\r
Content-Disposition: form-data; name="${name}"\r
\r
${value}\r
`));
    };
    addPart("vault_id", this.remoteVaultId);
    addPart("key", key);
    if (options.contentHmac) {
      addPart("content_hmac", options.contentHmac);
    }
    if (options.isEncrypted !== void 0) {
      addPart("is_encrypted", options.isEncrypted ? "true" : "false");
    }
    const contentType = options.contentType || "application/octet-stream";
    parts.push(enc.encode(`--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${key}"\r
Content-Type: ${contentType}\r
\r
`));
    parts.push(new Uint8Array(data));
    parts.push(enc.encode(`\r
--${boundary}--\r
`));
    const totalLength = parts.reduce((acc, p) => acc + p.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const p of parts) {
      body.set(p, offset);
      offset += p.length;
    }
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
    await this.request(
      "DELETE",
      `/api/files?vault_id=${encodeURIComponent(this.remoteVaultId)}&key=${encodeURIComponent(key)}`
    );
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
  /**
   * Push vault-level settings to the server. Body fields are all optional —
   * only included keys are merged on the server side. The server bumps
   * `config_version`, so other devices receive the update in their next pong.
   */
  async updateVaultSettings(remoteVaultId, settings) {
    await this.request(
      "PUT",
      `/api/vaults/${encodeURIComponent(remoteVaultId)}/settings`,
      JSON.stringify(settings),
      { "Content-Type": "application/json" }
    );
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
    var _a2, _b, _c;
    if (this.syncing)
      return;
    this.syncing = true;
    (_a2 = this.onStatus) == null ? void 0 : _a2.call(this, "syncing");
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
      const localHash = md5(data);
      if (remote.is_encrypted && this.encryption) {
        const localHmac = await this.encryption.calculateHMAC(data);
        if (localHmac === remote.content_hmac) {
          this.state.files[file.path] = {
            md5: remote.md5,
            syncedAt: Date.now(),
            mtime: file.stat.mtime,
            contentHmac: localHmac
          };
        } else {
          conflicts.push({
            path: file.path,
            localMtime: file.stat.mtime,
            remoteMtime: remote.last_modified
          });
        }
      } else if (!remote.is_encrypted && !this.encryption) {
        if (localHash === remote.md5) {
          this.state.files[file.path] = {
            md5: remote.md5,
            syncedAt: Date.now(),
            mtime: file.stat.mtime
          };
        } else {
          conflicts.push({
            path: file.path,
            localMtime: file.stat.mtime,
            remoteMtime: remote.last_modified
          });
        }
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
    var _a2;
    for (const file of this.vault.getFiles()) {
      if (this.isExcluded(file.path))
        continue;
      if (this.state.deletedFiles.includes(file.path))
        continue;
      const known = this.state.files[file.path];
      if (!known || file.stat.mtime > ((_a2 = known.mtime) != null ? _a2 : 0)) {
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
    var _a2;
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
    const drained = failedPaths.length === 0 && this.tracker.pendingCount === 0 && (dirty.length > 0 || deletedPaths.length > 0);
    console.debug(
      `[SyncAgain] cycle done \u2014 dirty=${dirty.length} uploaded=${dirty.length - failedPaths.length} failed=${failedPaths.length} deleted=${deletedPaths.length} pendingAfter=${this.tracker.pendingCount} encryption=${this.encryption ? "on" : "off"} \u2192 onCycleDrained=${drained}`
    );
    if (drained) {
      (_a2 = this.onCycleDrained) == null ? void 0 : _a2.call(this);
    }
  }
  // ── Upload ─────────────────────────────────────────────────────────────────
  async uploadLocalFile(path) {
    var _a2, _b;
    const file = this.vault.getFileByPath(path);
    if (!file) {
      return;
    }
    const plainData = await this.vault.readBinary(file);
    const plaintextHash = md5(plainData);
    const contentHmac = this.encryption ? await this.encryption.calculateHMAC(plainData) : void 0;
    const known = this.state.files[path];
    if (this.encryption) {
      if ((known == null ? void 0 : known.contentHmac) === contentHmac)
        return;
    } else {
      if ((known == null ? void 0 : known.md5) === plaintextHash)
        return;
    }
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
      let isEncrypted = false;
      if (this.encryption) {
        uploadData = await this.encryption.encrypt(plainData);
        isEncrypted = true;
      } else {
        uploadData = plainData;
      }
      const ciphertextHash = md5(uploadData);
      console.debug(
        `[SyncAgain] uploading '${path}' isEncrypted=${isEncrypted} contentHmac=${contentHmac ? contentHmac.slice(0, 12) + "\u2026" : "none"} size=${uploadData.byteLength}`
      );
      try {
        await this.api.uploadFile(path, uploadData, {
          contentHmac,
          isEncrypted
        });
      } catch (uploadErr) {
        if (uploadErr instanceof ApiError && uploadErr.status === 402) {
          const feature = (_a2 = uploadErr.feature) != null ? _a2 : "unknown";
          if (!this.featureErrorNotified.has(feature)) {
            this.featureErrorNotified.add(feature);
            (_b = this.onFeatureNotEnabled) == null ? void 0 : _b.call(this, feature);
          }
          this.tracker.markDirtyByPath(path);
          return;
        }
        throw uploadErr;
      }
      const entry = {
        md5: ciphertextHash,
        syncedAt: Date.now(),
        mtime: file.stat.mtime
      };
      if (contentHmac !== void 0)
        entry.contentHmac = contentHmac;
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
    var _a2, _b;
    const rawData = await this.api.downloadFile(key);
    const isEncrypted = remote ? remote.is_encrypted : Boolean(this.encryption);
    let plainData;
    if (isEncrypted) {
      if (!this.encryption) {
        console.warn(
          `[SyncAgain] Skipping download of encrypted '${key}' \u2014 no encryption key loaded.`
        );
        return;
      }
      try {
        plainData = await this.encryption.decrypt(rawData);
      } catch (err) {
        console.error(`[SyncAgain] Failed to decrypt '${key}':`, err);
        return;
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
    const ciphertextMd5 = (_a2 = remote == null ? void 0 : remote.md5) != null ? _a2 : md5(rawData);
    const contentHmac = this.encryption ? await this.encryption.calculateHMAC(plainData) : void 0;
    const entry = {
      md5: ciphertextMd5,
      syncedAt: Date.now(),
      mtime: (_b = writtenFile == null ? void 0 : writtenFile.stat.mtime) != null ? _b : Date.now()
    };
    if (contentHmac !== void 0)
      entry.contentHmac = contentHmac;
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
    var _a2;
    this.stopped = false;
    this.clearAllTimers();
    this.closeWs();
    (_a2 = this.onConnectionStatus) == null ? void 0 : _a2.call(this, "connecting");
    this.connect();
  }
  stop() {
    var _a2;
    this.stopped = true;
    this.clearAllTimers();
    this.closeWs();
    (_a2 = this.onConnectionStatus) == null ? void 0 : _a2.call(this, "disconnected");
  }
  connect() {
    var _a2;
    if (this.stopped)
      return;
    const url = this.api.buildWsUrl();
    if (!url) {
      (_a2 = this.onConnectionStatus) == null ? void 0 : _a2.call(this, "disconnected");
      return;
    }
    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        var _a3;
        this.retryMs = 1e3;
        (_a3 = this.onConnectionStatus) == null ? void 0 : _a3.call(this, "connected");
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
        var _a3;
        (_a3 = this.onConnectionStatus) == null ? void 0 : _a3.call(this, "connecting");
      };
      ws.onclose = () => {
        var _a3;
        this.ws = null;
        this.clearPingLoop();
        if (!this.stopped) {
          (_a3 = this.onConnectionStatus) == null ? void 0 : _a3.call(this, "connecting");
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
      var _a2;
      (_a2 = this.onConnectionStatus) == null ? void 0 : _a2.call(this, "disconnected");
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

// node_modules/hash-wasm/dist/index.esm.js
function __awaiter(thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function(resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
}
var Mutex = class {
  constructor() {
    this.mutex = Promise.resolve();
  }
  lock() {
    let begin = () => {
    };
    this.mutex = this.mutex.then(() => new Promise(begin));
    return new Promise((res) => {
      begin = res;
    });
  }
  dispatch(fn) {
    return __awaiter(this, void 0, void 0, function* () {
      const unlock = yield this.lock();
      try {
        return yield Promise.resolve(fn());
      } finally {
        unlock();
      }
    });
  }
};
var _a;
function getGlobal() {
  if (typeof globalThis !== "undefined")
    return globalThis;
  if (typeof self !== "undefined")
    return self;
  if (typeof window !== "undefined")
    return window;
  return global;
}
var globalObject = getGlobal();
var nodeBuffer = (_a = globalObject.Buffer) !== null && _a !== void 0 ? _a : null;
var textEncoder = globalObject.TextEncoder ? new globalObject.TextEncoder() : null;
function hexCharCodesToInt(a, b) {
  return (a & 15) + (a >> 6 | a >> 3 & 8) << 4 | (b & 15) + (b >> 6 | b >> 3 & 8);
}
function writeHexToUInt8(buf, str) {
  const size = str.length >> 1;
  for (let i = 0; i < size; i++) {
    const index = i << 1;
    buf[i] = hexCharCodesToInt(str.charCodeAt(index), str.charCodeAt(index + 1));
  }
}
function hexStringEqualsUInt8(str, buf) {
  if (str.length !== buf.length * 2) {
    return false;
  }
  for (let i = 0; i < buf.length; i++) {
    const strIndex = i << 1;
    if (buf[i] !== hexCharCodesToInt(str.charCodeAt(strIndex), str.charCodeAt(strIndex + 1))) {
      return false;
    }
  }
  return true;
}
var alpha = "a".charCodeAt(0) - 10;
var digit = "0".charCodeAt(0);
function getDigestHex(tmpBuffer, input, hashLength) {
  let p = 0;
  for (let i = 0; i < hashLength; i++) {
    let nibble = input[i] >>> 4;
    tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
    nibble = input[i] & 15;
    tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
  }
  return String.fromCharCode.apply(null, tmpBuffer);
}
var getUInt8Buffer = nodeBuffer !== null ? (data) => {
  if (typeof data === "string") {
    const buf = nodeBuffer.from(data, "utf8");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
  }
  if (nodeBuffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.length);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error("Invalid data type!");
} : (data) => {
  if (typeof data === "string") {
    return textEncoder.encode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error("Invalid data type!");
};
var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var base64Lookup = new Uint8Array(256);
for (let i = 0; i < base64Chars.length; i++) {
  base64Lookup[base64Chars.charCodeAt(i)] = i;
}
function encodeBase64(data, pad = true) {
  const len = data.length;
  const extraBytes = len % 3;
  const parts = [];
  const len2 = len - extraBytes;
  for (let i = 0; i < len2; i += 3) {
    const tmp = (data[i] << 16 & 16711680) + (data[i + 1] << 8 & 65280) + (data[i + 2] & 255);
    const triplet = base64Chars.charAt(tmp >> 18 & 63) + base64Chars.charAt(tmp >> 12 & 63) + base64Chars.charAt(tmp >> 6 & 63) + base64Chars.charAt(tmp & 63);
    parts.push(triplet);
  }
  if (extraBytes === 1) {
    const tmp = data[len - 1];
    const a = base64Chars.charAt(tmp >> 2);
    const b = base64Chars.charAt(tmp << 4 & 63);
    parts.push(`${a}${b}`);
    if (pad) {
      parts.push("==");
    }
  } else if (extraBytes === 2) {
    const tmp = (data[len - 2] << 8) + data[len - 1];
    const a = base64Chars.charAt(tmp >> 10);
    const b = base64Chars.charAt(tmp >> 4 & 63);
    const c = base64Chars.charAt(tmp << 2 & 63);
    parts.push(`${a}${b}${c}`);
    if (pad) {
      parts.push("=");
    }
  }
  return parts.join("");
}
function getDecodeBase64Length(data) {
  let bufferLength = Math.floor(data.length * 0.75);
  const len = data.length;
  if (data[len - 1] === "=") {
    bufferLength -= 1;
    if (data[len - 2] === "=") {
      bufferLength -= 1;
    }
  }
  return bufferLength;
}
function decodeBase64(data) {
  const bufferLength = getDecodeBase64Length(data);
  const len = data.length;
  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = base64Lookup[data.charCodeAt(i)];
    const encoded2 = base64Lookup[data.charCodeAt(i + 1)];
    const encoded3 = base64Lookup[data.charCodeAt(i + 2)];
    const encoded4 = base64Lookup[data.charCodeAt(i + 3)];
    bytes[p] = encoded1 << 2 | encoded2 >> 4;
    p += 1;
    bytes[p] = (encoded2 & 15) << 4 | encoded3 >> 2;
    p += 1;
    bytes[p] = (encoded3 & 3) << 6 | encoded4 & 63;
    p += 1;
  }
  return bytes;
}
var MAX_HEAP = 16 * 1024;
var WASM_FUNC_HASH_LENGTH = 4;
var wasmMutex = new Mutex();
var wasmModuleCache = /* @__PURE__ */ new Map();
function WASMInterface(binary, hashLength) {
  return __awaiter(this, void 0, void 0, function* () {
    let wasmInstance = null;
    let memoryView = null;
    let initialized = false;
    if (typeof WebAssembly === "undefined") {
      throw new Error("WebAssembly is not supported in this environment!");
    }
    const writeMemory = (data, offset = 0) => {
      memoryView.set(data, offset);
    };
    const getMemory = () => memoryView;
    const getExports = () => wasmInstance.exports;
    const setMemorySize = (totalSize) => {
      wasmInstance.exports.Hash_SetMemorySize(totalSize);
      const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
      const memoryBuffer = wasmInstance.exports.memory.buffer;
      memoryView = new Uint8Array(memoryBuffer, arrayOffset, totalSize);
    };
    const getStateSize = () => {
      const view = new DataView(wasmInstance.exports.memory.buffer);
      const stateSize = view.getUint32(wasmInstance.exports.STATE_SIZE, true);
      return stateSize;
    };
    const loadWASMPromise = wasmMutex.dispatch(() => __awaiter(this, void 0, void 0, function* () {
      if (!wasmModuleCache.has(binary.name)) {
        const asm = decodeBase64(binary.data);
        const promise = WebAssembly.compile(asm);
        wasmModuleCache.set(binary.name, promise);
      }
      const module2 = yield wasmModuleCache.get(binary.name);
      wasmInstance = yield WebAssembly.instantiate(module2, {
        // env: {
        //   emscripten_memcpy_big: (dest, src, num) => {
        //     const memoryBuffer = wasmInstance.exports.memory.buffer;
        //     const memView = new Uint8Array(memoryBuffer, 0);
        //     memView.set(memView.subarray(src, src + num), dest);
        //   },
        //   print_memory: (offset, len) => {
        //     const memoryBuffer = wasmInstance.exports.memory.buffer;
        //     const memView = new Uint8Array(memoryBuffer, 0);
        //     console.log('print_int32', memView.subarray(offset, offset + len));
        //   },
        // },
      });
    }));
    const setupInterface = () => __awaiter(this, void 0, void 0, function* () {
      if (!wasmInstance) {
        yield loadWASMPromise;
      }
      const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
      const memoryBuffer = wasmInstance.exports.memory.buffer;
      memoryView = new Uint8Array(memoryBuffer, arrayOffset, MAX_HEAP);
    });
    const init = (bits = null) => {
      initialized = true;
      wasmInstance.exports.Hash_Init(bits);
    };
    const updateUInt8Array = (data) => {
      let read = 0;
      while (read < data.length) {
        const chunk = data.subarray(read, read + MAX_HEAP);
        read += chunk.length;
        memoryView.set(chunk);
        wasmInstance.exports.Hash_Update(chunk.length);
      }
    };
    const update = (data) => {
      if (!initialized) {
        throw new Error("update() called before init()");
      }
      const Uint8Buffer = getUInt8Buffer(data);
      updateUInt8Array(Uint8Buffer);
    };
    const digestChars = new Uint8Array(hashLength * 2);
    const digest = (outputType, padding = null) => {
      if (!initialized) {
        throw new Error("digest() called before init()");
      }
      initialized = false;
      wasmInstance.exports.Hash_Final(padding);
      if (outputType === "binary") {
        return memoryView.slice(0, hashLength);
      }
      return getDigestHex(digestChars, memoryView, hashLength);
    };
    const save = () => {
      if (!initialized) {
        throw new Error("save() can only be called after init() and before digest()");
      }
      const stateOffset = wasmInstance.exports.Hash_GetState();
      const stateLength = getStateSize();
      const memoryBuffer = wasmInstance.exports.memory.buffer;
      const internalState = new Uint8Array(memoryBuffer, stateOffset, stateLength);
      const prefixedState = new Uint8Array(WASM_FUNC_HASH_LENGTH + stateLength);
      writeHexToUInt8(prefixedState, binary.hash);
      prefixedState.set(internalState, WASM_FUNC_HASH_LENGTH);
      return prefixedState;
    };
    const load = (state) => {
      if (!(state instanceof Uint8Array)) {
        throw new Error("load() expects an Uint8Array generated by save()");
      }
      const stateOffset = wasmInstance.exports.Hash_GetState();
      const stateLength = getStateSize();
      const overallLength = WASM_FUNC_HASH_LENGTH + stateLength;
      const memoryBuffer = wasmInstance.exports.memory.buffer;
      if (state.length !== overallLength) {
        throw new Error(`Bad state length (expected ${overallLength} bytes, got ${state.length})`);
      }
      if (!hexStringEqualsUInt8(binary.hash, state.subarray(0, WASM_FUNC_HASH_LENGTH))) {
        throw new Error("This state was written by an incompatible hash implementation");
      }
      const internalState = state.subarray(WASM_FUNC_HASH_LENGTH);
      new Uint8Array(memoryBuffer, stateOffset, stateLength).set(internalState);
      initialized = true;
    };
    const isDataShort = (data) => {
      if (typeof data === "string") {
        return data.length < MAX_HEAP / 4;
      }
      return data.byteLength < MAX_HEAP;
    };
    let canSimplify = isDataShort;
    switch (binary.name) {
      case "argon2":
      case "scrypt":
        canSimplify = () => true;
        break;
      case "blake2b":
      case "blake2s":
        canSimplify = (data, initParam) => initParam <= 512 && isDataShort(data);
        break;
      case "blake3":
        canSimplify = (data, initParam) => initParam === 0 && isDataShort(data);
        break;
      case "xxhash64":
      case "xxhash3":
      case "xxhash128":
      case "crc64":
        canSimplify = () => false;
        break;
    }
    const calculate = (data, initParam = null, digestParam = null) => {
      if (!canSimplify(data, initParam)) {
        init(initParam);
        update(data);
        return digest("hex", digestParam);
      }
      const buffer = getUInt8Buffer(data);
      memoryView.set(buffer);
      wasmInstance.exports.Hash_Calculate(buffer.length, initParam, digestParam);
      return getDigestHex(digestChars, memoryView, hashLength);
    };
    yield setupInterface();
    return {
      getMemory,
      writeMemory,
      getExports,
      setMemorySize,
      init,
      update,
      digest,
      save,
      load,
      calculate,
      hashLength
    };
  });
}
var mutex$l = new Mutex();
var name$k = "argon2";
var data$k = "AGFzbQEAAAABKQVgAX8Bf2AAAX9gEH9/f39/f39/f39/f39/f38AYAR/f39/AGACf38AAwYFAAECAwQFBgEBAoCAAgYIAX8BQZCoBAsHQQQGbWVtb3J5AgASSGFzaF9TZXRNZW1vcnlTaXplAAAOSGFzaF9HZXRCdWZmZXIAAQ5IYXNoX0NhbGN1bGF0ZQAECvEyBVgBAn9BACEBAkAgAEEAKAKICCICRg0AAkAgACACayIAQRB2IABBgIB8cSAASWoiAEAAQX9HDQBB/wHADwtBACEBQQBBACkDiAggAEEQdK18NwOICAsgAcALcAECfwJAQQAoAoAIIgANAEEAPwBBEHQiADYCgAhBACgCiAgiAUGAgCBGDQACQEGAgCAgAWsiAEEQdiAAQYCAfHEgAElqIgBAAEF/Rw0AQQAPC0EAQQApA4gIIABBEHStfDcDiAhBACgCgAghAAsgAAvcDgECfiAAIAQpAwAiECAAKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAMIBAgDCkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgBCAQIAQpAwCFQiiJIhA3AwAgACAQIAApAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAwgECAMKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAEIBAgBCkDAIVCAYk3AwAgASAFKQMAIhAgASkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDSAQIA0pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAEgECABKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACANIBAgDSkDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAIgBikDACIQIAIpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIA4gECAOKQMAhUIgiSIQNwMAIAogECAKKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACACIBAgAikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDiAQIA4pAwCFQjCJIhA3AwAgCiAQIAopAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACADIAcpAwAiECADKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAPIBAgDykDAIVCIIkiEDcDACALIBAgCykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAyAQIAMpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA8gECAPKQMAhUIwiSIQNwMAIAsgECALKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgACAFKQMAIhAgACkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDyAQIA8pAwCFQiCJIhA3AwAgCiAQIAopAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAAgECAAKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAPIBAgDykDAIVCMIkiEDcDACAKIBAgCikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAEgBikDACIQIAEpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAwgECAMKQMAhUIgiSIQNwMAIAsgECALKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACABIBAgASkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDCAQIAwpAwCFQjCJIhA3AwAgCyAQIAspAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACACIAcpAwAiECACKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACANIBAgDSkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAiAQIAIpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA0gECANKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgAyAEKQMAIhAgAykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDiAQIA4pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAQgECAEKQMAhUIoiSIQNwMAIAMgECADKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAOIBAgDikDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBCAQIAQpAwCFQgGJNwMAC98aAQN/QQAhBEEAIAIpAwAgASkDAIU3A5AIQQAgAikDCCABKQMIhTcDmAhBACACKQMQIAEpAxCFNwOgCEEAIAIpAxggASkDGIU3A6gIQQAgAikDICABKQMghTcDsAhBACACKQMoIAEpAyiFNwO4CEEAIAIpAzAgASkDMIU3A8AIQQAgAikDOCABKQM4hTcDyAhBACACKQNAIAEpA0CFNwPQCEEAIAIpA0ggASkDSIU3A9gIQQAgAikDUCABKQNQhTcD4AhBACACKQNYIAEpA1iFNwPoCEEAIAIpA2AgASkDYIU3A/AIQQAgAikDaCABKQNohTcD+AhBACACKQNwIAEpA3CFNwOACUEAIAIpA3ggASkDeIU3A4gJQQAgAikDgAEgASkDgAGFNwOQCUEAIAIpA4gBIAEpA4gBhTcDmAlBACACKQOQASABKQOQAYU3A6AJQQAgAikDmAEgASkDmAGFNwOoCUEAIAIpA6ABIAEpA6ABhTcDsAlBACACKQOoASABKQOoAYU3A7gJQQAgAikDsAEgASkDsAGFNwPACUEAIAIpA7gBIAEpA7gBhTcDyAlBACACKQPAASABKQPAAYU3A9AJQQAgAikDyAEgASkDyAGFNwPYCUEAIAIpA9ABIAEpA9ABhTcD4AlBACACKQPYASABKQPYAYU3A+gJQQAgAikD4AEgASkD4AGFNwPwCUEAIAIpA+gBIAEpA+gBhTcD+AlBACACKQPwASABKQPwAYU3A4AKQQAgAikD+AEgASkD+AGFNwOICkEAIAIpA4ACIAEpA4AChTcDkApBACACKQOIAiABKQOIAoU3A5gKQQAgAikDkAIgASkDkAKFNwOgCkEAIAIpA5gCIAEpA5gChTcDqApBACACKQOgAiABKQOgAoU3A7AKQQAgAikDqAIgASkDqAKFNwO4CkEAIAIpA7ACIAEpA7AChTcDwApBACACKQO4AiABKQO4AoU3A8gKQQAgAikDwAIgASkDwAKFNwPQCkEAIAIpA8gCIAEpA8gChTcD2ApBACACKQPQAiABKQPQAoU3A+AKQQAgAikD2AIgASkD2AKFNwPoCkEAIAIpA+ACIAEpA+AChTcD8ApBACACKQPoAiABKQPoAoU3A/gKQQAgAikD8AIgASkD8AKFNwOAC0EAIAIpA/gCIAEpA/gChTcDiAtBACACKQOAAyABKQOAA4U3A5ALQQAgAikDiAMgASkDiAOFNwOYC0EAIAIpA5ADIAEpA5ADhTcDoAtBACACKQOYAyABKQOYA4U3A6gLQQAgAikDoAMgASkDoAOFNwOwC0EAIAIpA6gDIAEpA6gDhTcDuAtBACACKQOwAyABKQOwA4U3A8ALQQAgAikDuAMgASkDuAOFNwPIC0EAIAIpA8ADIAEpA8ADhTcD0AtBACACKQPIAyABKQPIA4U3A9gLQQAgAikD0AMgASkD0AOFNwPgC0EAIAIpA9gDIAEpA9gDhTcD6AtBACACKQPgAyABKQPgA4U3A/ALQQAgAikD6AMgASkD6AOFNwP4C0EAIAIpA/ADIAEpA/ADhTcDgAxBACACKQP4AyABKQP4A4U3A4gMQQAgAikDgAQgASkDgASFNwOQDEEAIAIpA4gEIAEpA4gEhTcDmAxBACACKQOQBCABKQOQBIU3A6AMQQAgAikDmAQgASkDmASFNwOoDEEAIAIpA6AEIAEpA6AEhTcDsAxBACACKQOoBCABKQOoBIU3A7gMQQAgAikDsAQgASkDsASFNwPADEEAIAIpA7gEIAEpA7gEhTcDyAxBACACKQPABCABKQPABIU3A9AMQQAgAikDyAQgASkDyASFNwPYDEEAIAIpA9AEIAEpA9AEhTcD4AxBACACKQPYBCABKQPYBIU3A+gMQQAgAikD4AQgASkD4ASFNwPwDEEAIAIpA+gEIAEpA+gEhTcD+AxBACACKQPwBCABKQPwBIU3A4ANQQAgAikD+AQgASkD+ASFNwOIDUEAIAIpA4AFIAEpA4AFhTcDkA1BACACKQOIBSABKQOIBYU3A5gNQQAgAikDkAUgASkDkAWFNwOgDUEAIAIpA5gFIAEpA5gFhTcDqA1BACACKQOgBSABKQOgBYU3A7ANQQAgAikDqAUgASkDqAWFNwO4DUEAIAIpA7AFIAEpA7AFhTcDwA1BACACKQO4BSABKQO4BYU3A8gNQQAgAikDwAUgASkDwAWFNwPQDUEAIAIpA8gFIAEpA8gFhTcD2A1BACACKQPQBSABKQPQBYU3A+ANQQAgAikD2AUgASkD2AWFNwPoDUEAIAIpA+AFIAEpA+AFhTcD8A1BACACKQPoBSABKQPoBYU3A/gNQQAgAikD8AUgASkD8AWFNwOADkEAIAIpA/gFIAEpA/gFhTcDiA5BACACKQOABiABKQOABoU3A5AOQQAgAikDiAYgASkDiAaFNwOYDkEAIAIpA5AGIAEpA5AGhTcDoA5BACACKQOYBiABKQOYBoU3A6gOQQAgAikDoAYgASkDoAaFNwOwDkEAIAIpA6gGIAEpA6gGhTcDuA5BACACKQOwBiABKQOwBoU3A8AOQQAgAikDuAYgASkDuAaFNwPIDkEAIAIpA8AGIAEpA8AGhTcD0A5BACACKQPIBiABKQPIBoU3A9gOQQAgAikD0AYgASkD0AaFNwPgDkEAIAIpA9gGIAEpA9gGhTcD6A5BACACKQPgBiABKQPgBoU3A/AOQQAgAikD6AYgASkD6AaFNwP4DkEAIAIpA/AGIAEpA/AGhTcDgA9BACACKQP4BiABKQP4BoU3A4gPQQAgAikDgAcgASkDgAeFNwOQD0EAIAIpA4gHIAEpA4gHhTcDmA9BACACKQOQByABKQOQB4U3A6APQQAgAikDmAcgASkDmAeFNwOoD0EAIAIpA6AHIAEpA6AHhTcDsA9BACACKQOoByABKQOoB4U3A7gPQQAgAikDsAcgASkDsAeFNwPAD0EAIAIpA7gHIAEpA7gHhTcDyA9BACACKQPAByABKQPAB4U3A9APQQAgAikDyAcgASkDyAeFNwPYD0EAIAIpA9AHIAEpA9AHhTcD4A9BACACKQPYByABKQPYB4U3A+gPQQAgAikD4AcgASkD4AeFNwPwD0EAIAIpA+gHIAEpA+gHhTcD+A9BACACKQPwByABKQPwB4U3A4AQQQAgAikD+AcgASkD+AeFNwOIEEGQCEGYCEGgCEGoCEGwCEG4CEHACEHICEHQCEHYCEHgCEHoCEHwCEH4CEGACUGICRACQZAJQZgJQaAJQagJQbAJQbgJQcAJQcgJQdAJQdgJQeAJQegJQfAJQfgJQYAKQYgKEAJBkApBmApBoApBqApBsApBuApBwApByApB0ApB2ApB4ApB6ApB8ApB+ApBgAtBiAsQAkGQC0GYC0GgC0GoC0GwC0G4C0HAC0HIC0HQC0HYC0HgC0HoC0HwC0H4C0GADEGIDBACQZAMQZgMQaAMQagMQbAMQbgMQcAMQcgMQdAMQdgMQeAMQegMQfAMQfgMQYANQYgNEAJBkA1BmA1BoA1BqA1BsA1BuA1BwA1ByA1B0A1B2A1B4A1B6A1B8A1B+A1BgA5BiA4QAkGQDkGYDkGgDkGoDkGwDkG4DkHADkHIDkHQDkHYDkHgDkHoDkHwDkH4DkGAD0GIDxACQZAPQZgPQaAPQagPQbAPQbgPQcAPQcgPQdAPQdgPQeAPQegPQfAPQfgPQYAQQYgQEAJBkAhBmAhBkAlBmAlBkApBmApBkAtBmAtBkAxBmAxBkA1BmA1BkA5BmA5BkA9BmA8QAkGgCEGoCEGgCUGoCUGgCkGoCkGgC0GoC0GgDEGoDEGgDUGoDUGgDkGoDkGgD0GoDxACQbAIQbgIQbAJQbgJQbAKQbgKQbALQbgLQbAMQbgMQbANQbgNQbAOQbgOQbAPQbgPEAJBwAhByAhBwAlByAlBwApByApBwAtByAtBwAxByAxBwA1ByA1BwA5ByA5BwA9ByA8QAkHQCEHYCEHQCUHYCUHQCkHYCkHQC0HYC0HQDEHYDEHQDUHYDUHQDkHYDkHQD0HYDxACQeAIQegIQeAJQegJQeAKQegKQeALQegLQeAMQegMQeANQegNQeAOQegOQeAPQegPEAJB8AhB+AhB8AlB+AlB8ApB+ApB8AtB+AtB8AxB+AxB8A1B+A1B8A5B+A5B8A9B+A8QAkGACUGICUGACkGICkGAC0GIC0GADEGIDEGADUGIDUGADkGIDkGAD0GID0GAEEGIEBACAkACQCADRQ0AA0AgACAEaiIDIAIgBGoiBSkDACABIARqIgYpAwCFIARBkAhqKQMAhSADKQMAhTcDACADQQhqIgMgBUEIaikDACAGQQhqKQMAhSAEQZgIaikDAIUgAykDAIU3AwAgBEEQaiIEQYAIRw0ADAILC0EAIQQDQCAAIARqIgMgAiAEaiIFKQMAIAEgBGoiBikDAIUgBEGQCGopAwCFNwMAIANBCGogBUEIaikDACAGQQhqKQMAhSAEQZgIaikDAIU3AwAgBEEQaiIEQYAIRw0ACwsL5QcMBX8BfgR/An4BfwF+AX8Bfgd/AX4DfwF+AkBBACgCgAgiAiABQQp0aiIDKAIIIAFHDQAgAygCDCEEIAMoAgAhBUEAIAMoAhQiBq03A7gQQQAgBK0iBzcDsBBBACAFIAEgBUECdG4iCGwiCUECdK03A6gQAkACQAJAAkAgBEUNAEF/IQogBUUNASAIQQNsIQsgCEECdCIErSEMIAWtIQ0gBkF/akECSSEOQgAhDwNAQQAgDzcDkBAgD6chEEIAIRFBACEBA0BBACARNwOgECAPIBGEUCIDIA5xIRIgBkEBRiAPUCITIAZBAkYgEUICVHFxciEUQX8gAUEBakEDcSAIbEF/aiATGyEVIAEgEHIhFiABIAhsIRcgA0EBdCEYQgAhGQNAQQBCADcDwBBBACAZNwOYECAYIQECQCASRQ0AQQBCATcDwBBBkBhBkBBBkCBBABADQZAYQZAYQZAgQQAQA0ECIQELAkAgASAITw0AIAQgGaciGmwgF2ogAWohAwNAIANBACAEIAEbQQAgEVAiGxtqQX9qIRwCQAJAIBQNAEEAKAKACCICIBxBCnQiHGohCgwBCwJAIAFB/wBxIgINAEEAQQApA8AQQgF8NwPAEEGQGEGQEEGQIEEAEANBkBhBkBhBkCBBABADCyAcQQp0IRwgAkEDdEGQGGohCkEAKAKACCECCyACIANBCnRqIAIgHGogAiAKKQMAIh1CIIinIAVwIBogFhsiHCAEbCABIAFBACAZIBytUSIcGyIKIBsbIBdqIAogC2ogExsgAUUgHHJrIhsgFWqtIB1C/////w+DIh0gHX5CIIggG61+QiCIfSAMgqdqQQp0akEBEAMgA0EBaiEDIAggAUEBaiIBRw0ACwsgGUIBfCIZIA1SDQALIBFCAXwiEachASARQgRSDQALIA9CAXwiDyAHUg0AC0EAKAKACCECCyAJQQx0QYB4aiEXIAVBf2oiCkUNAgwBC0EAQgM3A6AQQQAgBEF/aq03A5AQQYB4IRcLIAIgF2ohGyAIQQx0IQhBACEcA0AgCCAcQQFqIhxsQYB4aiEEQQAhAQNAIBsgAWoiAyADKQMAIAIgBCABamopAwCFNwMAIANBCGoiAyADKQMAIAIgBCABQQhyamopAwCFNwMAIAFBCGohAyABQRBqIQEgA0H4B0kNAAsgHCAKRw0ACwsgAiAXaiEbQXghAQNAIAIgAWoiA0EIaiAbIAFqIgRBCGopAwA3AwAgA0EQaiAEQRBqKQMANwMAIANBGGogBEEYaikDADcDACADQSBqIARBIGopAwA3AwAgAUEgaiIBQfgHSQ0ACwsL";
var hash$k = "e4cdc523";
var wasmJson$k = {
  name: name$k,
  data: data$k,
  hash: hash$k
};
var name$j = "blake2b";
var data$j = "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";
var hash$j = "c6f286e6";
var wasmJson$j = {
  name: name$j,
  data: data$j,
  hash: hash$j
};
var mutex$k = new Mutex();
function validateBits$4(bits) {
  if (!Number.isInteger(bits) || bits < 8 || bits > 512 || bits % 8 !== 0) {
    return new Error("Invalid variant! Valid values: 8, 16, ..., 512");
  }
  return null;
}
function getInitParam$1(outputBits, keyBits) {
  return outputBits | keyBits << 16;
}
function createBLAKE2b(bits = 512, key = null) {
  if (validateBits$4(bits)) {
    return Promise.reject(validateBits$4(bits));
  }
  let keyBuffer = null;
  let initParam = bits;
  if (key !== null) {
    keyBuffer = getUInt8Buffer(key);
    if (keyBuffer.length > 64) {
      return Promise.reject(new Error("Max key length is 64 bytes"));
    }
    initParam = getInitParam$1(bits, keyBuffer.length);
  }
  const outputSize = bits / 8;
  return WASMInterface(wasmJson$j, outputSize).then((wasm) => {
    if (initParam > 512) {
      wasm.writeMemory(keyBuffer);
    }
    wasm.init(initParam);
    const obj = {
      init: initParam > 512 ? () => {
        wasm.writeMemory(keyBuffer);
        wasm.init(initParam);
        return obj;
      } : () => {
        wasm.init(initParam);
        return obj;
      },
      update: (data) => {
        wasm.update(data);
        return obj;
      },
      // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
      digest: (outputType) => wasm.digest(outputType),
      save: () => wasm.save(),
      load: (data) => {
        wasm.load(data);
        return obj;
      },
      blockSize: 128,
      digestSize: outputSize
    };
    return obj;
  });
}
function encodeResult(salt, options, res) {
  const parameters = [
    `m=${options.memorySize}`,
    `t=${options.iterations}`,
    `p=${options.parallelism}`
  ].join(",");
  return `$argon2${options.hashType}$v=19$${parameters}$${encodeBase64(salt, false)}$${encodeBase64(res, false)}`;
}
var uint32View = new DataView(new ArrayBuffer(4));
function int32LE(x) {
  uint32View.setInt32(0, x, true);
  return new Uint8Array(uint32View.buffer);
}
function hashFunc(blake512, buf, len) {
  return __awaiter(this, void 0, void 0, function* () {
    if (len <= 64) {
      const blake = yield createBLAKE2b(len * 8);
      blake.update(int32LE(len));
      blake.update(buf);
      return blake.digest("binary");
    }
    const r = Math.ceil(len / 32) - 2;
    const ret = new Uint8Array(len);
    blake512.init();
    blake512.update(int32LE(len));
    blake512.update(buf);
    let vp = blake512.digest("binary");
    ret.set(vp.subarray(0, 32), 0);
    for (let i = 1; i < r; i++) {
      blake512.init();
      blake512.update(vp);
      vp = blake512.digest("binary");
      ret.set(vp.subarray(0, 32), i * 32);
    }
    const partialBytesNeeded = len - 32 * r;
    let blakeSmall;
    if (partialBytesNeeded === 64) {
      blakeSmall = blake512;
      blakeSmall.init();
    } else {
      blakeSmall = yield createBLAKE2b(partialBytesNeeded * 8);
    }
    blakeSmall.update(vp);
    vp = blakeSmall.digest("binary");
    ret.set(vp.subarray(0, partialBytesNeeded), r * 32);
    return ret;
  });
}
function getHashType(type) {
  switch (type) {
    case "d":
      return 0;
    case "i":
      return 1;
    default:
      return 2;
  }
}
function argon2Internal(options) {
  return __awaiter(this, void 0, void 0, function* () {
    var _a2;
    const { parallelism, iterations, hashLength } = options;
    const password = getUInt8Buffer(options.password);
    const salt = getUInt8Buffer(options.salt);
    const version = 19;
    const hashType = getHashType(options.hashType);
    const { memorySize } = options;
    const secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
    const [argon2Interface, blake512] = yield Promise.all([
      WASMInterface(wasmJson$k, 1024),
      createBLAKE2b(512)
    ]);
    argon2Interface.setMemorySize(memorySize * 1024 + 1024);
    const initVector = new Uint8Array(24);
    const initVectorView = new DataView(initVector.buffer);
    initVectorView.setInt32(0, parallelism, true);
    initVectorView.setInt32(4, hashLength, true);
    initVectorView.setInt32(8, memorySize, true);
    initVectorView.setInt32(12, iterations, true);
    initVectorView.setInt32(16, version, true);
    initVectorView.setInt32(20, hashType, true);
    argon2Interface.writeMemory(initVector, memorySize * 1024);
    blake512.init();
    blake512.update(initVector);
    blake512.update(int32LE(password.length));
    blake512.update(password);
    blake512.update(int32LE(salt.length));
    blake512.update(salt);
    blake512.update(int32LE(secret.length));
    blake512.update(secret);
    blake512.update(int32LE(0));
    const segments = Math.floor(memorySize / (parallelism * 4));
    const lanes = segments * 4;
    const param = new Uint8Array(72);
    const H0 = blake512.digest("binary");
    param.set(H0);
    for (let lane = 0; lane < parallelism; lane++) {
      param.set(int32LE(0), 64);
      param.set(int32LE(lane), 68);
      let position = lane * lanes;
      let chunk = yield hashFunc(blake512, param, 1024);
      argon2Interface.writeMemory(chunk, position * 1024);
      position += 1;
      param.set(int32LE(1), 64);
      chunk = yield hashFunc(blake512, param, 1024);
      argon2Interface.writeMemory(chunk, position * 1024);
    }
    const C = new Uint8Array(1024);
    writeHexToUInt8(C, argon2Interface.calculate(new Uint8Array([]), memorySize));
    const res = yield hashFunc(blake512, C, hashLength);
    if (options.outputType === "hex") {
      const digestChars = new Uint8Array(hashLength * 2);
      return getDigestHex(digestChars, res, hashLength);
    }
    if (options.outputType === "encoded") {
      return encodeResult(salt, options, res);
    }
    return res;
  });
}
var validateOptions$3 = (options) => {
  var _a2;
  if (!options || typeof options !== "object") {
    throw new Error("Invalid options parameter. It requires an object.");
  }
  if (!options.password) {
    throw new Error("Password must be specified");
  }
  options.password = getUInt8Buffer(options.password);
  if (options.password.length < 1) {
    throw new Error("Password must be specified");
  }
  if (!options.salt) {
    throw new Error("Salt must be specified");
  }
  options.salt = getUInt8Buffer(options.salt);
  if (options.salt.length < 8) {
    throw new Error("Salt should be at least 8 bytes long");
  }
  options.secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
  if (!Number.isInteger(options.iterations) || options.iterations < 1) {
    throw new Error("Iterations should be a positive number");
  }
  if (!Number.isInteger(options.parallelism) || options.parallelism < 1) {
    throw new Error("Parallelism should be a positive number");
  }
  if (!Number.isInteger(options.hashLength) || options.hashLength < 4) {
    throw new Error("Hash length should be at least 4 bytes.");
  }
  if (!Number.isInteger(options.memorySize)) {
    throw new Error("Memory size should be specified.");
  }
  if (options.memorySize < 8 * options.parallelism) {
    throw new Error("Memory size should be at least 8 * parallelism.");
  }
  if (options.outputType === void 0) {
    options.outputType = "hex";
  }
  if (!["hex", "binary", "encoded"].includes(options.outputType)) {
    throw new Error(`Insupported output type ${options.outputType}. Valid values: ['hex', 'binary', 'encoded']`);
  }
};
function argon2id(options) {
  return __awaiter(this, void 0, void 0, function* () {
    validateOptions$3(options);
    return argon2Internal(Object.assign(Object.assign({}, options), { hashType: "id" }));
  });
}
var mutex$j = new Mutex();
var mutex$i = new Mutex();
var mutex$h = new Mutex();
var mutex$g = new Mutex();
var polyBuffer = new Uint8Array(8);
var mutex$f = new Mutex();
var mutex$e = new Mutex();
var mutex$d = new Mutex();
var mutex$c = new Mutex();
var mutex$b = new Mutex();
var mutex$a = new Mutex();
var mutex$9 = new Mutex();
var mutex$8 = new Mutex();
var mutex$7 = new Mutex();
var mutex$6 = new Mutex();
var mutex$5 = new Mutex();
var seedBuffer$2 = new Uint8Array(8);
var mutex$4 = new Mutex();
var seedBuffer$1 = new Uint8Array(8);
var mutex$3 = new Mutex();
var seedBuffer = new Uint8Array(8);
var mutex$2 = new Mutex();
var mutex$1 = new Mutex();
var mutex = new Mutex();

// src/vault-encryption.ts
var _VaultEncryption = class {
  constructor(dek) {
    this.dek = dek;
  }
  /**
   * Create a VaultEncryption instance by decrypting an encrypted DEK using a Secret Key.
   */
  static async fromSecretKey(secretKey, saltHex, encryptedDekHex) {
    const kek = await this.deriveKEK(secretKey, saltHex);
    const encryptedDek = hexToBytes(encryptedDekHex);
    const dekBytes = await this.decryptWithKey(encryptedDek, kek);
    const dek = await crypto.subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, true, [
      "encrypt",
      "decrypt"
    ]);
    return new _VaultEncryption(dek);
  }
  /**
   * Initialize a fresh E2EE setup:
   * 1. Generate a random Secret Key.
   * 2. Generate a random Salt.
   * 3. Derive KEK.
   * 4. Generate a random DEK.
   * 5. Encrypt DEK with KEK.
   *
   * Returns { secretKey, salt, encryptedDek, instance }.
   */
  static async setupNew() {
    const secretKey = this.generateSecretKey();
    const saltBytes = crypto.getRandomValues(new Uint8Array(32));
    const salt = bytesToHex(saltBytes);
    const kek = await this.deriveKEK(secretKey, salt);
    const dekBytes = crypto.getRandomValues(new Uint8Array(32));
    const dek = await crypto.subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, true, [
      "encrypt",
      "decrypt"
    ]);
    const encryptedDekBytes = await this.encryptWithKey(dekBytes, kek);
    const encryptedDek = bytesToHex(new Uint8Array(encryptedDekBytes));
    return {
      secretKey,
      salt,
      encryptedDek,
      instance: new _VaultEncryption(dek)
    };
  }
  /**
   * Derive a Key Encryption Key (KEK) from the Secret Key using Argon2id.
   */
  static async deriveKEK(secretKey, saltHex) {
    const salt = hexToBytes(saltHex);
    const hash = await argon2id({
      password: secretKey,
      salt,
      iterations: 3,
      memorySize: 64 * 1024,
      // 64MB
      parallelism: 1,
      hashLength: 32,
      // 256-bit key
      outputType: "binary"
    });
    return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }
  /**
   * Generate a random 16-character alphanumeric Secret Key (e.g., H7K2-M9P4-L1X6-R8T5).
   */
  static generateSecretKey() {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const random = crypto.getRandomValues(new Uint8Array(16));
    let result = "";
    for (let i = 0; i < 16; i++) {
      if (i > 0 && i % 4 === 0)
        result += "-";
      result += charset[random[i] % charset.length];
    }
    return result;
  }
  /**
   * Encrypt data with the DEK.
   * Output: [ 12-byte IV | ciphertext + 16-byte GCM tag ]
   */
  async encrypt(data) {
    return _VaultEncryption.encryptWithKey(data, this.dek);
  }
  /**
   * Decrypt data with the DEK.
   */
  async decrypt(data) {
    return _VaultEncryption.decryptWithKey(data, this.dek);
  }
  /**
   * Calculate HMAC-SHA256 of the plaintext for deduplication.
   * Keyed by the DEK.
   */
  async calculateHMAC(data) {
    const dekBytes = await crypto.subtle.exportKey("raw", this.dek);
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      dekBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", hmacKey, data);
    return bytesToHex(new Uint8Array(signature));
  }
  /**
   * Create a verification token for the server.
   * Encrypts "syncagain-v1" with the DEK.
   */
  async createKeyVerificationToken() {
    const plaintext = new TextEncoder().encode(_VaultEncryption.VERIFICATION_PLAINTEXT);
    const ciphertext = await this.encrypt(plaintext.buffer);
    return btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  }
  /**
   * Verify a token from the server.
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
  /**
   * Export the raw DEK bytes for local storage (auto-unlock).
   */
  async exportDEK() {
    const bytes = await crypto.subtle.exportKey("raw", this.dek);
    return bytesToHex(new Uint8Array(bytes));
  }
  /**
   * Import DEK from hex string.
   */
  static async importDEK(dekHex) {
    const bytes = hexToBytes(dekHex);
    const dek = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, true, [
      "encrypt",
      "decrypt"
    ]);
    return new _VaultEncryption(dek);
  }
  // ── Helpers ──────────────────────────────────────────────────────────────
  static async encryptWithKey(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    const out = new Uint8Array(12 + ciphertext.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ciphertext), 12);
    return out.buffer;
  }
  static async decryptWithKey(data, key) {
    const bytes = new Uint8Array(data);
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  }
};
var VaultEncryption = _VaultEncryption;
VaultEncryption.VERIFICATION_PLAINTEXT = "syncagain-v1";
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
    const locallyEnabled = {};
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
  async negotiateAll(_serverFeatures, vaultState, local, plugin) {
    const results = [];
    for (const negotiator of this.negotiators) {
      const result = await negotiator.negotiate(vaultState, local, plugin);
      results.push(result);
    }
    return results;
  }
};

// src/features/e2ee-join-modal.ts
var import_obsidian7 = require("obsidian");
function showJoinE2EEModal(app, plugin, e2ee) {
  new JoinE2EEModal(app, plugin, e2ee).open();
}
var JoinE2EEModal = class extends import_obsidian7.Modal {
  constructor(app, plugin, e2ee) {
    super(app);
    this.plugin = plugin;
    this.e2ee = e2ee;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Unlock encrypted vault");
    contentEl.createEl("p", {
      text: "End-to-end encryption is enabled for this vault. Enter the secret key from the device that originally enabled E2EE to unlock this vault on this device.",
      cls: "setting-item-description"
    });
    let secretKey = "";
    new import_obsidian7.Setting(contentEl).setName("Secret key").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("xxxx-xxxx-xxxx-xxxx").onChange((value) => {
        secretKey = value.trim();
      });
      text.inputEl.focus();
    });
    const errorEl = contentEl.createEl("p", { cls: "syncagain-modal-error" });
    const buttonRow = contentEl.createDiv({ cls: "syncagain-secret-key-buttons" });
    buttonRow.createEl("button", { text: "Cancel" }).onClickEvent(() => this.close());
    const unlockBtn = buttonRow.createEl("button", { text: "Unlock", cls: "mod-cta" });
    unlockBtn.onClickEvent(async () => {
      errorEl.setText("");
      if (!secretKey) {
        errorEl.setText("Please enter your secret key.");
        return;
      }
      if (!this.e2ee.salt || !this.e2ee.encrypted_dek || !this.e2ee.key_verification_token) {
        errorEl.setText("Server config is incomplete; cannot unlock.");
        return;
      }
      unlockBtn.setText("Unlocking\u2026");
      unlockBtn.setAttribute("disabled", "true");
      try {
        const enc = await VaultEncryption.fromSecretKey(
          secretKey,
          this.e2ee.salt,
          this.e2ee.encrypted_dek
        );
        const valid = await enc.verifyKeyToken(this.e2ee.key_verification_token);
        if (!valid) {
          errorEl.setText("Incorrect secret key. Double-check the key from your other device.");
          unlockBtn.setText("Unlock");
          unlockBtn.removeAttribute("disabled");
          return;
        }
        this.plugin.settings.encryptionStatus = this.e2ee.status;
        this.plugin.settings.encryptionEnabled = true;
        this.plugin.settings.encryptionSecretKey = secretKey;
        this.plugin.settings.encryptionSalt = this.e2ee.salt;
        this.plugin.settings.encryptionDEK = await enc.exportDEK();
        await this.plugin.saveSettings();
        new import_obsidian7.Notice("Vault unlocked. Sync will resume.");
        this.close();
        this.plugin.restartSync();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorEl.setText(`Failed to unlock: ${msg}`);
        unlockBtn.setText("Unlock");
        unlockBtn.removeAttribute("disabled");
      }
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/features/e2ee-negotiator.ts
var E2EENegotiator = class {
  constructor() {
    this.featureId = "e2ee";
  }
  async negotiate(vaultState, local, plugin) {
    var _a2, _b;
    const e2ee = vaultState.e2ee;
    console.debug(
      `[SyncAgain] e2ee-negotiator \u2014 localStatus=${local.encryptionStatus} serverStatus=${(_a2 = e2ee == null ? void 0 : e2ee.status) != null ? _a2 : "<none>"} initiator=${(_b = e2ee == null ? void 0 : e2ee.initiator_id) != null ? _b : "<none>"} localCid=${local.clientId} hasLocalDEK=${!!local.encryptionDEK}`
    );
    if (!e2ee || e2ee.status === "DISABLED") {
      if (local.encryptionStatus !== "DISABLED") {
        const prev = local.encryptionStatus;
        local.encryptionStatus = "DISABLED";
        local.encryptionEnabled = false;
        local.encryptionSecretKey = "";
        local.encryptionDEK = "";
        local.encryptionSalt = "";
        await plugin.saveSettings();
        console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} \u2192 DISABLED (negotiator-case1)`);
        return { status: "reconfigured" };
      }
      return { status: "ok" };
    }
    if (local.encryptionStatus !== e2ee.status) {
      const prev = local.encryptionStatus;
      local.encryptionStatus = e2ee.status;
      local.encryptionEnabled = true;
      await plugin.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} \u2192 ${e2ee.status} (negotiator-sync)`);
    }
    await this.tryRestoreFromCache(e2ee, local, plugin);
    if ((e2ee.status === "MIGRATING" || e2ee.status === "MIGRATING_TO_OFF") && e2ee.initiator_id === local.clientId) {
      if (!local.encryptionDEK) {
        return {
          status: "blocked",
          reason: "You are the initiator of a migration but your local encryption key is missing."
        };
      }
      return { status: "ok" };
    }
    if (e2ee.status === "MIGRATING" || e2ee.status === "MIGRATING_TO_OFF") {
      if (!local.encryptionDEK && !local.encryptionSecretKey && e2ee.salt && e2ee.encrypted_dek && e2ee.key_verification_token) {
        return {
          status: "blocked",
          reason: "Another device is migrating this vault to E2EE. Enter the secret key from that device to unlock and read encrypted files on this device.",
          userAction: () => showJoinE2EEModal(plugin.app, plugin, e2ee)
        };
      }
      return {
        status: "blocked",
        reason: "Vault is currently migrating to/from E2EE. Please wait for the process to complete."
      };
    }
    if (e2ee.status === "ACTIVE") {
      if (!local.encryptionDEK && !local.encryptionSecretKey) {
        return {
          status: "blocked",
          reason: "This vault is encrypted. Enter the secret key to unlock it on this device.",
          userAction: () => showJoinE2EEModal(plugin.app, plugin, e2ee)
        };
      }
      if (!local.encryptionDEK && local.encryptionSecretKey) {
        try {
          const enc = await VaultEncryption.fromSecretKey(
            local.encryptionSecretKey,
            e2ee.salt,
            e2ee.encrypted_dek
          );
          const valid = await enc.verifyKeyToken(e2ee.key_verification_token);
          if (!valid) {
            return {
              status: "blocked",
              reason: "Secret key is incorrect or was rotated. Update it in settings."
            };
          }
          local.encryptionDEK = await enc.exportDEK();
          local.encryptionSalt = e2ee.salt;
          await plugin.saveSettings();
          return { status: "reconfigured" };
        } catch (err) {
          return {
            status: "blocked",
            reason: `Failed to unlock vault: ${err instanceof Error ? err.message : String(err)}`
          };
        }
      }
      try {
        const enc = await VaultEncryption.importDEK(local.encryptionDEK);
        const valid = await enc.verifyKeyToken(e2ee.key_verification_token);
        if (!valid) {
          local.encryptionDEK = "";
          await plugin.saveSettings();
          return { status: "reconfigured" };
        }
        return { status: "ok" };
      } catch (e) {
        return { status: "blocked", reason: "Failed to verify local encryption key." };
      }
    }
    return { status: "ok" };
  }
  /**
   * Restore E2EE key material for this (account, vault) from the cross-sign-out
   * cache, if present and still valid. Returns true if it restored a key.
   *
   * No-op when the device already holds key material. The cached DEK is verified
   * against the server's `key_verification_token` before adoption, so a stale
   * entry (e.g. the secret key was rotated on another device while this one was
   * signed out) is discarded rather than adopted, letting the caller fall back
   * to the unlock prompt.
   */
  async tryRestoreFromCache(e2ee, local, plugin) {
    if (local.encryptionDEK || local.encryptionSecretKey)
      return false;
    if (!local.userId || !local.remoteVaultId)
      return false;
    if (!e2ee.key_verification_token)
      return false;
    const entry = local.cachedVaultKeys[`${local.userId}:${local.remoteVaultId}`];
    if (!(entry == null ? void 0 : entry.dek))
      return false;
    try {
      const enc = await VaultEncryption.importDEK(entry.dek);
      if (!await enc.verifyKeyToken(e2ee.key_verification_token)) {
        delete local.cachedVaultKeys[`${local.userId}:${local.remoteVaultId}`];
        await plugin.saveSettings();
        return false;
      }
      local.encryptionSecretKey = entry.secretKey;
      local.encryptionSalt = entry.salt;
      local.encryptionDEK = entry.dek;
      await plugin.saveSettings();
      console.debug("[SyncAgain] e2ee-negotiator \u2014 restored key from cross-sign-out cache");
      return true;
    } catch (e) {
      return false;
    }
  }
};

// src/main.ts
var SyncAgainPlugin = class extends import_obsidian8.Plugin {
  constructor() {
    super(...arguments);
    this.connectionStatus = "disconnected";
    /** Feature names granted to this account by the server (e.g. ["e2ee"]). */
    this.accountFeatures = [];
    /** Most recent server config received via WebSocket pong. */
    this.serverConfig = null;
    this.syncIntervalId = null;
    this.statusBarEl = null;
    /**
     * Set by `loadSettings` when migrating away from a previously-stored
     * anonymous account. Consumed by the layout-ready callback to show a
     * one-time notice explaining that the user has been signed out.
     */
    this.signedOutFromAnonymous = false;
    /**
     * Set to true by `initVaultIfNeeded` after the handshake returns
     * `created: true`. The next `onConfig` consumes the flag and PUTs this
     * device's local synced settings, initialising the server-side row.
     */
    this.pendingSettingsFirstWrite = false;
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
    this.syncManager.onCycleDrained = () => {
      void this.tryAutoFinalizeE2EE();
    };
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
      var _a2;
      const token = params["token"];
      const userId = params["user_id"];
      const email = (_a2 = params["email"]) != null ? _a2 : "";
      if (!token || !userId) {
        new import_obsidian8.Notice("Auth callback is missing token or user ID.");
        return;
      }
      await this.signIn({ userId, userEmail: email, authToken: token });
      new import_obsidian8.Notice(`Signed in as ${email || userId}`);
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
      if (this.signedOutFromAnonymous) {
        this.signedOutFromAnonymous = false;
        new import_obsidian8.Notice(
          "Anonymous accounts are no longer supported. Sign in or create an account in plugin settings to resume syncing.",
          15e3
        );
      }
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
   * No-op when not signed in.
   */
  startSync() {
    if (!this.settings.authToken)
      return;
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
    var _a2;
    try {
      const result = await this.api.vaultHandshake(this.app.vault.getName());
      if (result.created) {
        this.settings.remoteVaultId = result.vault.vault_id;
        this.api.setRemoteVaultId(result.vault.vault_id);
        this.pendingSettingsFirstWrite = true;
        await this.saveSettings();
        this.startSync();
      } else {
        showVaultPickerModal(this.app, result.vaults, this);
      }
    } catch (err) {
      console.warn("[SyncAgain] Vault handshake failed:", err);
      new import_obsidian8.Notice("Failed to connect to remote vault. Check server URL and try again.", 8e3);
      (_a2 = this.settingTab) == null ? void 0 : _a2.display();
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
    var _a2, _b, _c;
    this.serverConfig = config;
    this.accountFeatures = (_a2 = config.features) != null ? _a2 : [];
    await this.applySyncedSettings(config);
    FeatureGate.validateConsistency(config.features, this.settings, this);
    const results = await this.coordinator.negotiateAll(
      config.features,
      config.vault,
      this.settings,
      this
    );
    (_b = this.settingTab) == null ? void 0 : _b.display();
    const blocked = results.filter((r) => r.status === "blocked");
    if (blocked.length > 0) {
      this.clearSyncInterval();
      for (const b of blocked) {
        if (b.status === "blocked") {
          new import_obsidian8.Notice(b.reason, 1e4);
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
  /**
   * Reconcile `settings.syncIntervalMinutes` with the server's authoritative
   * copy and either:
   *   - PUT this device's local interval (only on first-write after a freshly
   *     created vault), or
   *   - Adopt the server's interval, re-pacing the loop if it changed.
   *
   * `syncEnabled` is intentionally *not* synced — it's per-device intent.
   * See `SYNCED_SETTINGS.md` §2 / §7.
   */
  async applySyncedSettings(config) {
    const vault = config.vault;
    if (!vault)
      return;
    if (!vault.vault_settings_initialized && this.pendingSettingsFirstWrite) {
      this.pendingSettingsFirstWrite = false;
      try {
        await this.api.updateVaultSettings(this.settings.remoteVaultId, {
          sync_interval_minutes: this.settings.syncIntervalMinutes
        });
      } catch (err) {
        console.warn("[SyncAgain] First-write of vault settings failed:", err);
      }
      return;
    }
    const remote = vault.settings;
    if (remote.sync_interval_minutes === this.settings.syncIntervalMinutes)
      return;
    this.settings.syncIntervalMinutes = remote.sync_interval_minutes;
    await this.saveSettings();
    if (this.syncIntervalId !== null) {
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
    void this.signOut().then(() => {
      new import_obsidian8.Notice(
        "Session expired or not signed in. Please sign in again in the plugin settings.",
        8e3
      );
    });
  }
  // ── WebSocket control channel status ──────────────────────────────────────
  onControlChannelStatus(status) {
    var _a2;
    this.connectionStatus = status;
    (_a2 = this.settingTab) == null ? void 0 : _a2.updateConnectionStatus(status);
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
   * Surfaces the error to the user. We deliberately do NOT auto-disable E2EE
   * here: the vault may already be `ACTIVE`/`MIGRATING` server-side, in which
   * case dropping encryption would leak plaintext into an encrypted vault.
   * Resolution paths: grant the feature, set `E2EE_FOR_ALL` on the server, or
   * start a rollback through the settings UI.
   */
  handleFeatureNotEnabled(feature) {
    if (feature === "e2ee") {
      new import_obsidian8.Notice(
        "End-to-end encryption is not enabled for this account. Uploads are paused until the 'e2ee' feature is granted, the server is started with E2EE_FOR_ALL=true, or the vault is rolled back to plaintext.",
        15e3
      );
      this.settingTab.display();
    }
  }
  updateStatusBar(status) {
    var _a2, _b;
    if (!this.statusBarEl)
      return;
    const pending = (_b = (_a2 = this.tracker) == null ? void 0 : _a2.pendingCount) != null ? _b : 0;
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
   * disabled or the DEK is not set.
   */
  async buildEncryption() {
    const { encryptionStatus, encryptionDEK } = this.settings;
    if (encryptionStatus === "DISABLED" || !encryptionDEK)
      return null;
    try {
      return await VaultEncryption.importDEK(encryptionDEK);
    } catch (err) {
      console.error("[SyncAgain] Failed to import DEK:", err);
      return null;
    }
  }
  /**
   * Start the migration from plaintext to E2EE.
   * 1. Generate new Secret Key, Salt, and DEK.
   * 2. Send status: MIGRATING to server.
   * 3. Reset sync state to re-upload everything encrypted.
   * 4. Once sync completes (monitored elsewhere or manually), status: ACTIVE.
   */
  async startE2EEMigration() {
    console.debug(
      `[SyncAgain] startE2EEMigration entry \u2014 remoteVaultId=${this.settings.remoteVaultId} localStatus=${this.settings.encryptionStatus}`
    );
    if (!this.settings.remoteVaultId) {
      console.warn("[SyncAgain] startE2EEMigration aborted \u2014 no remoteVaultId");
      return;
    }
    try {
      const { secretKey, salt, encryptedDek, instance } = await VaultEncryption.setupNew();
      const token = await instance.createKeyVerificationToken();
      const dekHex = await instance.exportDEK();
      console.debug("[SyncAgain] PUT /api/vaults/{id}/encryption status=MIGRATING");
      await this.api.putVaultEncryption(this.settings.remoteVaultId, {
        status: "MIGRATING",
        epoch: 1,
        salt,
        encrypted_dek: encryptedDek,
        token
      });
      const prev = this.settings.encryptionStatus;
      this.settings.encryptionStatus = "MIGRATING";
      this.settings.encryptionEnabled = true;
      this.settings.encryptionSecretKey = secretKey;
      this.settings.encryptionSalt = salt;
      this.settings.encryptionDEK = dekHex;
      await this.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} \u2192 MIGRATING (startE2EEMigration)`);
      this.syncManager.setEncryption(instance);
      await this.syncManager.resetSyncState();
      new import_obsidian8.Notice("Encryption migration started. Keep Obsidian open until all files are re-uploaded.");
      this.startSync();
    } catch (err) {
      console.error("[SyncAgain] startE2EEMigration error:", err);
      new import_obsidian8.Notice(`Failed to start E2EE migration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  /**
   * Called by SyncManager after a sync cycle drains the dirty queue with no
   * upload failures. On the pinned initiator, advances the E2EE state machine
   * automatically so the user doesn't have to remember to click "Finalize".
   * Non-initiators ignore the signal — only the initiator may flip the state.
   */
  async tryAutoFinalizeE2EE() {
    var _a2, _b, _c, _d, _e, _f;
    const e2ee = (_b = (_a2 = this.serverConfig) == null ? void 0 : _a2.vault) == null ? void 0 : _b.e2ee;
    const localStatus = this.settings.encryptionStatus;
    const localCid = this.settings.clientId;
    console.debug(
      `[SyncAgain] tryAutoFinalizeE2EE \u2014 localStatus=${localStatus} serverStatus=${(_c = e2ee == null ? void 0 : e2ee.status) != null ? _c : "<no-config>"} initiator=${(_d = e2ee == null ? void 0 : e2ee.initiator_id) != null ? _d : "<none>"} localClientId=${localCid}`
    );
    if (!e2ee || !e2ee.initiator_id) {
      console.debug("[SyncAgain] tryAutoFinalizeE2EE skipped \u2014 no server e2ee state or no initiator");
      return;
    }
    if (e2ee.initiator_id !== localCid) {
      console.debug("[SyncAgain] tryAutoFinalizeE2EE skipped \u2014 not the initiator");
      return;
    }
    if (localStatus === "MIGRATING") {
      console.debug("[SyncAgain] auto-finalizing migration (MIGRATING \u2192 ACTIVE)");
      await this.finalizeE2EEMigration();
      (_e = this.settingTab) == null ? void 0 : _e.display();
    } else if (localStatus === "MIGRATING_TO_OFF") {
      console.debug("[SyncAgain] auto-finalizing rollback (MIGRATING_TO_OFF \u2192 DISABLED)");
      await this.finalizeE2EERollback();
      (_f = this.settingTab) == null ? void 0 : _f.display();
    } else {
      console.debug(`[SyncAgain] tryAutoFinalizeE2EE skipped \u2014 localStatus=${localStatus} not in transitional state`);
    }
  }
  /**
   * Finalize the E2EE migration once all files are uploaded.
   */
  async finalizeE2EEMigration() {
    console.debug(
      `[SyncAgain] finalizeE2EEMigration entry \u2014 remoteVaultId=${this.settings.remoteVaultId} status=${this.settings.encryptionStatus}`
    );
    if (!this.settings.remoteVaultId || this.settings.encryptionStatus !== "MIGRATING") {
      console.warn("[SyncAgain] finalizeE2EEMigration aborted \u2014 preconditions not met");
      return;
    }
    try {
      const enc = await this.buildEncryption();
      if (!enc)
        throw new Error("Encryption instance not available.");
      const token = await enc.createKeyVerificationToken();
      console.debug("[SyncAgain] PUT /api/vaults/{id}/encryption status=ACTIVE");
      await this.api.putVaultEncryption(this.settings.remoteVaultId, {
        status: "ACTIVE",
        epoch: 1,
        token
      });
      const prev = this.settings.encryptionStatus;
      this.settings.encryptionStatus = "ACTIVE";
      await this.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} \u2192 ACTIVE (finalizeE2EEMigration)`);
      new import_obsidian8.Notice("Encryption migration complete. Your vault is now fully encrypted.");
    } catch (err) {
      console.error("[SyncAgain] finalizeE2EEMigration error:", err);
      new import_obsidian8.Notice(`Failed to finalize E2EE migration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  /**
   * Start the rollback from E2EE to plaintext.
   */
  async startE2EERollback() {
    console.debug(
      `[SyncAgain] startE2EERollback entry \u2014 remoteVaultId=${this.settings.remoteVaultId} status=${this.settings.encryptionStatus}`
    );
    if (!this.settings.remoteVaultId || this.settings.encryptionStatus !== "ACTIVE") {
      console.warn("[SyncAgain] startE2EERollback aborted \u2014 preconditions not met");
      return;
    }
    try {
      console.debug("[SyncAgain] PUT /api/vaults/{id}/encryption status=MIGRATING_TO_OFF");
      await this.api.putVaultEncryption(this.settings.remoteVaultId, {
        status: "MIGRATING_TO_OFF",
        epoch: 1
      });
      const prev = this.settings.encryptionStatus;
      this.settings.encryptionStatus = "MIGRATING_TO_OFF";
      await this.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} \u2192 MIGRATING_TO_OFF (startE2EERollback)`);
      this.syncManager.setEncryption(null);
      await this.syncManager.resetSyncState();
      new import_obsidian8.Notice("Rolling back encryption. Files are being re-uploaded in plaintext.");
      this.startSync();
    } catch (err) {
      new import_obsidian8.Notice(`Failed to start E2EE rollback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  /**
   * Finalize the E2EE rollback.
   */
  async finalizeE2EERollback() {
    console.debug(
      `[SyncAgain] finalizeE2EERollback entry \u2014 remoteVaultId=${this.settings.remoteVaultId} status=${this.settings.encryptionStatus}`
    );
    if (!this.settings.remoteVaultId || this.settings.encryptionStatus !== "MIGRATING_TO_OFF") {
      console.warn("[SyncAgain] finalizeE2EERollback aborted \u2014 preconditions not met");
      return;
    }
    try {
      console.debug("[SyncAgain] PUT /api/vaults/{id}/encryption status=DISABLED");
      await this.api.putVaultEncryption(this.settings.remoteVaultId, {
        status: "DISABLED",
        epoch: 0
      });
      const prev = this.settings.encryptionStatus;
      this.settings.encryptionStatus = "DISABLED";
      this.settings.encryptionEnabled = false;
      this.settings.encryptionSecretKey = "";
      this.settings.encryptionDEK = "";
      this.settings.encryptionSalt = "";
      await this.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} \u2192 DISABLED (finalizeE2EERollback)`);
      new import_obsidian8.Notice("Encryption has been disabled.");
    } catch (err) {
      console.error("[SyncAgain] finalizeE2EERollback error:", err);
      new import_obsidian8.Notice(`Failed to finalize E2EE rollback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // ── Settings ──────────────────────────────────────────────────────────────
  async loadSettings() {
    var _a2, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s;
    const raw = (_a2 = await this.loadData()) != null ? _a2 : {};
    const clientId = (_b = raw["clientId"]) != null ? _b : "";
    const serverUrl = (_c = raw["serverUrl"]) != null ? _c : "";
    const syncIntervalMinutes = (_d = raw["syncIntervalMinutes"]) != null ? _d : 5;
    const cachedVaultKeys = (_e = raw["cachedVaultKeys"]) != null ? _e : {};
    let account = {};
    if ("accounts" in raw && typeof raw["accounts"] === "object" && raw["accounts"] !== null) {
      const accounts = raw["accounts"];
      const currentUserId = (_f = raw["currentUserId"]) != null ? _f : "";
      account = (_g = accounts[currentUserId]) != null ? _g : {};
    } else {
      account = raw;
    }
    const userId = (_h = account["userId"]) != null ? _h : "";
    const userEmail = (_i = account["userEmail"]) != null ? _i : "";
    const authToken = (_j = account["authToken"]) != null ? _j : "";
    const wasAnonymous = !!userId && userId === clientId && !userEmail;
    this.signedOutFromAnonymous = wasAnonymous;
    this.settings = {
      ...DEFAULT_SETTINGS,
      clientId,
      serverUrl,
      syncIntervalMinutes,
      userId: wasAnonymous ? "" : userId,
      userEmail: wasAnonymous ? "" : userEmail,
      authToken: wasAnonymous ? "" : authToken,
      remoteVaultId: wasAnonymous ? "" : (_l = (_k = account["remoteVaultId"]) != null ? _k : account["vaultId"]) != null ? _l : "",
      syncEnabled: wasAnonymous ? false : (_m = account["syncEnabled"]) != null ? _m : false,
      encryptionEnabled: wasAnonymous ? false : (_n = account["encryptionEnabled"]) != null ? _n : false,
      encryptionStatus: wasAnonymous ? "DISABLED" : (_o = account["encryptionStatus"]) != null ? _o : account["encryptionEnabled"] ? "ACTIVE" : "DISABLED",
      encryptionSecretKey: wasAnonymous ? "" : (_q = (_p = account["encryptionSecretKey"]) != null ? _p : account["encryptionPassphrase"]) != null ? _q : "",
      encryptionSalt: wasAnonymous ? "" : (_r = account["encryptionSalt"]) != null ? _r : "",
      encryptionDEK: wasAnonymous ? "" : (_s = account["encryptionDEK"]) != null ? _s : "",
      cachedVaultKeys
    };
    if ("accounts" in raw || "currentUserId" in raw || wasAnonymous) {
      await this.saveData(this.settings);
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** Set credentials after a successful sign-in, then start sync if enabled. */
  async signIn(creds) {
    var _a2;
    this.settings.userId = creds.userId;
    this.settings.userEmail = creds.userEmail;
    this.settings.authToken = creds.authToken;
    await this.saveSettings();
    this.api.setToken(creds.authToken);
    this.controlChannel.stop();
    if (this.settings.serverUrl && this.settings.syncEnabled) {
      this.connectControlChannel();
      this.startSync();
    }
    (_a2 = this.settingTab) == null ? void 0 : _a2.display();
  }
  /**
   * Clear all account credentials and any vault/E2EE state derived from them.
   *
   * By default the E2EE key material is stashed into `cachedVaultKeys` (keyed by
   * the signing-out account + vault) so the user is not re-prompted for the
   * secret key after signing back in and rejoining the same vault. The cached
   * DEK is always re-verified against the server token before reuse, so this is
   * safe — see {@link E2EENegotiator}. Pass `purgeCachedKeys: true` (the "remove
   * cached data" option, for a shared/untrusted device) to delete this account's
   * cache instead of retaining it.
   */
  async signOut(opts = {}) {
    this.stopSync();
    this.api.invalidateToken();
    this.api.setRemoteVaultId("");
    const { userId, remoteVaultId } = this.settings;
    if (userId) {
      if (opts.purgeCachedKeys) {
        for (const k of Object.keys(this.settings.cachedVaultKeys)) {
          if (k.startsWith(`${userId}:`))
            delete this.settings.cachedVaultKeys[k];
        }
      } else if (remoteVaultId && (this.settings.encryptionDEK || this.settings.encryptionSecretKey)) {
        this.settings.cachedVaultKeys[`${userId}:${remoteVaultId}`] = {
          secretKey: this.settings.encryptionSecretKey,
          salt: this.settings.encryptionSalt,
          dek: this.settings.encryptionDEK
        };
      }
    }
    this.settings.userId = "";
    this.settings.userEmail = "";
    this.settings.authToken = "";
    this.settings.remoteVaultId = "";
    this.settings.syncEnabled = false;
    this.settings.encryptionEnabled = false;
    this.settings.encryptionStatus = "DISABLED";
    this.settings.encryptionSecretKey = "";
    this.settings.encryptionSalt = "";
    this.settings.encryptionDEK = "";
    await this.saveSettings();
  }
};
/*! Bundled license information:

hash-wasm/dist/index.esm.js:
  (*!
   * hash-wasm (https://www.npmjs.com/package/hash-wasm)
   * (c) Dani Biro
   * @license MIT
   *)
*/
