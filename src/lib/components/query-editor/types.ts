import type { useDatabase } from "$lib/hooks/database.svelte.js";
import type { StatementResult, QueryTab } from "$lib/types";

interface MonacoEditorRef {
  getCursorOffset: () => number;
  insertText: (text: string) => void;
}

export interface QueryEditorContext {
  db: ReturnType<typeof useDatabase>;
  getMonacoRef: () => MonacoEditorRef | null;
  getActiveTab: () => QueryTab | null;
  getActiveTabId: () => string | null;
  getActiveResult: () => StatementResult | null;
  getActiveResultIndex: () => number;
  getResultKey: () => string | null;
}
