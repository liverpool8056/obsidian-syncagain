import type SyncAgainPlugin from "../main";
import type { FeatureNegotiator, NegotiationResult } from "../feature-negotiation";
import type { SyncAgainSettings } from "../settings";
import type { VaultFeatureState } from "../api-client";
import { VaultEncryption } from "../vault-encryption";
import { showJoinE2EEModal } from "./e2ee-join-modal";

/**
 * Negotiates E2EE state between the local plugin settings and the server's vault config.
 * Implements the 4-state machine: DISABLED, MIGRATING, ACTIVE, MIGRATING_TO_OFF.
 */
export class E2EENegotiator implements FeatureNegotiator {
  readonly featureId = "e2ee";

  async negotiate(
    vaultState: VaultFeatureState,
    local: SyncAgainSettings,
    plugin: SyncAgainPlugin,
  ): Promise<NegotiationResult> {
    const e2ee = vaultState.e2ee;
    console.debug(
      `[SyncAgain] e2ee-negotiator — localStatus=${local.encryptionStatus}` +
      ` serverStatus=${e2ee?.status ?? "<none>"} initiator=${e2ee?.initiator_id ?? "<none>"}` +
      ` localCid=${local.clientId} hasLocalDEK=${!!local.encryptionDEK}`,
    );

    // ── Case 1: vault has E2EE DISABLED on server ────────────────────────
    if (!e2ee || e2ee.status === "DISABLED") {
      if (local.encryptionStatus !== "DISABLED") {
        const prev = local.encryptionStatus;
        local.encryptionStatus = "DISABLED";
        local.encryptionEnabled = false;
        local.encryptionSecretKey = "";
        local.encryptionDEK = "";
        local.encryptionSalt = "";
        await plugin.saveSettings();
        console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} → DISABLED (negotiator-case1)`);
        return { status: "reconfigured" };
      }
      return { status: "ok" };
    }

    // Update local status to match server.
    if (local.encryptionStatus !== e2ee.status) {
      const prev = local.encryptionStatus;
      local.encryptionStatus = e2ee.status;
      local.encryptionEnabled = true;
      await plugin.saveSettings();
      console.debug(`[SyncAgain] encryptionStatus mutated: ${prev} → ${e2ee.status} (negotiator-sync)`);
      // Don't return reconfigured yet; we might be blocked.
    }

    // ── Case 2: vault is MIGRATING or ACTIVE ─────────────────────────────

    // If we are the initiator of a migration, we are allowed to proceed.
    if (
      (e2ee.status === "MIGRATING" || e2ee.status === "MIGRATING_TO_OFF") &&
      e2ee.initiator_id === local.clientId
    ) {
      // Check if we have the DEK. We must have it if we are the initiator.
      if (!local.encryptionDEK) {
        return {
          status: "blocked",
          reason: "You are the initiator of a migration but your local encryption key is missing.",
        };
      }
      return { status: "ok" };
    }

    // Someone else is migrating. If we have key material from the server but no
    // local DEK, this is the same join flow as the ACTIVE case — surface the
    // unlock modal so the user can read encrypted files the initiator already
    // uploaded. Writes still 423-block until the initiator finalizes.
    if (e2ee.status === "MIGRATING" || e2ee.status === "MIGRATING_TO_OFF") {
      if (
        !local.encryptionDEK &&
        !local.encryptionSecretKey &&
        e2ee.salt &&
        e2ee.encrypted_dek &&
        e2ee.key_verification_token
      ) {
        return {
          status: "blocked",
          reason:
            "Another device is migrating this vault to E2EE. Enter the secret key " +
            "from that device to unlock and read encrypted files on this device.",
          userAction: () => showJoinE2EEModal(plugin.app, plugin, e2ee),
        };
      }
      return {
        status: "blocked",
        reason: "Vault is currently migrating to/from E2EE. Please wait for the process to complete.",
      };
    }

    // ── Case 3: ACTIVE ───────────────────────────────────────────────────
    if (e2ee.status === "ACTIVE") {
      // Do we have the Secret Key or DEK?
      if (!local.encryptionDEK && !local.encryptionSecretKey) {
        return {
          status: "blocked",
          reason: "This vault is encrypted. Enter the secret key to unlock it on this device.",
          userAction: () => showJoinE2EEModal(plugin.app, plugin, e2ee),
        };
      }

      // If we only have Secret Key but no DEK, try to unlock.
      if (!local.encryptionDEK && local.encryptionSecretKey) {
        try {
          const enc = await VaultEncryption.fromSecretKey(
            local.encryptionSecretKey,
            e2ee.salt!,
            e2ee.encrypted_dek!,
          );
          const valid = await enc.verifyKeyToken(e2ee.key_verification_token!);
          if (!valid) {
            return {
              status: "blocked",
              reason: "Secret key is incorrect or was rotated. Update it in settings.",
            };
          }
          // Unlock success! Store DEK and Salt.
          local.encryptionDEK = await enc.exportDEK();
          local.encryptionSalt = e2ee.salt!;
          await plugin.saveSettings();
          return { status: "reconfigured" };
        } catch (err) {
          return {
            status: "blocked",
            reason: `Failed to unlock vault: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      // We have the DEK. Verify it against the server token.
      try {
        const enc = await VaultEncryption.importDEK(local.encryptionDEK);
        const valid = await enc.verifyKeyToken(e2ee.key_verification_token!);
        if (!valid) {
          // DEK is stale. Re-try with Secret Key if we have it, otherwise block.
          local.encryptionDEK = "";
          await plugin.saveSettings();
          return { status: "reconfigured" };
        }
        return { status: "ok" };
      } catch {
        return { status: "blocked", reason: "Failed to verify local encryption key." };
      }
    }

    return { status: "ok" };
  }
}
