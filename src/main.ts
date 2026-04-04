import { Notice, Plugin, TAbstractFile } from "obsidian";

import { showConflictResolutionModal } from "./first-sync-modal";
import { showVaultPickerModal } from "./vault-picker-modal";

import {
  SyncAgainSettings,
  AccountConfig, DEFAULT_ACCOUNT,
  PluginData,
  SyncAgainSettingTab,
} from "./settings";
import { FileTracker } from "./file-tracker";
import { SyncManager, SyncStatus } from "./sync-manager";
import { ApiClient, ServerConfig } from "./api-client";
import { ControlChannel, ConnectionStatus } from "./control-channel";
import { VaultEncryption } from "./vault-encryption";
import { FeatureGate, FeatureNegotiationCoordinator } from "./feature-negotiation";
import { E2EENegotiator } from "./features/e2ee-negotiator";

export default class SyncAgainPlugin extends Plugin {
  settings: SyncAgainSettings;
  /** Raw plugin data stored in data.json — the multi-account backing store. */
  pluginData: PluginData;

  // Exposed so SyncAgainSettingTab can call loginWithCredentials directly.
  api: ApiClient;

  private tracker: FileTracker;
  syncManager: SyncManager;
  private controlChannel: ControlChannel;
  private coordinator: FeatureNegotiationCoordinator;
  connectionStatus: ConnectionStatus = "disconnected";
  /** Feature names granted to this account by the server (e.g. ["e2ee"]). */
  accountFeatures: string[] = [];
  /** Most recent server config received via WebSocket pong. */
  private serverConfig: ServerConfig | null = null;
  private syncIntervalId: number | null = null;
  private settingTab: SyncAgainSettingTab;
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Ensure a stable clientId exists. remoteVaultId is NOT auto-generated — it is
    // assigned by the server when the user links this device to a remote vault
    // via the settings UI (POST /api/vaults or PUT /api/vaults/{id}).
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
    this.api.setRemoteVaultId(this.settings.remoteVaultId);
    const enc = await this.buildEncryption();
    this.syncManager = new SyncManager(this.app.vault, this.app.fileManager, this.api, this.tracker, enc);
    this.syncManager.onStatus = (status) => this.updateStatusBar(status);
    this.syncManager.onFirstSyncConflict = (conflicts) =>
      showConflictResolutionModal(this.app, conflicts);
    this.syncManager.onFeatureNotEnabled = (feature) => this.handleFeatureNotEnabled(feature);

    // Feature negotiation coordinator — register negotiators here.
    this.coordinator = new FeatureNegotiationCoordinator();
    this.coordinator.register(new E2EENegotiator());

    this.controlChannel = new ControlChannel(
      this.api,
      this.settings.clientId,
      (event) => {
        if (!event.key) return;
        // resolveEventKey strips the vault prefix and returns null for keys
        // that belong to a different vault on the same account.
        const localKey = this.api.resolveEventKey(event.key);
        if (localKey === null) return;
        if (event.event === "file_changed") {
          void this.syncManager.syncKey(localKey);
        }
        // file_deleted: let the next full sync cycle handle the deletion.
      },
      (config) => { void this.onConfig(config); },
      (status) => this.onControlChannelStatus(status),
    );

