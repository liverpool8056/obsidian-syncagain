import { App, Modal, Notice, PluginSettingTab, Setting, ToggleComponent } from "obsidian";
import type SyncAgainPlugin from "./main";
import type { ConnectionStatus } from "./control-channel";
import type { VaultSettings } from "./api-client";

/** E2EE key material cached for one (account, vault) pair. */
export interface CachedVaultKey {
  /** 16-char Secret Key (root secret). */
  secretKey: string;
  /** Hex-encoded Argon2id salt. */
  salt: string;
  /** Hex-encoded DEK bytes. */
  dek: string;
}

/**
 * Plugin settings persisted to data.json.
 *
 * One active account per install. Sign-out clears the account fields; sign-in
 * overwrites them. There is no cached pool of identities.
 */
export interface SyncAgainSettings {
  // ── Device-level ────────────────────────────────────────────────────────
  /** Stable client identifier (UUID generated once on first load). */
  clientId: string;
  /** Base URL of the obsidian-sync-server, e.g. "http://localhost:8080". */
  serverUrl: string;
  /** How often to run a full sync cycle, in minutes. */
  syncIntervalMinutes: number;

  // ── Active account ──────────────────────────────────────────────────────
  /** User account ID received after registration/login. Empty when signed out. */
  userId: string;
  /** Email address shown in the settings UI. Empty when signed out. */
  userEmail: string;
  /** JWT stored after a successful sign-in (30-day expiry). Empty when signed out. */
  authToken: string;
  /**
   * Namespace for this vault's files on the server.
   * All keys are stored as `{remoteVaultId}/{vault-relative-path}`.
   */
  remoteVaultId: string;
  /** Whether periodic sync is active. */
  syncEnabled: boolean;

  // ── E2EE state ──────────────────────────────────────────────────────────
  /** Whether E2EE is active. Files are encrypted with AES-256-GCM before upload. */
  encryptionEnabled: boolean;
  /** Server-side E2EE status (DISABLED, MIGRATING, ACTIVE, MIGRATING_TO_OFF). */
  encryptionStatus: "DISABLED" | "MIGRATING" | "ACTIVE" | "MIGRATING_TO_OFF";
  /** Secret Key (16-char alphanumeric) used as the root secret. */
  encryptionSecretKey: string;
  /** Random 32-byte salt used for Argon2id KEK derivation. */
  encryptionSalt: string;
  /** Random 256-bit Data Encryption Key (DEK), stored locally for auto-unlock. */
  encryptionDEK: string;

  // ── Cross-sign-out E2EE key cache ───────────────────────────────────────
  /**
   * Per-(account, vault) E2EE key material retained across sign-out, keyed by
   * `${userId}:${vaultId}`. Device-level: it spans accounts and is NOT cleared
   * by an ordinary sign-out, so a user who signs back in and rejoins the same
   * encrypted vault is not re-prompted for the secret key. The cached DEK is
   * always re-verified against the server's `key_verification_token` before
   * reuse, so a key rotated elsewhere safely falls back to the unlock prompt.
   * Cleared for the signing-out account when the "remove cached data" option is
   * checked (e.g. on a shared device).
   */
  cachedVaultKeys: Record<string, CachedVaultKey>;
}

export const DEFAULT_SETTINGS: SyncAgainSettings = {
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
  cachedVaultKeys: {},
};

export class SyncAgainSettingTab extends PluginSettingTab {
  private emailInput = "";
  private passwordInput = "";
  private signingIn = false;
  private showSignInForm = false;
  private connectionStatusEl: HTMLElement | null = null;
  private syncToggle: ToggleComponent | null = null;
  /** Pending timer to reconnect after the server URL field stops changing. */
  private serverUrlDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Debounces PUT /api/vaults/{vault_id}/settings so rapid keystrokes on the
   * sync-interval input don't spam the API. Toggle changes share the same
   * timer so they're flushed alongside any pending interval edit.
   */
  private syncedSettingsPushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cached remote vault list for the vault picker; null = not yet fetched. */
  private vaultList: { vault_id: string; name: string }[] | null = null;
  private loadingVaults = false;

  constructor(app: App, private plugin: SyncAgainPlugin) {
    super(app, plugin);
  }

