import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type SyncAgainPlugin from "./main";
import type { DeletionStrategy } from "./sync-manager";
import type { RemoteFileEntry } from "./metadata";

export interface SyncAgainSettings {
  /** Base URL of the obsidian-sync-server, e.g. "http://localhost:8080" */
  serverUrl: string;
  /** Stable client identifier (UUID generated once on first load) */
  clientId: string;
  /** How often to run a full sync cycle, in minutes */
  syncIntervalMinutes: number;
  /** Whether periodic sync is active */
  syncEnabled: boolean;

  // ── Account (replaces the old shared password) ──────────────────────────
  /** User account ID received after registration/login */
  userId: string;
  /** Email address shown in the settings UI */
  userEmail: string;
  /** JWT stored after a successful sign-in (30-day expiry) */
  authToken: string;
  /**
   * How local file deletions are handled on the server.
   * - "non-permanent": file is moved to `_delete/` and can be recovered via the Trash view.
   * - "permanent": file is deleted immediately and a tombstone is written (no recovery).
   */
  deletionStrategy: DeletionStrategy;
}

export const DEFAULT_SETTINGS: SyncAgainSettings = {
  serverUrl: "",
  clientId: "",
  syncIntervalMinutes: 5,
  syncEnabled: true,
  userId: "",
  userEmail: "",
  authToken: "",
  deletionStrategy: "non-permanent",
};

export class SyncAgainSettingTab extends PluginSettingTab {
  private emailInput = "";
  private passwordInput = "";
  private signingIn = false;
  private showSignInForm = false;

  constructor(app: App, private plugin: SyncAgainPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "SyncAgain" });

    // ── Server ──────────────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Server" });

    new Setting(containerEl)
      .setName("Server URL")
      .setDesc('Base URL of the sync server, e.g. "http://localhost:8080"')
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:8080")
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value.trim();
            await this.plugin.saveSettings();
            this.plugin.restartSync();
          }),
      );

    // ── Account ─────────────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Account" });

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
              new Notice("[SyncAgain] Set the Server URL first.");
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
              .setPlaceholder("you@example.com")
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
                  new Notice("[SyncAgain] Set the Server URL first.");
                  return;
                }
                if (!this.emailInput) {
                  new Notice("[SyncAgain] Please enter your email.");
                  return;
                }
                if (!this.passwordInput) {
                  new Notice("[SyncAgain] Please enter your password.");
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

                  new Notice(`[SyncAgain] Signed in as ${result.userEmail}`);
                  this.passwordInput = "";
                  this.signingIn = false;
                  this.showSignInForm = false;

                  if (this.plugin.settings.syncEnabled) {
                    this.plugin.restartSync();
                  }
                  this.display();
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  new Notice(`[SyncAgain] Sign in failed: ${msg}`);
                  this.signingIn = false;
                  btn.setButtonText("Confirm").setDisabled(false);
                }
              });
          });
      }
    }

    // ── Sync + Deletion ─────────────────────────────────────────────────────

    if (!isSignedIn) return;

    containerEl.createEl("h3", { text: "Sync" });

    new Setting(containerEl)
      .setName("Enable sync")
      .setDesc("Turn periodic file sync on or off.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncEnabled).onChange(async (value) => {
          this.plugin.settings.syncEnabled = value;
          await this.plugin.saveSettings();
          value ? this.plugin.startSync() : this.plugin.stopSync();
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

    // ── Deletion ────────────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Deletion" });

    new Setting(containerEl)
      .setName("Deletion strategy")
      .setDesc(
        "Non-permanent: deleted files are moved to a remote trash and can be recovered. " +
        "Permanent: files are immediately deleted with no recovery option.",
      )
      .addDropdown((drop) =>
        drop
          .addOption("non-permanent", "Non-permanent (recoverable)")
          .addOption("permanent", "Permanent (no recovery)")
          .setValue(this.plugin.settings.deletionStrategy)
          .onChange(async (value) => {
            this.plugin.settings.deletionStrategy = value as DeletionStrategy;
            await this.plugin.saveSettings();
            this.plugin.syncManager.deletionStrategy = value as DeletionStrategy;
            this.display(); // re-render to show/hide trash view
          }),
      );

    // ── Trash ────────────────────────────────────────────────────────────────

    if (this.plugin.settings.deletionStrategy === "non-permanent") {
      containerEl.createEl("h3", { text: "Trash" });

      const trashContainer = containerEl.createDiv({ cls: "syncagain-trash" });
      trashContainer.createEl("p", { text: "Loading…" });
      this.loadTrashView(trashContainer);
    }

    // ── Info ────────────────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Info" });

    new Setting(containerEl)
      .setName("Device ID")
      .setDesc("Unique identifier for this Obsidian instance (auto-generated, read-only).")
      .addText((text) =>
        text.setValue(this.plugin.settings.clientId).setDisabled(true),
      );
  }

  // ── Trash view ─────────────────────────────────────────────────────────────

  private async loadTrashView(container: HTMLElement): Promise<void> {
    container.empty();
    container.createEl("p", { text: "Loading…" });

    let files: RemoteFileEntry[];
    try {
      files = await this.plugin.api.listTrash();
    } catch (err) {
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
      const filename = entry.key.split("/").pop() ?? entry.key;
      const originalPath = entry.key;

      new Setting(container)
        .setName(filename)
        .setDesc(originalPath !== filename ? originalPath : "")
        .addButton((btn) =>
          btn
            .setButtonText("Recover")
            .setCta()
            .onClick(async () => {
              btn.setButtonText("Recovering…").setDisabled(true);
              try {
                await this.plugin.api.acquireLocks([originalPath]);
                try {
                  await this.plugin.api.recoverFromTrash(originalPath);
                  // Server has moved _delete/<key> back to <key>; download it locally.
                  await this.plugin.syncManager.recoverKey(originalPath);
                  new Notice(`[SyncAgain] Recovered: ${filename}`);
                } finally {
                  try { await this.plugin.api.releaseLocks([originalPath]); } catch { /* best-effort */ }
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                new Notice(`[SyncAgain] Recovery failed: ${msg}`);
              }
              this.loadTrashView(container);
            }),
        )
        .addButton((btn) =>
          btn
            .setButtonText("Delete")
            .setWarning()
            .onClick(() => {
              new ConfirmDeleteModal(this.app, filename, async () => {
                try {
                  await this.plugin.api.deleteFromTrash(originalPath);
                  new Notice(`[SyncAgain] Permanently deleted: ${filename}`);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  new Notice(`[SyncAgain] Delete failed: ${msg}`);
                }
                this.loadTrashView(container);
              }).open();
            }),
        );
    }
  }
}

// ── Confirm-delete modal ──────────────────────────────────────────────────────

class ConfirmDeleteModal extends Modal {
  constructor(
    app: App,
    private readonly filename: string,
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Permanently delete?" });
    contentEl.createEl("p", {
      text: `"${this.filename}" will be permanently deleted and cannot be recovered.`,
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .onClick(() => this.close()),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Delete permanently")
          .setWarning()
          .onClick(async () => {
            this.close();
            await this.onConfirm();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