    // Handle the obsidian://syncagain-auth callback from the browser registration page.
    this.registerObsidianProtocolHandler("syncagain-auth", async (params) => {
      const token = params["token"];
      const userId = params["user_id"];
      const email = params["email"] ?? "";

      if (!token || !userId) {
        new Notice("Auth callback is missing token or user ID.");
        return;
      }

      await this.switchAccount(userId, { authToken: token, userEmail: email });
      new Notice(`Signed in as ${email || userId}`);

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

  onunload(): void {
    this.stopSync();
  }

  // ── Sync lifecycle ────────────────────────────────────────────────────────

  /**
   * Connect the WebSocket control channel.
   * Only connects when sync is enabled — the channel is pointless when sync is off.
   */
  connectControlChannel(): void {
    if (!this.settings.serverUrl || !this.settings.syncEnabled) return;
    this.controlChannel.start();
  }

  /**
   * Start the sync loop (upload/download cycle + interval).
   * The control channel must already be connected (or connecting) before this
   * is called. If no vault is linked yet, defers to initVaultIfNeeded which
   * will call startSync() again once a vault is available.
   * If the user is not signed in, triggers anonymous registration first.
   */
  startSync(): void {
    if (!this.settings.authToken) {
      void this.doRegisterAnonymous();
      return;
    }
    this.connectControlChannel();
    if (!this.settings.remoteVaultId) {
      // No vault linked yet — auto-create if this is the first device,
      // otherwise the settings UI will prompt the user to pick one.
      void this.initVaultIfNeeded();
      return;
    }
    this.clearSyncInterval();
    // Keep the server's vault_id → folder name mapping current.
    void this.api.registerVault(this.app.vault.getName());
    this.startSyncLoop();
  }

  private async initVaultIfNeeded(): Promise<void> {
    try {
      const result = await this.api.vaultHandshake(this.app.vault.getName());
      if (result.created) {
        // Server auto-created the first vault for this account.
        this.settings.remoteVaultId = result.vault.vault_id;
        this.api.setRemoteVaultId(result.vault.vault_id);
        await this.saveSettings();
        this.startSync();
      } else {
        // Existing vaults — show picker; the modal calls startSync() after linking.
        showVaultPickerModal(this.app, result.vaults, this);
      }
    } catch (err) {
      console.warn("[SyncAgain] Vault handshake failed:", err);
      new Notice("Failed to connect to remote vault. Check server URL and try again.", 8000);
      this.settingTab?.display();
    }
  }

  /**
   * Register a new anonymous account, then start sync.
   * Called by startSync() when no authToken is present.
   * No-ops silently if serverUrl is not set.
   */
  private async doRegisterAnonymous(): Promise<void> {
    if (!this.settings.serverUrl) return;
    try {
      const deviceSecret = crypto.randomUUID();
      const result = await this.api.registerAnonymous(this.settings.clientId, deviceSecret);
      await this.switchAccount(result.userId, {
        authToken: result.token,
        deviceSecret,
        syncEnabled: true,
      });
      new Notice("Sync started. Create an account to sync across multiple devices.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Anonymous registration failed: ${msg}`);
    }
  }

  stopSync(): void {
    this.clearSyncInterval();
    this.controlChannel.stop();
    this.updateStatusBar("off");
  }

  restartSync(): void {
    this.connectControlChannel();
    if (this.settings.authToken && this.settings.syncEnabled) {
      this.startSync();
    }
  }

  /** Called when the user signs out from the settings tab. */
  signOut(): void {
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
  private async onConfig(config: ServerConfig): Promise<void> {
    this.serverConfig = config;
    this.accountFeatures = config.features ?? [];
    this.settingTab?.display();

    // Step 3: consistency validation.
    FeatureGate.validateConsistency(config.features, this.settings, this);

    // Step 4: feature-specific negotiation.
    const results = await this.coordinator.negotiateAll(
      config.features,
      config.vault,
      this.settings,
      this,
    );

    // Step 5: surface blocks and pause loop.
    const blocked = results.filter((r) => r.status === "blocked");
    if (blocked.length > 0) {
      this.clearSyncInterval();
      for (const b of blocked) {
        if (b.status === "blocked") {
          new Notice(b.reason, 10_000);
          b.userAction?.();
        }
      }
      return;
    }

    // Step 6: apply outcomes — negotiators already updated settings; rebuild encryption.
    const enc = await this.buildEncryption();
    this.syncManager.setEncryption(enc);

    // Step 6b: resume loop if it was paused (offline or blocked negotiation),
    // but only when the user has sync enabled and the vault handshake has bound
    // a remoteVaultId. Without it, ApiClient would throw on every keyed call —
    // and historically would silently upload to users/{user_id}/ with no vault folder.
    if (
      this.settings.syncEnabled
      && this.settings.remoteVaultId
      && this.syncIntervalId === null
    ) {
      this.startSyncLoop();
    }
  }

  private startSyncLoop(): void {
    this.clearSyncInterval();
    const intervalMs = this.settings.syncIntervalMinutes * 60 * 1000;
    void this.syncManager.sync();
    this.syncIntervalId = window.setInterval(() => { void this.syncManager.sync(); }, intervalMs);
  }

  private clearSyncInterval(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  // ── Auth failure ──────────────────────────────────────────────────────────

  private handleAuthFailure(): void {
    const { deviceSecret } = this.settings;
    if (deviceSecret) {
      void this.reAuthAnonymous();
      return;
    }
    void this.switchAccount("").then(() => {
      new Notice(
        "Session expired or not signed in. Please sign in again in the plugin settings.",
        8000,
      );
    });
  }

  /** Re-authenticate an anonymous account using the stored device secret. */
  private async reAuthAnonymous(): Promise<void> {
    try {
      const result = await this.api.loginAnonymous(
        this.settings.clientId,
        this.settings.deviceSecret,
      );
      this.settings.authToken = result.token;
      await this.saveSettings();
      this.api.setToken(result.token);
      this.restartSync();
    } catch {
      await this.switchAccount("");
      new Notice(
        "Anonymous session could not be renewed. The device secret may be lost.",
        8000,
      );
    }
  }

  // ── WebSocket control channel status ──────────────────────────────────────

  private onControlChannelStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    this.settingTab?.updateConnectionStatus(status);
    if (status === "disconnected") {
      // Pause sync loop when offline to avoid acting on stale entitlements.
      // The loop resumes in onConfig after a successful reconnect + negotiation.
      this.clearSyncInterval();
    }
  }

  // ── Feature disable (called by FeatureGate and mid-upload 402 handler) ────

  /**
   * Disable a feature locally. Updates settings only; the caller is responsible for
   * rebuilding encryption and restarting the sync loop if needed.
   */
  disableFeature(feature: string): void {
    if (feature === "e2ee" && this.settings.encryptionEnabled) {
      this.settings.encryptionEnabled = false;
      void this.saveSettings();
    }
  }

  /**
   * Invoked when the server returns 402 for a paid feature mid-upload.
   * Disables the feature, updates SyncManager immediately, and notifies the user.
   */
  private handleFeatureNotEnabled(feature: string): void {
    if (feature === "e2ee" && this.settings.encryptionEnabled) {
      this.disableFeature(feature);
      this.syncManager.setEncryption(null);
      new Notice(
        "End-to-end encryption is not available on your current plan. " +
        "E2EE has been disabled. Files will sync without encryption.",
        10_000,
      );
      this.settingTab.display();
    }
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

  // ── Encryption ────────────────────────────────────────────────────────────

  /**
   * Derive a VaultEncryption instance from current settings, or null if E2EE is
   * disabled or the passphrase / salt are not set.
   */
  async buildEncryption(): Promise<VaultEncryption | null> {
    const { encryptionEnabled, encryptionPassphrase, encryptionSalt } = this.settings;
    if (!encryptionEnabled || !encryptionPassphrase || !encryptionSalt) return null;
    return VaultEncryption.create(encryptionPassphrase, encryptionSalt);
  }

  /**
   * Called when the passphrase changes in the settings tab.
   * Re-derives the key, updates the server's key_verification_token, installs the
   * new key on SyncManager, resets sync state so all files are re-uploaded with the
   * new encryption, then restarts sync.
   */
  async reinitEncryption(): Promise<void> {
    const enc = await this.buildEncryption();
    this.syncManager.setEncryption(enc);

    // Update the server's key_verification_token when E2EE is active.
    if (enc && this.settings.remoteVaultId) {
      try {
        const token = await enc.createKeyVerificationToken();
        const currentEpoch = this.serverConfig?.vault?.e2ee?.key_epoch ?? 0;
        await this.api.putVaultEncryption(this.settings.remoteVaultId, {
          enabled: true,
          epoch: currentEpoch + 1,
          key_verification_token: token,
        });
      } catch (err) {
        console.warn("[SyncAgain] Failed to update key verification token:", err);
      }
    }

    await this.syncManager.resetSyncState();
    this.restartSync();
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const raw = ((await this.loadData()) ?? {}) as Partial<PluginData> & Record<string, unknown>;

    // Migrate legacy flat settings (no `accounts` key) into the new structure.
    const isLegacy = !("accounts" in raw);
    if (isLegacy) {
      const legacyUserId = (raw["userId"] as string | undefined) ?? "";
      const legacyAccount: AccountConfig = {
        userId: legacyUserId,
        userEmail: (raw["userEmail"] as string | undefined) ?? "",
        authToken: (raw["authToken"] as string | undefined) ?? "",
        remoteVaultId: (raw["vaultId"] as string | undefined) ?? "",
        syncEnabled: (raw["syncEnabled"] as boolean | undefined) ?? false,
        encryptionEnabled: (raw["encryptionEnabled"] as boolean | undefined) ?? false,
        encryptionPassphrase: (raw["encryptionPassphrase"] as string | undefined) ?? "",
        encryptionSalt: (raw["encryptionSalt"] as string | undefined) ?? "",
        deviceSecret: (raw["deviceSecret"] as string | undefined) ?? "",
      };
      this.pluginData = {
        clientId: raw["clientId"] ?? "",
        serverUrl: raw["serverUrl"] ?? "",
        syncIntervalMinutes: raw["syncIntervalMinutes"] ?? 5,
        currentUserId: legacyUserId,
        accounts: legacyUserId ? { [legacyUserId]: legacyAccount } : {},
      };
    } else {
      // Migrate per-account field rename: vaultId → remoteVaultId.
      const rawAccounts = raw.accounts ?? {};
      const migratedAccounts: Record<string, AccountConfig> = {};
      for (const [uid, rawAcct] of Object.entries(rawAccounts)) {
        const a = rawAcct as Partial<AccountConfig> & Record<string, unknown>;
        migratedAccounts[uid] = {
          ...DEFAULT_ACCOUNT,
          ...a,
          remoteVaultId: a.remoteVaultId ?? (a["vaultId"] as string | undefined) ?? "",
        };
      }
      this.pluginData = {
        clientId: raw.clientId ?? "",
        serverUrl: raw.serverUrl ?? "",
        syncIntervalMinutes: raw.syncIntervalMinutes ?? 5,
        currentUserId: raw.currentUserId ?? "",
        accounts: migratedAccounts,
      };
    }

    const account = this.pluginData.accounts[this.pluginData.currentUserId] ?? { ...DEFAULT_ACCOUNT };
    this.settings = {
      clientId: this.pluginData.clientId,
      serverUrl: this.pluginData.serverUrl,
      syncIntervalMinutes: this.pluginData.syncIntervalMinutes,
      ...account,
    };
  }

  async saveSettings(): Promise<void> {
    // Write the current flat settings back into the appropriate account slot.
    const { clientId, serverUrl, syncIntervalMinutes, ...account } = this.settings;
    this.pluginData.clientId = clientId;
    this.pluginData.serverUrl = serverUrl;
    this.pluginData.syncIntervalMinutes = syncIntervalMinutes;
    const userId = this.pluginData.currentUserId;
    // Never write an accounts[""] entry — "" means no active account (initial state).
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
  async switchAccount(userId: string, patch?: Partial<AccountConfig>): Promise<void> {
    // Persist the current account before switching.
    await this.saveSettings();

    this.pluginData.currentUserId = userId;
    const existing = this.pluginData.accounts[userId] ?? { ...DEFAULT_ACCOUNT, userId };
    const account: AccountConfig = { ...existing, ...patch };
    if (userId) {
      this.pluginData.accounts[userId] = account;
    }

    this.settings = {
      clientId: this.pluginData.clientId,
      serverUrl: this.pluginData.serverUrl,
      syncIntervalMinutes: this.pluginData.syncIntervalMinutes,
      ...account,
    };

    await this.saveData(this.pluginData);

    if (this.settings.authToken) {
      this.api.setToken(this.settings.authToken);
    } else {
      this.api.invalidateToken();
    }
    this.api.setRemoteVaultId(this.settings.remoteVaultId);

    // Identity changed — always tear down any existing control channel so the
    // new account's token is never applied on top of a socket opened with the
    // previous account's credentials.
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

    this.settingTab?.display();
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
  async signOutToAnonymousOrInitial(): Promise<void> {
    const anonAccount = this.pluginData.accounts[this.pluginData.clientId];
    if (anonAccount && !anonAccount.userEmail) {
      await this.switchAccount(this.pluginData.clientId);
    } else {
      await this.switchAccount("");
    }
  }
}
