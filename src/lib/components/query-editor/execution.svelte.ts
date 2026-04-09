import {
  findDestructiveStatements,
  isDestructiveStatement,
  type DestructiveStatement,
} from "$lib/db/query-utils.js";
import { splitSqlStatements, getStatementAtOffset } from "$lib/db/sql-parser.js";
import { hasParameters } from "$lib/db/query-params.js";
import type { ParameterValue, DatabaseType } from "$lib/types";
import type { QueryEditorContext } from "./types.js";
import type { ParamDialog } from "./param-dialog.svelte.js";

export function createExecution(
  ctx: QueryEditorContext,
  paramDialog: ParamDialog,
  syncVisualBuilder: () => void,
) {
  const { db } = ctx;

  let showDestructiveConfirm = $state(false);
  let destructiveStatements = $state<DestructiveStatement[]>([]);
  let pendingDestructiveAction = $state<(() => void) | null>(null);

  function proceedWithExecute(query: string, tabId: string) {
    if (hasParameters(query)) {
      paramDialog.params = paramDialog.getParameterDefinitions(query);
      paramDialog.action = "query";
      paramDialog.show = true;
    } else {
      void db.queries.execute(tabId);
    }
  }

  function proceedWithExecuteCurrent(
    query: string,
    tabId: string,
    cursorOffset: number,
    dbType: DatabaseType,
  ) {
    const currentStatement = getStatementAtOffset(query, cursorOffset, dbType);

    if (currentStatement && hasParameters(currentStatement.sql)) {
      paramDialog.params = paramDialog.getParameterDefinitions(currentStatement.sql);
      paramDialog.action = { type: "query-current", cursorOffset };
      paramDialog.show = true;
    } else {
      void db.queries.executeCurrent(tabId, cursorOffset);
    }
  }

  function handleExecute() {
    const activeTab = ctx.getActiveTab();
    const activeTabId = ctx.getActiveTabId();
    if (!activeTabId || !activeTab) return;

    syncVisualBuilder();

    const query = activeTab.query;
    const dbType = db.state.activeConnection?.type ?? "postgres";

    const statements = splitSqlStatements(query, dbType);
    const dangerous = findDestructiveStatements(statements);

    if (dangerous.length > 0) {
      destructiveStatements = dangerous;
      pendingDestructiveAction = () => proceedWithExecute(query, activeTabId);
      showDestructiveConfirm = true;
      return;
    }

    proceedWithExecute(query, activeTabId);
  }

  function handleExecuteCurrent() {
    const activeTab = ctx.getActiveTab();
    const activeTabId = ctx.getActiveTabId();
    if (!activeTabId || !activeTab) return;

    syncVisualBuilder();

    const query = activeTab.query;
    const cursorOffset = ctx.getMonacoRef()?.getCursorOffset() ?? 0;
    const dbType = db.state.activeConnection?.type ?? "postgres";

    const currentStatement = getStatementAtOffset(query, cursorOffset, dbType);
    if (currentStatement) {
      const reason = isDestructiveStatement(currentStatement.sql);
      if (reason) {
        destructiveStatements = [
          { sql: currentStatement.sql, index: currentStatement.index, reason },
        ];
        pendingDestructiveAction = () =>
          proceedWithExecuteCurrent(query, activeTabId, cursorOffset, dbType);
        showDestructiveConfirm = true;
        return;
      }
    }

    proceedWithExecuteCurrent(query, activeTabId, cursorOffset, dbType);
  }

  function handleDestructiveConfirm() {
    showDestructiveConfirm = false;
    pendingDestructiveAction?.();
    pendingDestructiveAction = null;
    destructiveStatements = [];
  }

  function handleParamExecute(values: ParameterValue[]) {
    const activeTabId = ctx.getActiveTabId();
    const resultKey = ctx.getResultKey();
    if (!activeTabId) return;

    const action = paramDialog.action;

    if (action === "query") {
      void db.queries.executeWithParams(activeTabId, values);
    } else if (action && typeof action === "object" && action.type === "query-current") {
      void db.queries.executeCurrentWithParams(activeTabId, action.cursorOffset, values);
    } else if (action && typeof action === "object" && action.type === "explain") {
      void db.explainTabs.executeEmbeddedWithParams(
        activeTabId,
        values,
        action.analyze,
        action.cursorOffset,
      );
      if (resultKey) {
        return { switchViewMode: "explain" as const };
      }
    } else if (action && typeof action === "object" && action.type === "visualize") {
      const success = db.visualizeTabs.visualizeEmbeddedWithParams(
        activeTabId,
        values,
        action.cursorOffset,
      );
      if (success && resultKey) {
        return { switchViewMode: "visualize" as const };
      }
    }

    paramDialog.action = null;
    return undefined;
  }

  function handleParamCancel() {
    paramDialog.action = null;
  }

  return {
    get showDestructiveConfirm() {
      return showDestructiveConfirm;
    },
    set showDestructiveConfirm(v: boolean) {
      showDestructiveConfirm = v;
    },
    get destructiveStatements() {
      return destructiveStatements;
    },

    handleExecute,
    handleExecuteCurrent,
    handleDestructiveConfirm,
    handleParamExecute,
    handleParamCancel,
  };
}

export type Execution = ReturnType<typeof createExecution>;
