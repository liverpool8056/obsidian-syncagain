import { App, Modal, Notice, Setting } from "obsidian";
import type SyncAgainPlugin from "../main";
import type { VaultE2EEState } from "../api-client";
import { VaultEncryption } from "../vault-encryption";

/**
 * Shown automatically when this device pulls a server config that has E2EE
 * enabled but the device does not yet hold the DEK or Secret Key. The user
 * enters the Secret Key from the device that started the migration and we
 * verify it against `key_verification_token` before storing the DEK locally.
 */
export function showJoinE2EEModal(
  app: App,
  plugin: SyncAgainPlugin,
  e2ee: VaultE2EEState,
): void {
  new JoinE2EEModal(app, plugin, e2ee).open();
}

class JoinE2EEModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: SyncAgainPlugin,
    private readonly e2ee: VaultE2EEState,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    this.setTitle("Unlock encrypted vault");
    contentEl.createEl("p", {
      text:
        "End-to-end encryption is enabled for this vault. Enter the secret key " +
        "from the device that originally enabled E2EE to unlock this vault on " +
        "this device.",
      cls: "setting-item-description",
    });

    let secretKey = "";
    new Setting(contentEl)
      .setName("Secret key")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("xxxx-xxxx-xxxx-xxxx")
          .onChange((value) => {
            secretKey = value.trim();
          });
        text.inputEl.focus();
      });

    const errorEl = contentEl.createEl("p", { cls: "syncagain-modal-error" });

    const buttonRow = contentEl.createDiv({ cls: "syncagain-secret-key-buttons" });
    buttonRow.createEl("button", { text: "Cancel" }).onClickEvent(() => this.close());
    const unlockBtn = buttonRow.createEl("button", { text: "Unlock", cls: "mod-cta" });

    unlockBtn.onClickEvent(async () => {
      errorEl.setText("");
      if (!secretKey) {
        errorEl.setText("Please enter your secret key.");
        return;
      }
      if (!this.e2ee.salt || !this.e2ee.encrypted_dek || !this.e2ee.key_verification_token) {
        errorEl.setText("Server config is incomplete; cannot unlock.");
        return;
      }
      unlockBtn.setText("Unlocking…");
      unlockBtn.setAttribute("disabled", "true");
      try {
        const enc = await VaultEncryption.fromSecretKey(
          secretKey,
          this.e2ee.salt,
          this.e2ee.encrypted_dek,
        );
        const valid = await enc.verifyKeyToken(this.e2ee.key_verification_token);
        if (!valid) {
          errorEl.setText("Incorrect secret key. Double-check the key from your other device.");
          unlockBtn.setText("Unlock");
          unlockBtn.removeAttribute("disabled");
          return;
        }
        this.plugin.settings.encryptionStatus = this.e2ee.status;
        this.plugin.settings.encryptionEnabled = true;
        this.plugin.settings.encryptionSecretKey = secretKey;
        this.plugin.settings.encryptionSalt = this.e2ee.salt;
        this.plugin.settings.encryptionDEK = await enc.exportDEK();
        await this.plugin.saveSettings();

        new Notice("Vault unlocked. Sync will resume.");
        this.close();
        this.plugin.restartSync();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorEl.setText(`Failed to unlock: ${msg}`);
        unlockBtn.setText("Unlock");
        unlockBtn.removeAttribute("disabled");
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