  display(): void {
    console.debug(
      `[SyncAgain] settings tab display() — encryptionStatus=${this.plugin.settings.encryptionStatus}` +
      ` serverE2eeStatus=${this.plugin.serverConfig?.vault?.e2ee?.status ?? "<no-config>"}` +
      ` serverInitiator=${this.plugin.serverConfig?.vault?.e2ee?.initiator_id ?? "<none>"}` +
      ` localClientId=${this.plugin.settings.clientId}`,
    );
    const { containerEl } = this;
    containerEl.empty();

    // ── Server ──────────────────────────────────────────────────────────────

    const serverUrlSetting = new Setting(containerEl)
      .setName("Server")
      .setDesc('Base URL of the sync server, e.g. "http://localhost:8080"')
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            const newUrl = value.trim();
            this.plugin.settings.serverUrl = newUrl;
            await this.plugin.saveSettings();
            this.plugin.api.setServerUrl(newUrl);

            // Stop any active connection immediately so we don't keep a socket
            // open against an outdated URL while the user is still typing.
            this.plugin.stopSync();

            // Reconnect only once the user stops editing (debounce 1 s).
            if (this.serverUrlDebounceTimer !== null) {
              clearTimeout(this.serverUrlDebounceTimer);
            }
            this.serverUrlDebounceTimer = setTimeout(() => {
              this.serverUrlDebounceTimer = null;
              this.plugin.restartSync();
            }, 1_000);
          }),
      );
    this.connectionStatusEl = serverUrlSetting.nameEl.createEl("span", {
      cls: "syncagain-badge",
    });
    this.renderConnectionStatus(this.plugin.connectionStatus);

    // ── Account ─────────────────────────────────────────────────────────────

    new Setting(containerEl).setName("Account").setHeading();

    const isSignedIn = Boolean(
      this.plugin.settings.authToken && this.plugin.settings.userId,
    );

    if (isSignedIn) {
      // ── Signed-in state ────────────────────────────────────────────────────
      new Setting(containerEl)
        .setName("Signed in")
        .setDesc(this.plugin.settings.userEmail || this.plugin.settings.userId)
        .addButton((btn) =>
          btn.setButtonText("Account detail").onClick(() => {
            const base = this.plugin.settings.serverUrl.replace(/\/+$/, "");
            window.open(`${base}/account`);
          }),
        )
        .addButton((btn) =>
          btn
            .setButtonText("Sign out")
            .setWarning()
            .onClick(() => this.confirmSignOut()),
        );
    } else {
      // ── Signed-out state ───────────────────────────────────────────────────

      // Sign-up + Sign-in buttons side by side
      new Setting(containerEl)
        .setName("Account")
        .setDesc("Create a new account or sign in to an existing one.")
        .addButton((btn) =>
          btn.setButtonText("Sign up").onClick(() => {
            const base = this.plugin.settings.serverUrl.replace(/\/+$/, "");
            if (!base) {
              new Notice("Set the server URL first.");
              return;
            }
            const url = `${base}/register?client_id=${this.plugin.settings.clientId}`;
            window.open(url);
          }),
        )
        .addButton((btn) =>
          btn.setButtonText("Sign in").setCta().onClick(() => {
            this.showSignInForm = !this.showSignInForm;
            this.display();
          }),
        );

      // Inline sign-in form (shown only after clicking Sign in)
      if (this.showSignInForm) {
        new Setting(containerEl)
          .setName("Email")
          .addText((text) => {
            text
              .setPlaceholder("")
              .setValue(this.emailInput)
              .onChange((v) => { this.emailInput = v.trim(); });
          });

        new Setting(containerEl)
          .setName("Password")
          .addText((text) => {
            text.inputEl.type = "password";
            text
              .setPlaceholder("••••••••")
              .setValue(this.passwordInput)
              .onChange((v) => { this.passwordInput = v; });
          });

        new Setting(containerEl)
          .addButton((btn) => {
            btn
              .setButtonText(this.signingIn ? "Signing in…" : "Confirm")
              .setCta()
              .setDisabled(this.signingIn)
              .onClick(async () => {
                if (!this.plugin.settings.serverUrl) {
                  new Notice("Set the server URL first.");
                  return;
                }
                if (!this.emailInput) {
                  new Notice("Please enter your email.");
                  return;
                }
                if (!this.passwordInput) {
                  new Notice("Please enter your password.");
                  return;
                }

                this.signingIn = true;
                btn.setButtonText("Signing in…").setDisabled(true);

                try {
                  const result = await this.plugin.api.loginWithCredentials(
                    this.emailInput,
                    this.passwordInput,
                  );
                  await this.plugin.signIn({
                    userId: result.userId,
                    userEmail: result.userEmail,
                    authToken: result.token,
                  });

                  new Notice(`Signed in as ${result.userEmail}`);
                  this.passwordInput = "";
                  this.signingIn = false;
                  this.showSignInForm = false;
                  this.display();
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  new Notice(`Sign-in failed: ${msg}`);
                  this.signingIn = false;
                  btn.setButtonText("Confirm").setDisabled(false);
                }
              });
          });

        // Forgot-password link — opens the server's browser flow (CAPTCHA +
        // email OTP + new password). No plugin-side API calls are involved;
        // the user returns here to sign in once the reset completes.
        new Setting(containerEl)
          .setDesc("Forgot your password?")
          .addButton((btn) =>
            btn.setButtonText("Reset password").onClick(() => {
              const base = this.plugin.settings.serverUrl.replace(/\/+$/, "");
              if (!base) {
                new Notice("Set the server URL first.");
                return;
              }
              window.open(`${base}/forgot-password`);
            }),
          );
      }
    }

    // ── Sync + Deletion ─────────────────────────────────────────────────────

    new Setting(containerEl).setName("Sync").setHeading();

    new Setting(containerEl)
      .setName("Enable sync")
      .setDesc("Turn periodic file sync on or off on this device.")
      .addToggle((toggle) => {
        this.syncToggle = toggle;
        toggle.setValue(this.plugin.settings.syncEnabled).onChange(async (value) => {
          this.plugin.settings.syncEnabled = value;
          await this.plugin.saveSettings();
          if (value) {
            this.plugin.startSync();
          } else {
            // Run a final sync cycle to flush locally-present but server-absent
            // files before stopping, then stop once it completes.
            void this.plugin.syncManager.sync().finally(() => this.plugin.stopSync());
          }
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc("How often to run a full sync cycle. Synced across all your devices.")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.syncIntervalMinutes = parsed;
              await this.plugin.saveSettings();
              this.queueSyncedSettingsPush({ sync_interval_minutes: parsed });
              this.plugin.restartSync();
            }
          }),
      );

    // ── Vault linking (only when signed in and sync is enabled) ────────────

    if (isSignedIn && this.plugin.settings.syncEnabled) {
      new Setting(containerEl).setName("Vault").setHeading();

      if (this.plugin.settings.remoteVaultId) {
        // Already linked — show status only.
        new Setting(containerEl)
          .setName("Remote vault")
          .setDesc(`Linked — vault ID: ${this.plugin.settings.remoteVaultId}`);
      } else {
        // Not yet linked — fetch vault list to determine state.
        if (this.loadingVaults) {
          containerEl.createEl("p", { text: "Loading remote vaults…", cls: "setting-item-description" });
        } else if (this.vaultList === null) {
          // Kick off the fetch; re-render when done.
          this.loadingVaults = true;
          this.plugin.api.listVaults()
            .then((vaults) => {
              this.vaultList = vaults;
              this.loadingVaults = false;
              this.display();
            })
            .catch(() => {
              this.vaultList = [];
              this.loadingVaults = false;
              this.display();
            });
          containerEl.createEl("p", { text: "Loading remote vaults…", cls: "setting-item-description" });
        } else if (this.vaultList.length === 0) {
          // First device — vault is created automatically on sync start.
          new Setting(containerEl)
            .setName("Remote vault")
            .setDesc("A new remote vault will be created automatically.");
        } else {
          // Existing remote vaults — show picker + option to create new.
          new Setting(containerEl)
            .setName("Remote vault")
            .setDesc("Connect this device to an existing vault.");

          for (const v of this.vaultList) {
            new Setting(containerEl)
              .setName(v.name)
              .setDesc(`ID: ${v.vault_id}`)
              .addButton((btn) =>
                btn.setButtonText("Connect").onClick(async () => {
                  btn.setButtonText("Connecting…").setDisabled(true);
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
                    new Notice(`Failed to connect: ${msg}`);
                    btn.setButtonText("Connect").setDisabled(false);
                  }
                }),
              );
          }

          new Setting(containerEl)
            .setName("Or create a new vault")
            .setDesc("Start fresh with a new remote vault for this device.")
            .addButton((btn) =>
              btn.setButtonText("Create vault").onClick(async () => {
                btn.setButtonText("Creating…").setDisabled(true);
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
                  new Notice(`Failed to create vault: ${msg}`);
                  btn.setButtonText("Create vault").setDisabled(false);
                }
              }),
            );
        }
      }
    }

    // ── End-to-end encryption (only shown when signed in) ──────────────────

    if (isSignedIn) {
      new Setting(containerEl).setName("End-to-end encryption").setHeading();

      new Setting(containerEl)
        .setName("Encryption status")
        .setDesc(
          "E2EE status is synchronized with the server. " +
          "Files are encrypted with AES-256-GCM before uploading when ACTIVE.",
        )
        .addText((text) => {
          text
            .setValue(this.plugin.settings.encryptionStatus)
            .setDisabled(true);
          text.inputEl.addClass("syncagain-encryption-status-input");
        });

      if (this.plugin.settings.encryptionStatus === "DISABLED") {
        const e2eeEntitled = this.plugin.accountFeatures.includes("e2ee");
        if (e2eeEntitled) {
          new Setting(containerEl)
            .setName("Enable encryption")
            .setDesc(
              "Generates a secret key and starts re-uploading every file in encrypted form. " +
              "You will need the secret key to unlock the vault on other devices — losing it means " +
              "losing access to your data. Save it in a password manager before continuing.",
            )
            .addButton((btn) =>
              btn.setButtonText("Start migration").setCta().onClick(async () => {
                await this.plugin.startE2EEMigration();
                // After a successful start we have a fresh Secret Key in settings.
                // Show it in a modal so the user can copy and save it.
                if (this.plugin.settings.encryptionSecretKey) {
                  new SecretKeyModal(this.app, this.plugin.settings.encryptionSecretKey).open();
                }
                this.display();
              }),
            );
        } else {
          new Setting(containerEl)
            .setName("Enable encryption")
            .setDesc(
              "End-to-end encryption is not available on your current plan. " +
              "Contact the server admin to enable the e2ee feature on your account.",
            );
        }
      }

      // Initiator detection: only the device whose clientId matches the
      // server-pinned `initiator_id` is allowed to drive the state machine
      // (finalize migration, finalize rollback, start rollback). Other devices
      // are observers — they should see the current state but not the controls.
      const serverE2ee = this.plugin.serverConfig?.vault?.e2ee ?? null;
      const isInitiator =
        !!serverE2ee?.initiator_id &&
        serverE2ee.initiator_id === this.plugin.settings.clientId;

      if (this.plugin.settings.encryptionStatus === "MIGRATING") {
        if (isInitiator) {
          new Setting(containerEl)
            .setName("Migration in progress")
            .setDesc(
              "Files are being re-uploaded encrypted. Wait until the sync queue is empty " +
              "(no pending uploads), then click 'Finalize migration' to switch the vault " +
              "into the ACTIVE state. Other devices stay locked until you finalize.",
            )
            .addButton((btn) =>
              btn.setButtonText("Show secret key").onClick(() => {
                if (this.plugin.settings.encryptionSecretKey) {
                  new SecretKeyModal(this.app, this.plugin.settings.encryptionSecretKey).open();
                } else {
                  new Notice("No secret key stored locally on this device.");
                }
              }),
            )
            .addButton((btn) =>
              btn.setButtonText("Finalize migration").setCta().onClick(async () => {
                await this.plugin.finalizeE2EEMigration();
                this.display();
              }),
            );
        } else {
          new Setting(containerEl)
            .setName("Migration in progress (another device)")
            .setDesc(
              "Another device is migrating this vault to E2EE. Uploads from this device " +
              "are blocked until the initiator finalizes. If you have the secret key, " +
              "you can unlock the vault on this device to read the encrypted files.",
            );
        }
      }

      if (this.plugin.settings.encryptionStatus === "ACTIVE") {
        new Setting(containerEl)
          .setName("Disable encryption")
          .setDesc(
            "Start a rollback to plaintext. Once started, every device will need to wait " +
            "for the initiator to finalize before sync resumes.",
          )
          .addButton((btn) =>
            btn.setButtonText("Start rollback").setWarning().onClick(async () => {
              await this.plugin.startE2EERollback();
              this.display();
            }),
          );
      }

      if (this.plugin.settings.encryptionStatus === "MIGRATING_TO_OFF") {
        if (isInitiator) {
          new Setting(containerEl)
            .setName("Rollback in progress")
            .setDesc("Files are being re-uploaded in plaintext. Once finished, click finalize.")
            .addButton((btn) =>
              btn.setButtonText("Finalize rollback").setWarning().onClick(async () => {
                await this.plugin.finalizeE2EERollback();
                this.display();
              }),
            );
        } else {
          new Setting(containerEl)
            .setName("Rollback in progress (another device)")
            .setDesc(
              "Another device is rolling this vault back to plaintext. Uploads from this " +
              "device are blocked until the initiator finalizes.",
            );
        }
      }

      if (this.plugin.settings.encryptionStatus !== "DISABLED") {
        let secretKeyInput: HTMLInputElement | null = null;
        const secretKeySetting = new Setting(containerEl)
          .setName("Secret key")
          .setDesc(
            "The 16-character key used to derive the encryption key. Required to unlock " +
            "this vault on a new device. Edit it here only if you are entering a key from " +
            "another device.",
          )
          .setClass("syncagain-secret-key-setting")
          .addText((text) => {
            text.inputEl.type = "password";
            text
              .setPlaceholder("xxxx-xxxx-xxxx-xxxx")
              .setValue(this.plugin.settings.encryptionSecretKey)
              .onChange(async (value) => {
                this.plugin.settings.encryptionSecretKey = value;
                await this.plugin.saveSettings();
              });
            secretKeyInput = text.inputEl;
          });

        // Show/hide toggle — built after the Setting is fully constructed so the
        // controlEl exists and we avoid the TDZ on `secretKeySetting`.
        const showBtn = secretKeySetting.controlEl.createEl("button", {
          text: "Show",
          cls: "syncagain-show-secret-btn",
        });
        showBtn.onClickEvent(() => {
          if (!secretKeyInput) return;
          if (secretKeyInput.type === "password") {
            secretKeyInput.type = "text";
            showBtn.setText("Hide");
          } else {
            secretKeyInput.type = "password";
            showBtn.setText("Show");
          }
        });

        // Copy-to-clipboard
        const copyBtn = secretKeySetting.controlEl.createEl("button", {
          text: "Copy",
          cls: "syncagain-show-secret-btn",
        });
        copyBtn.onClickEvent(async () => {
          const value = this.plugin.settings.encryptionSecretKey;
          if (!value) {
            new Notice("No secret key stored locally.");
            return;
          }
          await navigator.clipboard.writeText(value);
          new Notice("Secret key copied to clipboard.");
        });
      }
    }

  }

  // ── Connection status ──────────────────────────────────────────────────────

  /** Called by the plugin whenever the WebSocket connection state changes. */
  updateConnectionStatus(status: ConnectionStatus): void {
    this.plugin.connectionStatus = status;
    this.renderConnectionStatus(status);
  }

  private renderConnectionStatus(status: ConnectionStatus): void {
    if (!this.connectionStatusEl) return;
    const config: Record<ConnectionStatus, { label: string; color: string }> = {
      connected:    { label: "Connected",    color: "syncagain-badge-green"  },
      connecting:   { label: "Connecting…",  color: "syncagain-badge-yellow" },
      disconnected: { label: "Disconnected", color: "syncagain-badge-gray"   },
    };
    const { label, color } = config[status];
    this.connectionStatusEl.setText(label);
    this.connectionStatusEl.setAttribute("class", `syncagain-badge ${color}`);
  }

  /**
   * Buffer of pending field changes flushed to the server after 1 s of
   * inactivity. Successive calls before the timer fires merge into the same
   * payload so a toggle change and a number-input edit go out as one PUT.
   */
  private pendingSyncedSettings: Partial<VaultSettings> = {};

  private queueSyncedSettingsPush(patch: Partial<VaultSettings>): void {
    if (!this.plugin.settings.remoteVaultId) return;
    Object.assign(this.pendingSyncedSettings, patch);

    if (this.syncedSettingsPushTimer !== null) {
      clearTimeout(this.syncedSettingsPushTimer);
    }
    this.syncedSettingsPushTimer = setTimeout(() => {
      this.syncedSettingsPushTimer = null;
      const payload = this.pendingSyncedSettings;
      this.pendingSyncedSettings = {};
      void this.plugin.api
        .updateVaultSettings(this.plugin.settings.remoteVaultId, payload)
        .catch((err) => {
          console.warn("[SyncAgain] Failed to push vault settings:", err);
        });
    }, 1_000);
  }

  /**
   * Sign out, first prompting (when there is cached E2EE key material) whether
   * to also purge this account's saved secret key from the device. With no key
   * material to retain, signs out directly without the prompt.
   */
  private confirmSignOut(): void {
    const finish = async (purgeCachedKeys: boolean) => {
      this.vaultList = null;
      this.loadingVaults = false;
      await this.plugin.signOut({ purgeCachedKeys });
      this.display();
    };

    const hasKeyMaterial =
      Boolean(this.plugin.settings.encryptionDEK || this.plugin.settings.encryptionSecretKey) ||
      Object.keys(this.plugin.settings.cachedVaultKeys).some((k) =>
        k.startsWith(`${this.plugin.settings.userId}:`),
      );

    if (!hasKeyMaterial) {
      void finish(false);
      return;
    }

    new SignOutModal(this.app, (purgeCachedKeys) => void finish(purgeCachedKeys)).open();
  }
}

