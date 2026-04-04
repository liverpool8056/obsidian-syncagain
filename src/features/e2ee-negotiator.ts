import type SyncAgainPlugin from "../main";
import type { FeatureNegotiator, NegotiationResult } from "../feature-negotiation";
import type { SyncAgainSettings } from "../settings";
import type { VaultFeatureState } from "../api-client";
import { VaultEncryption } from "../vault-encryption";

/**
 * Negotiates E2EE state between the local plugin settings and the server's vault config.
 *
 * Decision table:
 *
 * | Server vault E2EE state | Local state            | Action                                    |
 * |------------------------|------------------------|-------------------------------------------|
 * | absent (never set)     | enabled + passphrase   | Register E2EE on server (epoch 1)         |
 * | absent (never set)     | disabled or no phrase  | ok — nothing to do                        |
 * | enabled                | no passphrase          | blocked — prompt user to enter passphrase |
 * | enabled                | passphrase mismatch    | blocked — passphrase rotated elsewhere    |
 * | enabled                | passphrase matches     | ok                                        |
 * | disabled               | enabled locally        | reconfigured — disable local E2EE         |
 * | disabled               | disabled locally       | ok                                        |
 */
export class E2EENegotiator implements FeatureNegotiator {
  readonly featureId = "e2ee";

  async negotiate(
    vaultState: VaultFeatureState,
    local: SyncAgainSettings,
    plugin: SyncAgainPlugin,
  ): Promise<NegotiationResult> {
    const e2ee = vaultState.e2ee;

    // ── Case 1: vault has never configured E2EE ────────────────────────────
    if (!e2ee) {
      if (local.encryptionEnabled && local.encryptionPassphrase) {
        // This device wants E2EE — establish it on the server.
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
            key_verification_token: token,
          });
        } catch (err) {
          return {
            status: "blocked",
            reason: `Failed to register E2EE with server: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
      return { status: "ok" };
    }

    // ── Case 2: server vault has E2EE enabled ─────────────────────────────
    if (e2ee.enabled) {
      if (!local.encryptionPassphrase) {
        return {
          status: "blocked",
          reason: "E2EE is active on this vault — enter your passphrase in plugin settings to continue.",
        };
      }
      if (!local.encryptionSalt) {
        return {
          status: "blocked",
          reason: "E2EE is active but no local salt is stored. Re-enter your passphrase in plugin settings.",
        };
      }
      try {
        const enc = await VaultEncryption.create(local.encryptionPassphrase, local.encryptionSalt);
        const valid = await enc.verifyKeyToken(e2ee.key_verification_token);
        if (!valid) {
          return {
            status: "blocked",
            reason:
              "E2EE passphrase is incorrect or was rotated on another device. " +
              "Update your passphrase in plugin settings.",
          };
        }
        // Ensure local E2EE is marked enabled in case it was disabled on this device.
        if (!local.encryptionEnabled) {
          local.encryptionEnabled = true;
          await plugin.saveSettings();
          return { status: "reconfigured" };
        }
        return { status: "ok" };
      } catch {
        return { status: "blocked", reason: "Failed to verify E2EE passphrase." };
      }
    }

    // ── Case 3: server vault has E2EE disabled ────────────────────────────
    if (local.encryptionEnabled) {
      local.encryptionEnabled = false;
      await plugin.saveSettings();
      return { status: "reconfigured" };
    }

    return { status: "ok" };
  }
}
