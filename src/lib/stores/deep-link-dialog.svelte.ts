/**
 * Reactive store for the deep link clone confirmation dialog.
 */

import type { DeepLinkResourceType } from "$lib/services/deep-link.js";

class DeepLinkDialogStore {
  open = $state(false);
  resourceType = $state<DeepLinkResourceType>("query");
  repoUrl = $state("");
  filePath = $state("");
  branch = $state("main");

  private _resolve: ((cloned: boolean) => void) | null = null;

  /**
   * Show the dialog and wait for the user's response.
   * Returns true if the user cloned the repo, false if they cancelled.
   */
  prompt(
    resourceType: DeepLinkResourceType,
    repoUrl: string,
    filePath: string,
    branch: string,
  ): Promise<boolean> {
    this.resourceType = resourceType;
    this.repoUrl = repoUrl;
    this.filePath = filePath;
    this.branch = branch;
    this.open = true;

    return new Promise<boolean>((resolve) => {
      this._resolve = resolve;
    });
  }

  /**
   * Resolve the dialog with a result (called by the dialog component).
   */
  resolve(cloned: boolean): void {
    this.open = false;
    this._resolve?.(cloned);
    this._resolve = null;
  }
}

export const deepLinkDialogStore = new DeepLinkDialogStore();