/**
 * Sign-out confirmation modal. Offers to also delete this device's cached secret
 * key for the account. Left unchecked (the default), the key is retained so the
 * user isn't re-prompted when they sign back in and rejoin the same vault; the
 * cached DEK is always re-verified against the server token before reuse, so
 * retaining it is safe.
 */
class SignOutModal extends Modal {
  private purge = false;

  constructor(app: App, private readonly onConfirm: (purgeCachedKeys: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.setTitle("Remove cached data");

    new Setting(contentEl)
      .setName("Confirm if you want to remove cached account data")
      .setDesc(
        "Delete cached secret key on this device for this account. You can leave " +
          "off without checking to avoid re-entering it when you sign back in and " +
          "rejoin the same vault.",
      )
      .addToggle((t) => t.setValue(this.purge).onChange((v) => (this.purge = v)));

    const buttonRow = contentEl.createDiv({ cls: "syncagain-secret-key-buttons" });
    buttonRow.createEl("button", { text: "Cancel" }).onClickEvent(() => this.close());
    const signOutBtn = buttonRow.createEl("button", { text: "Sign out", cls: "mod-warning" });
    signOutBtn.onClickEvent(() => {
      this.close();
      this.onConfirm(this.purge);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Modal shown right after a fresh Secret Key is generated, so the user gets a
 * single clear chance to copy it down before it disappears behind a password
 * field. The DEK is also stored locally for auto-unlock, but the Secret Key is
 * the *only* recovery path on a new device — so emphasising it here matters.
 */
class SecretKeyModal extends Modal {
  private readonly secretKey: string;

  constructor(app: App, secretKey: string) {
    super(app);
    this.secretKey = secretKey;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.setTitle("Save your secret key");

    const warning = contentEl.createEl("p");
    warning.setText(
      "This key is the only way to unlock your vault on another device. " +
      "If you lose it, your encrypted files cannot be recovered — not even by us. " +
      "Store it in a password manager now.",
    );

    const keyEl = contentEl.createEl("pre", { cls: "syncagain-secret-key-display" });
    keyEl.setText(this.secretKey);

    const buttonRow = contentEl.createDiv({ cls: "syncagain-secret-key-buttons" });

    const copyBtn = buttonRow.createEl("button", { text: "Copy to clipboard", cls: "mod-cta" });
    copyBtn.onClickEvent(async () => {
      await navigator.clipboard.writeText(this.secretKey);
      new Notice("Secret key copied to clipboard.");
    });

    const closeBtn = buttonRow.createEl("button", { text: "I have saved it" });
    closeBtn.onClickEvent(() => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
