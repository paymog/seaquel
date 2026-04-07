import * as monaco from "monaco-editor";
import { setupLanguageFeatures, LanguageIdEnum } from "monaco-sql-languages";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

let isInitialized = false;

export async function initMonaco(): Promise<void> {
  if (isInitialized) return;

  // Configure Monaco workers for Vite ESM
  // Using Vite's ?worker import ensures the worker is properly bundled
  // in production (plain `new URL()` creates a data: URL with unresolved imports)
  self.MonacoEnvironment = {
    getWorker() {
      return new EditorWorker();
    },
  };

  // Setup PostgreSQL language features from monaco-sql-languages
  // Disable built-in completions since we provide our own schema-aware completions
  setupLanguageFeatures(LanguageIdEnum.PG, {
    completionItems: {
      enable: false,
    },
  });

  // Define custom themes with template variable styling
  defineCustomThemes();

  isInitialized = true;
}

/**
 * Define custom Monaco themes that extend the default themes
 * with styling for template variables ({{var}})
 */
function defineCustomThemes(): void {
  // Light theme extending vs
  monaco.editor.defineTheme("seaquel-light", {
    base: "vs",
    inherit: true,
    rules: [{ token: "template-variable", foreground: "9333ea", fontStyle: "bold" }],
    colors: {},
  });

  // Dark theme extending vs-dark
  monaco.editor.defineTheme("seaquel-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [{ token: "template-variable", foreground: "c084fc", fontStyle: "bold" }],
    colors: {},
  });
}

export { monaco };
