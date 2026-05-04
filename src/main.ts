import { Notice, Plugin, TAbstractFile } from "obsidian";

import { showConflictResolutionModal } from "./first-sync-modal";
import { showVaultPickerModal } from "./vault-picker-modal";

import {
  SyncAgainSettings,
  DEFAULT_SETTINGS,
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
  serverConfig: ServerConfig | null = null;
  private syncIntervalId: number | null = null;
  private settingTab: SyncAgainSettingTab;
  private statusBarEl: HTMLElement | null = null;
  /**
   * Set by `loadSettings` when migrating away from a previously-stored
   * anonymous account. Consumed by the layout-ready callback to show a
   * one-time notice explaining that the user has been signed out.
   */
  private signedOutFromAnonymous = false;
  /**
   * Set to true by `initVaultIfNeeded` after the handshake returns
   * `created: true`. The next `onConfig` consumes the flag and PUTs this
   * device's local synced settings, initialising the server-side row.
   */
  private pendingSettingsFirstWrite = false;

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
    this.syncManager.onCycleDrained = () => { void this.tryAutoFinalizeE2EE(); };

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

      await this.signIn({ userId, userEmail: email, authToken: token });
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

      if (this.signedOutFromAnonymous) {
        this.signedOutFromAnonymous = false;
        new Notice(
          "Anonymous accounts are no longer supported. Sign in or create an account in plugin settings to resume syncing.",
          15_000,
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
   * No-op when not signed in.
   */
  startSync(): void {
    if (!this.settings.authToken) return;
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
        // Server auto-created the first vault for this account. This device
        // owns first-write of vault settings — the next onConfig consumes
        // the flag and PUTs the local sync_interval_minutes.
        this.settings.remoteVaultId = result.vault.vault_id;
        this.api.setRemoteVaultId(result.vault.vault_id);
        this.pendingSettingsFirstWrite = true;
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

    // Step 2: apply synced settings from the server.
    //
    // First-write rule: if `vault_settings_initialized` is false, the server
    // is returning fallback defaults — we only PUT our local settings when
    // *this* device just received `created: true` from the handshake (flag
    // tracked in `pendingSettingsFirstWrite`). Joining devices read-only.
    await this.applySyncedSettings(config);

    // Step 3: consistency validation.
    FeatureGate.validateConsistency(config.features, this.settings, this);

    // Step 4: feature-specific negotiation.
    const results = await this.coordinator.negotiateAll(
      config.features,
      config.vault,
      this.settings,
      this,
    );

    // Refresh the settings UI after negotiation so any state the negotiators
    // mutated (e.g. encryptionStatus going DISABLED → MIGRATING when another
    // device kicks off a migration) is reflected immediately.
    this.settingTab?.display();

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
  private async applySyncedSettings(config: ServerConfig): Promise<void> {
    const vault = config.vault;
    if (!vault) return;

    // First-write upload: only the device that just created the vault may
    // initialise the row; everyone else falls through to read-only.
    if (!vault.vault_settings_initialized && this.pendingSettingsFirstWrite) {
      this.pendingSettingsFirstWrite = false;
      try {
        await this.api.updateVaultSettings(this.settings.remoteVaultId, {
          sync_interval_minutes: this.settings.syncIntervalMinutes,
        });
      } catch (err) {
        console.warn("[SyncAgain] First-write of vault settings failed:", err);
      }
      return;
    }

    const remote = vault.settings;
    if (remote.sync_interval_minutes === this.settings.syncIntervalMinutes) return;

    this.settings.syncIntervalMinutes = remote.sync_interval_minutes;
    await this.saveSettings();

    if (this.syncIntervalId !== null) {
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
    void this.signOut().then(() => {
      new Notice(
        "Session expired or not signed in. Please sign in again in the plugin settings.",
        8000,
      );
    });
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
   * Surfaces the error to the user. We deliberately do NOT auto-disable E2EE
   * here: the vault may already be `ACTIVE`/`MIGRATING` server-side, in which
   * case dropping encryption would leak plaintext into an encrypted vault.
   * Resolution paths: grant the feature, set `E2EE_FOR_ALL` on the server, or
   * start a rollback through the settings UI.
   */
  private handleFeatureNotEnabled(feature: string): void {
    if (feature === "e2ee") {
      new Notice(
        "End-to-end encryption is not enabled for this account. Uploads are paused " +
        "until the 'e2ee' feature is granted, the server is started with " +
        "E2EE_FOR_ALL=true, or the vault is rolled back to plaintext.",
        15_000,
      );
      this.settingTab.display();
    }
  }

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
   * disabled or the DEK is not set.
   */
  async buildEncryption(): Promise<VaultEncryption | null> {
    const { encryptionStatus, encryptionDEK } = this.settings;
    if (encryptionStatus === "DISABLED" || !encryptionDEK) return null;
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
  async startE2EEMigration(): Promise<void> {
    console.debug(
      `[SyncAgain] startE2EEMigration entry — remoteVaultId=${this.settings.remoteVaultId}` +
      ` localStatus=${this.settings.encryptionStatus}`,
    );
    if (!this.settings.remoteVaultId) {
      console.warn("[SyncAgain] startE2EEMigration aborted — no remoteVaultId");
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
        token,
      });

      const prev = this.settings.encryptionStatus;
      this.settings.encryptionStatus = "MIGRATING";
      this.settings.encryptionEnabled = true;
      this.settings.encryptionSecretKey = secretKey;
      this.settings.encryptionSalt = salt;
      this.settings.encryptionDEK = dekHex;
      await this.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} → MIGRATING (startE2EEMigration)`);

      this.syncManager.setEncryption(instance);
      await this.syncManager.resetSyncState();

      new Notice("Encryption migration started. Keep Obsidian open until all files are re-uploaded.");
      this.startSync();
    } catch (err) {
      console.error("[SyncAgain] startE2EEMigration error:", err);
      new Notice(`Failed to start E2EE migration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Called by SyncManager after a sync cycle drains the dirty queue with no
   * upload failures. On the pinned initiator, advances the E2EE state machine
   * automatically so the user doesn't have to remember to click "Finalize".
   * Non-initiators ignore the signal — only the initiator may flip the state.
   */
  private async tryAutoFinalizeE2EE(): Promise<void> {
    const e2ee = this.serverConfig?.vault?.e2ee;
    const localStatus = this.settings.encryptionStatus;
    const localCid = this.settings.clientId;
    console.debug(
      `[SyncAgain] tryAutoFinalizeE2EE — localStatus=${localStatus}` +
      ` serverStatus=${e2ee?.status ?? "<no-config>"}` +
      ` initiator=${e2ee?.initiator_id ?? "<none>"} localClientId=${localCid}`,
    );
    if (!e2ee || !e2ee.initiator_id) {
      console.debug("[SyncAgain] tryAutoFinalizeE2EE skipped — no server e2ee state or no initiator");
      return;
    }
    if (e2ee.initiator_id !== localCid) {
      console.debug("[SyncAgain] tryAutoFinalizeE2EE skipped — not the initiator");
      return;
    }

    if (localStatus === "MIGRATING") {
      console.debug("[SyncAgain] auto-finalizing migration (MIGRATING → ACTIVE)");
      await this.finalizeE2EEMigration();
      this.settingTab?.display();
    } else if (localStatus === "MIGRATING_TO_OFF") {
      console.debug("[SyncAgain] auto-finalizing rollback (MIGRATING_TO_OFF → DISABLED)");
      await this.finalizeE2EERollback();
      this.settingTab?.display();
    } else {
      console.debug(`[SyncAgain] tryAutoFinalizeE2EE skipped — localStatus=${localStatus} not in transitional state`);
    }
  }

  /**
   * Finalize the E2EE migration once all files are uploaded.
   */
  async finalizeE2EEMigration(): Promise<void> {
    console.debug(
      `[SyncAgain] finalizeE2EEMigration entry — remoteVaultId=${this.settings.remoteVaultId}` +
      ` status=${this.settings.encryptionStatus}`,
    );
    if (!this.settings.remoteVaultId || this.settings.encryptionStatus !== "MIGRATING") {
      console.warn("[SyncAgain] finalizeE2EEMigration aborted — preconditions not met");
      return;
    }

    try {
      const enc = await this.buildEncryption();
      if (!enc) throw new Error("Encryption instance not available.");
      const token = await enc.createKeyVerificationToken();

      console.debug("[SyncAgain] PUT /api/vaults/{id}/encryption status=ACTIVE");
      await this.api.putVaultEncryption(this.settings.remoteVaultId, {
        status: "ACTIVE",
        epoch: 1,
        token,
      });

      const prev = this.settings.encryptionStatus;
      this.settings.encryptionStatus = "ACTIVE";
      await this.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} → ACTIVE (finalizeE2EEMigration)`);
      new Notice("Encryption migration complete. Your vault is now fully encrypted.");
    } catch (err) {
      console.error("[SyncAgain] finalizeE2EEMigration error:", err);
      new Notice(`Failed to finalize E2EE migration: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Start the rollback from E2EE to plaintext.
   */
  async startE2EERollback(): Promise<void> {
    console.debug(
      `[SyncAgain] startE2EERollback entry — remoteVaultId=${this.settings.remoteVaultId}` +
      ` status=${this.settings.encryptionStatus}`,
    );
    if (!this.settings.remoteVaultId || this.settings.encryptionStatus !== "ACTIVE") {
      console.warn("[SyncAgain] startE2EERollback aborted — preconditions not met");
      return;
    }

    try {
      console.debug("[SyncAgain] PUT /api/vaults/{id}/encryption status=MIGRATING_TO_OFF");
      await this.api.putVaultEncryption(this.settings.remoteVaultId, {
        status: "MIGRATING_TO_OFF",
        epoch: 1,
      });

      const prev = this.settings.encryptionStatus;
      this.settings.encryptionStatus = "MIGRATING_TO_OFF";
      await this.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} → MIGRATING_TO_OFF (startE2EERollback)`);

      // Temporarily disable encryption in SyncManager so it uploads plaintext,
      // but keep the local keys until finalized.
      this.syncManager.setEncryption(null);
      await this.syncManager.resetSyncState();

      new Notice("Rolling back encryption. Files are being re-uploaded in plaintext.");
      this.startSync();
    } catch (err) {
      new Notice(`Failed to start E2EE rollback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Finalize the E2EE rollback.
   */
  async finalizeE2EERollback(): Promise<void> {
    console.debug(
      `[SyncAgain] finalizeE2EERollback entry — remoteVaultId=${this.settings.remoteVaultId}` +
      ` status=${this.settings.encryptionStatus}`,
    );
    if (!this.settings.remoteVaultId || this.settings.encryptionStatus !== "MIGRATING_TO_OFF") {
      console.warn("[SyncAgain] finalizeE2EERollback aborted — preconditions not met");
      return;
    }

    try {
      console.debug("[SyncAgain] PUT /api/vaults/{id}/encryption status=DISABLED");
      await this.api.putVaultEncryption(this.settings.remoteVaultId, {
        status: "DISABLED",
        epoch: 0,
      });

      const prev = this.settings.encryptionStatus;
      this.settings.encryptionStatus = "DISABLED";
      this.settings.encryptionEnabled = false;
      this.settings.encryptionSecretKey = "";
      this.settings.encryptionDEK = "";
      this.settings.encryptionSalt = "";
      await this.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} → DISABLED (finalizeE2EERollback)`);

      new Notice("Encryption has been disabled.");
    } catch (err) {
      console.error("[SyncAgain] finalizeE2EERollback error:", err);
      new Notice(`Failed to finalize E2EE rollback: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;

    // ── Legacy migration ───────────────────────────────────────────────────
    // Older versions stored either flat fields or a multi-account map under
    // `accounts` keyed by userId, with `currentUserId` selecting the active one.
    // Both forms also supported anonymous accounts (userId === clientId, no
    // email). Anonymous accounts are no longer supported, so on load we drop
    // any anonymous credentials and resurface a one-time notice.

    const clientId = (raw["clientId"] as string | undefined) ?? "";
    const serverUrl = (raw["serverUrl"] as string | undefined) ?? "";
    const syncIntervalMinutes = (raw["syncIntervalMinutes"] as number | undefined) ?? 5;

    // Resolve the active account record from either schema shape.
    let account: Record<string, unknown> = {};
    if ("accounts" in raw && typeof raw["accounts"] === "object" && raw["accounts"] !== null) {
      const accounts = raw["accounts"] as Record<string, Record<string, unknown>>;
      const currentUserId = (raw["currentUserId"] as string | undefined) ?? "";
      account = accounts[currentUserId] ?? {};
    } else {
      account = raw;
    }

    const userId = (account["userId"] as string | undefined) ?? "";
    const userEmail = (account["userEmail"] as string | undefined) ?? "";
    const authToken = (account["authToken"] as string | undefined) ?? "";

    // Detect anonymous identity: userId === clientId and no email. Discard
    // credentials so the user is signed out cleanly; flag the migration so
    // the next layout-ready callback can surface a notice.
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
      remoteVaultId: wasAnonymous
        ? ""
        : ((account["remoteVaultId"] as string | undefined) ?? (account["vaultId"] as string | undefined) ?? ""),
      syncEnabled: wasAnonymous ? false : ((account["syncEnabled"] as boolean | undefined) ?? false),
      encryptionEnabled: wasAnonymous ? false : ((account["encryptionEnabled"] as boolean | undefined) ?? false),
      encryptionStatus: wasAnonymous
        ? "DISABLED"
        : ((account["encryptionStatus"] as SyncAgainSettings["encryptionStatus"] | undefined)
            ?? (account["encryptionEnabled"] ? "ACTIVE" : "DISABLED")),
      encryptionSecretKey: wasAnonymous
        ? ""
        : ((account["encryptionSecretKey"] as string | undefined)
            ?? (account["encryptionPassphrase"] as string | undefined) ?? ""),
      encryptionSalt: wasAnonymous ? "" : ((account["encryptionSalt"] as string | undefined) ?? ""),
      encryptionDEK: wasAnonymous ? "" : ((account["encryptionDEK"] as string | undefined) ?? ""),
    };

    // Persist the migrated shape so the legacy fields are gone after the
    // first run on the new code.
    if ("accounts" in raw || "currentUserId" in raw || wasAnonymous) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Set credentials after a successful sign-in, then start sync if enabled. */
  async signIn(creds: { userId: string; userEmail: string; authToken: string }): Promise<void> {
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

    this.settingTab?.display();
  }

  /** Clear all account credentials and any vault/E2EE state derived from them. */
  async signOut(): Promise<void> {
    this.stopSync();
    this.api.invalidateToken();
    this.api.setRemoteVaultId("");

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
}
