import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type SyncAgainPlugin from "./main";
import type { ConnectionStatus } from "./event-listener";

export interface SyncAgainSettings {
  /** Base URL of the obsidian-sync-server, e.g. "http://localhost:8080" */
  serverUrl: string;
  /** Stable client identifier (UUID generated once on first load) */
  clientId: string;
  /** How often to run a full sync cycle, in minutes */
  syncIntervalMinutes: number;
  /** Whether periodic sync is active */
  syncEnabled: boolean;
  /**
   * Namespace for this vault's files on the server.
   * All keys are stored as `{vaultId}/{vault-relative-path}`.
   * Empty string = no prefix (legacy single-vault behaviour).
   * Set a unique value per vault when syncing multiple vaults to the same account.
   */
  vaultId: string;

  // ── Account (replaces the old shared password) ──────────────────────────
  /** User account ID received after registration/login */
  userId: string;
  /** Email address shown in the settings UI */
  userEmail: string;
  /** JWT stored after a successful sign-in (30-day expiry) */
  authToken: string;
}

export const DEFAULT_SETTINGS: SyncAgainSettings = {
  serverUrl: "",
  clientId: "",
  syncIntervalMinutes: 5,
  syncEnabled: true,
  vaultId: "",
  userId: "",
  userEmail: "",
  authToken: "",
};

export class SyncAgainSettingTab extends PluginSettingTab {
  private emailInput = "";
  private passwordInput = "";
  private signingIn = false;
  private showSignInForm = false;
  private connectionStatusEl: HTMLElement | null = null;

  constructor(app: App, private plugin: SyncAgainPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Server ──────────────────────────────────────────────────────────────

    new Setting(containerEl).setName("Server").setHeading();

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc('Base URL of the sync server, e.g. "http://localhost:8080"')
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            await this.plugin.saveSettings();
            this.plugin.restartSync();
          }),
      );

    const connSetting = new Setting(containerEl)
      .setName("Connection");
    this.connectionStatusEl = connSetting.controlEl.createEl("span", {
      cls: "syncagain-conn-status",
    });
    this.renderConnectionStatus(this.plugin.sseStatus);

    // ── Account ─────────────────────────────────────────────────────────────

    new Setting(containerEl).setName("Account").setHeading();

    const isSignedIn = Boolean(this.plugin.settings.authToken && this.plugin.settings.userId);

    if (isSignedIn) {
      // ── Signed-in state ────────────────────────────────────────────────────
      new Setting(containerEl)
        .setName("Signed in")
        .setDesc(this.plugin.settings.userEmail || this.plugin.settings.userId)
        .addButton((btn) =>
          btn
            .setButtonText("Sign out")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.authToken = "";
              this.plugin.settings.userId = "";
              this.plugin.settings.userEmail = "";
              await this.plugin.saveSettings();
              this.plugin.signOut();
              this.display();
            }),
        );

      new Setting(containerEl)
        .setName("User ID")
        .setDesc("Your account ID on the server (read-only).")
        .addText((text) =>
          text.setValue(this.plugin.settings.userId).setDisabled(true),
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
                  this.plugin.settings.authToken = result.token;
                  this.plugin.settings.userId = result.userId;
                  this.plugin.settings.userEmail = result.userEmail;
                  await this.plugin.saveSettings();

                  new Notice(`Signed in as ${result.userEmail}`);
                  this.passwordInput = "";
                  this.signingIn = false;
                  this.showSignInForm = false;

                  if (this.plugin.settings.syncEnabled) {
                    this.plugin.restartSync();
                  }
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

    if (!isSignedIn) return;

    new Setting(containerEl).setName("Sync").setHeading();

    new Setting(containerEl)
      .setName("Enable sync")
      .setDesc("Turn periodic file sync on or off.")
      .addToggle((toggle) =>
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
        }),
      );

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

    new Setting(containerEl)
      .setName("Vault ID")
      .setDesc(
        "Namespace for this vault's files on the server. " +
        "Set a unique value per vault when syncing multiple vaults to the same account. " +
        "Leave blank to use no prefix (legacy single-vault behaviour).",
      )
      .addText((text) =>
        text
          .setPlaceholder("(no prefix)")
          .setValue(this.plugin.settings.vaultId)
          .onChange(async (value) => {
            this.plugin.settings.vaultId = value.trim();
            await this.plugin.saveSettings();
            this.plugin.api.setVaultId(value.trim());
            this.plugin.restartSync();
          }),
      );

    // ── Info ────────────────────────────────────────────────────────────────

    new Setting(containerEl).setName("Info").setHeading();

    new Setting(containerEl)
      .setName("Device ID")
      .setDesc("Unique identifier for this Obsidian instance (auto-generated, read-only).")
      .addText((text) =>
        text.setValue(this.plugin.settings.clientId).setDisabled(true),
      );
  }

  // ── Connection status ──────────────────────────────────────────────────────

  /** Called by the plugin whenever the SSE connection state changes. */
  updateConnectionStatus(status: ConnectionStatus): void {
    this.plugin.sseStatus = status;
    this.renderConnectionStatus(status);
  }

  private renderConnectionStatus(status: ConnectionStatus): void {
    if (!this.connectionStatusEl) return;
    const labels: Record<ConnectionStatus, string> = {
      connected: "Connected",
      connecting: "Connecting…",
      disconnected: "Disconnected",
    };
    this.connectionStatusEl.setText(labels[status]);
    this.connectionStatusEl.setAttribute(
      "class",
      `syncagain-conn-status syncagain-conn-status--${status}`,
    );
  }

}
