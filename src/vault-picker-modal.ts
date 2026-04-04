import { App, Modal, Notice, Setting } from "obsidian";
import type SyncAgainPlugin from "./main";

export function showVaultPickerModal(
  app: App,
  vaults: { vault_id: string; name: string }[],
  plugin: SyncAgainPlugin,
): void {
  new VaultPickerModal(app, vaults, plugin).open();
}

class VaultPickerModal extends Modal {
  constructor(
    app: App,
    private readonly vaults: { vault_id: string; name: string }[],
    private readonly plugin: SyncAgainPlugin,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Connect to a remote vault" });
    contentEl.createEl("p", {
      text: "Choose an existing vault to sync with this device, or create a new one.",
      cls: "setting-item-description",
    });

    for (const v of this.vaults) {
      new Setting(contentEl)
        .setName(v.name)
        .setDesc(`ID: ${v.vault_id}`)
        .addButton((btn) =>
          btn
            .setButtonText("Connect")
            .setCta()
            .onClick(async () => {
              btn.setButtonText("Connecting…").setDisabled(true);
              try {
                await this.plugin.api.joinVault(v.vault_id);
                this.plugin.settings.remoteVaultId = v.vault_id;
                this.plugin.api.setRemoteVaultId(v.vault_id);
                await this.plugin.saveSettings();
                this.close();
                this.plugin.startSync();
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                new Notice(`Failed to connect to vault: ${msg}`);
                btn.setButtonText("Connect").setDisabled(false);
              }
            }),
        );
    }

    new Setting(contentEl)
      .setName("Create new vault")
      .setDesc("Start fresh with a new remote vault for this device.")
      .addButton((btn) =>
        btn.setButtonText("Create vault").onClick(async () => {
          btn.setButtonText("Creating…").setDisabled(true);
          try {
            const result = await this.plugin.api.createVault(this.plugin.app.vault.getName());
            this.plugin.settings.remoteVaultId = result.vault_id;
            this.plugin.api.setRemoteVaultId(result.vault_id);
            await this.plugin.saveSettings();
            this.close();
            this.plugin.startSync();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`Failed to create vault: ${msg}`);
            btn.setButtonText("Create vault").setDisabled(false);
          }
        }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
