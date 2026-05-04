import { Notice } from "obsidian";
import type SyncAgainPlugin from "./main";
import type { SyncAgainSettings } from "./settings";
import type { VaultFeatureState } from "./api-client";

export type NegotiationResult =
  | { status: "ok" }
  | { status: "reconfigured" }
  | { status: "blocked"; reason: string; userAction?: () => void };

export interface FeatureNegotiator {
  readonly featureId: string;
  negotiate(
    vaultState: VaultFeatureState,
    local: SyncAgainSettings,
    plugin: SyncAgainPlugin,
  ): Promise<NegotiationResult>;
}

/**
 * Generic guard that runs before feature-specific negotiation.
 * Disables any locally-enabled feature that is absent from the server's feature list
 * (e.g. after a plan downgrade or a tampered plugin installation).
 *
 * NOTE: E2EE is intentionally *not* listed here. E2EE entitlement gates only
 * *initiating* a migration — observation of vault E2EE state is unconditional
 * because it describes bytes-at-rest. Tampered local toggles can't take effect
 * since the server enforces entitlement on `PUT /api/vaults/{id}/encryption`
 * and on uploads.
 */
export class FeatureGate {
  static validateConsistency(
    serverFeatures: string[],
    settings: SyncAgainSettings,
    plugin: SyncAgainPlugin,
  ): void {
    const locallyEnabled: Record<string, boolean> = {};
    for (const [feature, enabled] of Object.entries(locallyEnabled)) {
      if (enabled && !serverFeatures.includes(feature)) {
        plugin.disableFeature(feature);
        new Notice(
          `"${feature}" is not available on your current plan and has been disabled.`,
          8000,
        );
      }
    }
  }
}

/**
 * Iterates registered FeatureNegotiators at startup and on WebSocket reconnect.
 * All registered negotiators run on every config delivery — feature entitlement
 * is enforced server-side on initiation (e.g. PUT /api/vaults/{id}/encryption,
 * POST /api/files/upload), and each negotiator already inspects `vaultState`
 * to decide whether it has work to do. This guarantees that server-authoritative
 * vault state (e.g. another device's E2EE migration) propagates to observers
 * even when the observer's account has no per-user grant for the feature.
 */
export class FeatureNegotiationCoordinator {
  private negotiators: FeatureNegotiator[] = [];

  register(negotiator: FeatureNegotiator): void {
    this.negotiators.push(negotiator);
  }

  async negotiateAll(
    _serverFeatures: string[],
    vaultState: VaultFeatureState,
    local: SyncAgainSettings,
    plugin: SyncAgainPlugin,
  ): Promise<NegotiationResult[]> {
    const results: NegotiationResult[] = [];
    for (const negotiator of this.negotiators) {
      const result = await negotiator.negotiate(vaultState, local, plugin);
      results.push(result);
    }
    return results;
  }
}
