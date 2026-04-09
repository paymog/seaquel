import { toast } from "svelte-sonner";
import { errorToast } from "$lib/utils/toast";
import { m } from "$lib/paraglide/messages.js";
import {
  copyCell as clipboardCopyCell,
  copyRowAsJSON as clipboardCopyRowAsJSON,
  copyColumn as clipboardCopyColumn,
} from "$lib/utils/clipboard";
import type { QueryEditorContext } from "./types.js";

interface ContextCell {
  value: unknown;
  column: string;
  row: Record<string, unknown>;
  rowIndex: number;
}

export function createCellEditing(ctx: QueryEditorContext) {
  const { db } = ctx;

  let deletingRowIndex = $state<number | null>(null);
  let pendingDeleteRow = $state<{ index: number; row: Record<string, unknown> } | null>(null);
  let showDeleteConfirm = $state(false);
  let contextCell = $state<ContextCell | null>(null);

  async function handleCellSave(rowIndex: number, column: string, newValue: string | null) {
    const activeTabId = ctx.getActiveTabId();
    const activeResult = ctx.getActiveResult();
    const activeResultIndex = ctx.getActiveResultIndex();
    if (!activeTabId || !activeResult?.sourceTable) return;

    const result = await db.queries.updateCell(
      activeTabId,
      activeResultIndex,
      rowIndex,
      column,
      newValue,
      activeResult.sourceTable,
    );

    if (result.success) {
      if (result.queued) {
        toast.info("Change added to pending changes");
      } else {
        toast.success(m.query_cell_updated());
      }
    } else {
      errorToast(m.query_cell_update_failed({ error: result.error || "" }));
    }
  }

  function confirmDeleteRow(rowIndex: number, row: Record<string, unknown>) {
    pendingDeleteRow = { index: rowIndex, row };
    showDeleteConfirm = true;
  }

  async function handleDeleteRow() {
    const activeTabId = ctx.getActiveTabId();
    const activeResult = ctx.getActiveResult();
    if (!pendingDeleteRow || !activeTabId || !activeResult?.sourceTable) return;

    deletingRowIndex = pendingDeleteRow.index;
    showDeleteConfirm = false;

    const result = await db.queries.deleteRow(activeResult.sourceTable, pendingDeleteRow.row);

    if (result.success) {
      if (result.queued) {
        toast.info("Delete added to pending changes");
      } else {
        toast.success(m.query_row_deleted());
        await db.queries.execute(activeTabId);
      }
    } else {
      errorToast(m.query_row_delete_failed({ error: result.error || "" }));
    }

    deletingRowIndex = null;
    pendingDeleteRow = null;
  }

  function handleCellRightClick(
    value: unknown,
    column: string,
    row: Record<string, unknown>,
    rowIndex: number,
  ) {
    contextCell = { value, column, row, rowIndex };
  }

  async function copyCell() {
    if (!contextCell) return;
    await clipboardCopyCell(contextCell.value);
  }

  async function copyRowAsJSON() {
    if (!contextCell) return;
    await clipboardCopyRowAsJSON(contextCell.row);
  }

  async function copyColumn() {
    const activeResult = ctx.getActiveResult();
    if (!contextCell || !activeResult) return;
    await clipboardCopyColumn(contextCell.column, activeResult.rows);
  }

  async function setNull() {
    if (!contextCell) return;
    await handleCellSave(contextCell.rowIndex, contextCell.column, null);
  }

  async function setDefault() {
    const activeTabId = ctx.getActiveTabId();
    const activeResult = ctx.getActiveResult();
    const activeResultIndex = ctx.getActiveResultIndex();
    if (!contextCell || !activeTabId || !activeResult?.sourceTable) return;

    const result = await db.queries.setCellDefault(
      activeTabId,
      activeResultIndex,
      contextCell.rowIndex,
      contextCell.column,
      activeResult.sourceTable,
    );

    if (result.success) {
      if (result.queued) {
        toast.info("Change added to pending changes");
      } else {
        toast.success(m.query_cell_updated());
      }
    } else {
      errorToast(m.query_cell_update_failed({ error: result.error || "" }));
    }
  }

  return {
    get deletingRowIndex() {
      return deletingRowIndex;
    },
    get showDeleteConfirm() {
      return showDeleteConfirm;
    },
    set showDeleteConfirm(v: boolean) {
      showDeleteConfirm = v;
    },

    handleCellSave,
    confirmDeleteRow,
    handleDeleteRow,
    handleCellRightClick,
    copyCell,
    copyRowAsJSON,
    copyColumn,
    setNull,
    setDefault,
  };
}
