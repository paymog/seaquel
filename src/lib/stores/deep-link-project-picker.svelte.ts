/**
 * Reactive store for the deep link project picker dialog.
 * Used when importing a connection or dashboard from a deep link
 * and the user has multiple projects to choose from.
 */

import type { DeepLinkResourceType } from "$lib/services/deep-link.js";

class DeepLinkProjectPickerStore {
  open = $state(false);
  resourceType = $state<DeepLinkResourceType>("connection");
  resourceName = $state("");

  private _resolve: ((projectId: string | null) => void) | null = null;

  /**
   * Show the project picker and wait for the user's selection.
   * Returns the selected project ID, or null if cancelled.
   */
  prompt(type: DeepLinkResourceType, name: string): Promise<string | null> {
    this.resourceType = type;
    this.resourceName = name;
    this.open = true;

    return new Promise<string | null>((resolve) => {
      this._resolve = resolve;
    });
  }

  /**
   * Resolve the dialog with a result (called by the dialog component).
   */
  resolve(projectId: string | null): void {
    this.open = false;
    this._resolve?.(projectId);
    this._resolve = null;
  }
}

export const deepLinkProjectPickerStore = new DeepLinkProjectPickerStore();
