/**
 * Shared helpers for adapter-side EXPLAIN parsing.
 * Each adapter produces ExplainPlanNode trees directly; these utilities
 * keep node-id generation consistent.
 */

/**
 * Create a monotonic node-id generator scoped to a single parse invocation.
 * Usage: `const nextId = makeNodeIdFactory(); const id = nextId();`
 */
export function makeNodeIdFactory(): () => string {
  let counter = 0;
  return () => `node-${counter++}`;
}
