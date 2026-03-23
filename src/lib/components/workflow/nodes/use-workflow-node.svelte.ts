import { useDatabase } from "$lib/hooks/database.svelte.js";

/**
 * Shared logic for all workflow node types.
 * Provides common handlers for node removal and resizing.
 *
 * Accepts a getter to read `id` reactively and avoid the
 * `state_referenced_locally` warning from Svelte 5.
 */
export function useWorkflowNode(getId: () => string) {
  const db = useDatabase();

  function handleRemove() {
    db.workflow.removeNode(getId());
  }

  function handleResizeEnd(_event: unknown, params: { width: number; height: number }) {
    db.workflow.updateNodeDimensions(getId(), params.width, params.height);
  }

  return {
    db,
    handleRemove,
    handleResizeEnd,
  };
}
