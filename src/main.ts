import { Notice, Plugin, TAbstractFile } from "obsidian";

import { SyncAgainSettings, DEFAULT_SETTINGS, SyncAgainSettingTab } from "./settings";
import { FileTracker } from "./file-tracker";
import { SyncManager, SyncStatus } from "./sync-manager";
import { ApiClient } from "./api-client";
import { EventListener } from "./event-listener";

export default class SyncAgainPlugin extends Plugin {
  settings: SyncAgainSettings;

  // Exposed so SyncAgainSettingTab can call loginWithCredentials directly.
  api: ApiClient;

  private tracker: FileTracker;
  syncManager: SyncManager;
  private eventListener: EventListener;
  private syncIntervalId: number | null = null;
  private settingTab: SyncAgainSettingTab;
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Ensure a stable client ID exists.
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
      () => this.handleAuthFailure(),
    );
    this.syncManager = new SyncManager(this.app.vault, this.api, this.tracker);
    this.syncManager.onStatus = (status) => this.updateStatusBar(status);
    this.syncManager.deletionStrategy = this.settings.deletionStrategy;
    this.eventListener = new EventListener(this.api, this.settings.clientId, (event) => {
      if (event.key) {
        if (event.event === "file_changed") {
          void this.syncManager.syncKey(event.key);
        } else if (event.event === "file_deleted") {
          // Let the next full sync cycle handle the deletion.
        }
      }
    });

    // Handle the obsidian://syncagain-auth callback from the browser registration page.
    this.registerObsidianProtocolHandler("syncagain-auth", async (params) => {
      const token = params["token"];
      const userId = params["user_id"];
      const email = params["email"] ?? "";

      if (!token || !userId) {
        new Notice("Auth callback is missing token or user ID.");
        return;
      }

      this.settings.authToken = token;
      this.settings.userId = userId;
      this.settings.userEmail = email;
      await this.saveSettings();

      this.api.setToken(token);
      new Notice(`Signed in as ${email || userId}`);

      if (this.settings.syncEnabled && this.settings.serverUrl) {
        this.restartSync();
      }

      this.settingTab.display();
    });

    // Register vault events inside onLayoutReady to skip spurious startup events.
    this.app.workspace.onLayoutReady(async () => {
      this.registerEvent(
        this.app.vault.on("create", (file: TAbstractFile) => this.tracker.markDirty(file)),
      );
      this.registerEvent(
        this.app.vault.on("modify", (file: TAbstractFile) => this.tracker.markDirty(file)),
      );
      this.registerEvent(
        this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
          this.tracker.handleRename(file, oldPath),
        ),
      );
      this.registerEvent(
        this.app.vault.on("delete", (file: TAbstractFile) => this.tracker.handleDelete(file)),
      );

      await this.syncManager.loadState();

      if (this.settings.syncEnabled && this.settings.serverUrl && this.settings.authToken) {
        this.startSync();
      }
    });

    this.settingTab = new SyncAgainSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  onunload(): void {
    this.stopSync();
  }

  // ── Sync lifecycle ────────────────────────────────────────────────────────

  startSync(): void {
    if (!this.settings.authToken) return;
    this.stopSync();
    const intervalMs = this.settings.syncIntervalMinutes * 60 * 1000;
    void this.syncManager.sync();
    this.syncIntervalId = window.setInterval(() => { void this.syncManager.sync(); }, intervalMs);
    this.eventListener.start();
  }

  stopSync(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    this.eventListener.stop();
    this.updateStatusBar("off");
  }

  restartSync(): void {
    if (this.settings.syncEnabled && this.settings.authToken) {
      this.startSync();
    }
  }

  /** Called when the user signs out from the settings tab. */
  signOut(): void {
    this.api.invalidateToken();
    this.stopSync();
  }

  // ── Auth failure ──────────────────────────────────────────────────────────

  private handleAuthFailure(): void {
    this.settings.authToken = "";
    this.settings.userId = "";
    void this.saveSettings();
    this.stopSync();
    new Notice(
      "Session expired or not signed in. Please sign in again in the plugin settings.",
      8000,
    );
  }

  // ── Status bar ────────────────────────────────────────────────────────────

  private updateStatusBar(status: SyncStatus | "off"): void {
    if (!this.statusBarEl) return;
    const pending = this.tracker?.pendingCount ?? 0;
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
        this.statusBarEl.title = "Last sync failed — will retry";
        break;
      case "off":
        this.statusBarEl.setText("Sync off");
        this.statusBarEl.title = "Sync is disabled or not signed in";
        break;
    }
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<SyncAgainSettings>,
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
