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
 */
export class FeatureGate {
  static validateConsistency(
    serverFeatures: string[],
    settings: SyncAgainSettings,
    plugin: SyncAgainPlugin,
  ): void {
    const locallyEnabled: Record<string, boolean> = {
      e2ee: settings.encryptionEnabled,
    };
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
 * Only negotiates features the server grants. Adding a new feature requires writing
 * a FeatureNegotiator and one coordinator.register() call — the startup path is unchanged.
 */
export class FeatureNegotiationCoordinator {
  private negotiators: FeatureNegotiator[] = [];

  register(negotiator: FeatureNegotiator): void {
    this.negotiators.push(negotiator);
  }

  async negotiateAll(
    serverFeatures: string[],
    vaultState: VaultFeatureState,
    local: SyncAgainSettings,
    plugin: SyncAgainPlugin,
  ): Promise<NegotiationResult[]> {
    const results: NegotiationResult[] = [];
    for (const negotiator of this.negotiators) {
      if (!serverFeatures.includes(negotiator.featureId)) continue;
      const result = await negotiator.negotiate(vaultState, local, plugin);
      results.push(result);
    }
    return results;
  }
}
