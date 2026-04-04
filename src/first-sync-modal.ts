import { App, Modal } from "obsidian";

import { ConflictFile } from "./metadata";

/**
 * Show the conflict resolution modal and return a Promise that resolves with
 * the set of paths the user chose to keep local. Paths absent from the set
 * will be overwritten by the remote version.
 */
export function showConflictResolutionModal(
  app: App,
  conflicts: ConflictFile[],
): Promise<Set<string>> {
  return new Promise((resolve) => {
    new ConflictResolutionModal(app, conflicts, resolve).open();
  });
}

// ── Conflict list modal ──────────────────────────────────────────────────────

class ConflictResolutionModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly conflicts: ConflictFile[],
    private readonly resolve: (keepLocal: Set<string>) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Sync conflicts detected" });
    contentEl.createEl("p", {
      text:
        `${this.conflicts.length} file${this.conflicts.length === 1 ? "" : "s"} ` +
        "exist both locally and on the server with different content. " +
        "Choose how to resolve all conflicts:",
    });

    const table = contentEl.createEl("table");
    const headerRow = table.createEl("thead").createEl("tr");
    headerRow.createEl("th", { text: "File" });
    headerRow.createEl("th", { text: "Local modified" });
    headerRow.createEl("th", { text: "Remote modified" });

    const tbody = table.createEl("tbody");
    for (const c of this.conflicts) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: c.path });
      row.createEl("td", { text: new Date(c.localMtime).toLocaleString() });
      row.createEl("td", { text: new Date(c.remoteMtime).toLocaleString() });
    }

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

    buttonRow.createEl("button", { text: "Keep remote" })
      .addEventListener("click", () => {
        this.resolved = true;
        this.close();
        this.resolve(new Set());
      });

    buttonRow.createEl("button", { text: "Keep local", cls: "mod-cta" })
      .addEventListener("click", () => {
        this.resolved = true;
        this.close();
        this.resolve(new Set(this.conflicts.map((c) => c.path)));
      });
  }

  onClose(): void {
    if (!this.resolved) {
      new ConflictConfirmModal(this.app, this.conflicts, this.resolve).open();
    }
    this.contentEl.empty();
  }
}

// ── Dismiss confirmation modal ───────────────────────────────────────────────

class ConflictConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly conflicts: ConflictFile[],
    private readonly resolve: (keepLocal: Set<string>) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Keep remote versions?" });
    contentEl.createEl("p", {
      text:
        "You have unresolved conflicts. Remote is the authoritative source for a " +
        "device joining an existing account. All conflicting files will be " +
        "overwritten with the remote version.",
    });

    const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });

    buttonRow.createEl("button", { text: "Cancel" })
      .addEventListener("click", () => {
        this.resolved = true;
        this.close();
        new ConflictResolutionModal(this.app, this.conflicts, this.resolve).open();
      });

    buttonRow.createEl("button", { text: "Confirm", cls: "mod-warning" })
      .addEventListener("click", () => {
        this.resolved = true;
        this.close();
        this.resolve(new Set());
      });
  }

  onClose(): void {
    if (!this.resolved) {
      // Dismissed without choosing — treat as Confirm
      this.resolve(new Set());
    }
    this.contentEl.empty();
  }
}
