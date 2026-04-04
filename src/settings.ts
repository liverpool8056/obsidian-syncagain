import { App, Notice, PluginSettingTab, Setting, ToggleComponent } from "obsidian";
import type SyncAgainPlugin from "./main";
import type { ConnectionStatus } from "./control-channel";

// ── Per-account config ────────────────────────────────────────────────────────

/** Settings that belong to a single signed-in account. */
export interface AccountConfig {
  /** User account ID received after registration/login. For anonymous accounts, equals clientId. */
  userId: string;
  /** Email address shown in the settings UI. */
  userEmail: string;
  /** JWT stored after a successful sign-in (30-day expiry). */
  authToken: string;
  /**
   * Namespace for this vault's files on the server.
   * All keys are stored as `{remoteVaultId}/{vault-relative-path}`.
   * Empty string = no prefix (legacy single-vault behaviour).
   */
  remoteVaultId: string;
  /** Whether periodic sync is active. */
  syncEnabled: boolean;
  /** Whether E2EE is active. Files are encrypted with AES-256-GCM before upload. */
  encryptionEnabled: boolean;
  /** Passphrase used to derive the AES key via PBKDF2. Never sent to the server. */
  encryptionPassphrase: string;
  /** Hex-encoded 32-byte PBKDF2 salt, generated once when E2EE is first enabled. */
  encryptionSalt: string;
  /**
   * Random UUID generated at first anonymous sign-up.
   * Used as the sole re-auth credential for anonymous accounts.
   * Empty for email accounts. Loss is unrecoverable.
   */
  deviceSecret: string;
}

/** Default account config used for anonymous or newly-added accounts. */
export const DEFAULT_ACCOUNT: AccountConfig = {
  userId: "",
  userEmail: "",
  authToken: "",
  remoteVaultId: "",
  syncEnabled: false,
  encryptionEnabled: false,
  encryptionPassphrase: "",
  encryptionSalt: "",
  deviceSecret: "",
};

// ── Device-level config ───────────────────────────────────────────────────────

/** Settings that are device-wide and shared across all accounts. */
export interface DeviceConfig {
  /** Stable client identifier (UUID generated once on first load). */
  clientId: string;
  /** Base URL of the obsidian-sync-server, e.g. "http://localhost:8080". */
  serverUrl: string;
  /** How often to run a full sync cycle, in minutes. */
  syncIntervalMinutes: number;
}

// ── Top-level data.json shape ─────────────────────────────────────────────────

/**
 * What is persisted to data.json.
 *
 * Inspired by kubectl kubeconfig: device-level fields are shared across all
 * accounts; `accounts` is a map keyed by userId; `currentUserId` says which
 * account is active.
 */
export interface PluginData extends DeviceConfig {
  /** The userId of the active account. Empty string = no active account (initial / signed-out state). */
  currentUserId: string;
  /** All known accounts, keyed by userId. The "" key is never written here. */
  accounts: Record<string, AccountConfig>;
}

// ── Flat runtime view (used by the rest of the codebase) ─────────────────────

/**
 * Flat merged view of DeviceConfig + active AccountConfig.
 * Populated by `loadSettings`, written back by `saveSettings`.
 * All code outside of main.ts/settings.ts works with this type.
 */
export type SyncAgainSettings = DeviceConfig & AccountConfig;

export const DEFAULT_SETTINGS: SyncAgainSettings = {
  clientId: "",
  serverUrl: "",
  syncIntervalMinutes: 5,
  ...DEFAULT_ACCOUNT,
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
  /** Cached remote vault list for the vault picker; null = not yet fetched. */
  private vaultList: { vault_id: string; name: string }[] | null = null;
  private loadingVaults = false;

  constructor(app: App, private plugin: SyncAgainPlugin) {
    super(app, plugin);
  }

  display(): void {
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

    // Anonymous accounts (userId === clientId, no email) are transparent to the UI:
    // they power sync silently while the account block stays in "not signed in" state,
    // so the user can still sign up / sign in to a real account.
    const isAnonymous =
      this.plugin.settings.userId === this.plugin.settings.clientId &&
      !this.plugin.settings.userEmail;
    const isSignedIn = Boolean(
      this.plugin.settings.authToken &&
      this.plugin.settings.userId &&
      !isAnonymous,
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
            .onClick(async () => {
              this.vaultList = null;
              this.loadingVaults = false;
              await this.plugin.signOutToAnonymousOrInitial();
            }),
        );

      // ── Account switcher ───────────────────────────────────────────────────
      const otherAccounts = Object.values(this.plugin.pluginData.accounts).filter(
        (a) => a.userId && a.userId !== this.plugin.settings.userId,
      );
      if (otherAccounts.length > 0) {
        const switchSetting = new Setting(containerEl)
          .setName("Switch account")
          .setDesc("Switch to another signed-in account.");
        for (const acct of otherAccounts) {
          switchSetting.addButton((btn) =>
            btn
              .setButtonText(acct.userEmail || acct.userId)
              .onClick(async () => {
                await this.plugin.switchAccount(acct.userId);
                this.vaultList = null;
                this.loadingVaults = false;
                this.display();
              }),
          );
        }
      }

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
                  await this.plugin.switchAccount(result.userId, {
                    authToken: result.token,
                    userEmail: result.userEmail,
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
      }
    }

    // ── Sync + Deletion ─────────────────────────────────────────────────────

    new Setting(containerEl).setName("Sync").setHeading();

    new Setting(containerEl)
      .setName("Enable sync")
      .setDesc("Turn periodic file sync on or off.")
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
      .setDesc("How often to run a full sync cycle.")
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed > 0) {
              this.plugin.settings.syncIntervalMinutes = parsed;
              await this.plugin.saveSettings();
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
          .setDesc(`Linked — VaultID: ${this.plugin.settings.remoteVaultId}`);
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
          "End-to-end encryption can be toggled from the account info page. " +
          "Files are encrypted with AES-256-GCM before uploading when enabled.",
        )
        .addText((text) => {
          text
            .setValue(this.plugin.settings.encryptionEnabled ? "Enabled" : "Disabled")
            .setDisabled(true);
          text.inputEl.style.width = "80px";
        });

      new Setting(containerEl)
        .setName("Passphrase")
        .setDesc(
          "Never sent to the server. " +
          "Changing it re-uploads all files with the new key.",
        )
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("••••••••")
            .setValue(this.plugin.settings.encryptionPassphrase)
            .onChange(async (value) => {
              this.plugin.settings.encryptionPassphrase = value;
              await this.plugin.saveSettings();
            });
          // Only reinit (expensive PBKDF2) when focus leaves the field.
          text.inputEl.addEventListener("blur", async () => {
            if (this.plugin.settings.encryptionEnabled && this.plugin.settings.encryptionPassphrase) {
              await this.plugin.reinitEncryption();
            }
          });
        });
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

}
