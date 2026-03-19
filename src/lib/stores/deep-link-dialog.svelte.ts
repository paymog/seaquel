/**
 * Reactive store for the deep link clone confirmation dialog.
 */

class DeepLinkDialogStore {
  open = $state(false);
  repoUrl = $state("");
  filePath = $state("");
  branch = $state("main");

  private _resolve: ((cloned: boolean) => void) | null = null;

  /**
   * Show the dialog and wait for the user's response.
   * Returns true if the user cloned the repo, false if they cancelled.
   */
  prompt(repoUrl: string, filePath: string, branch: string): Promise<boolean> {
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
