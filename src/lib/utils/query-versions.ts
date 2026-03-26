import DiffMatchPatch from "diff-match-patch";
import type { QueryVersion, ResolvedQueryVersion } from "$lib/types";

const dmp = new DiffMatchPatch();
const SNAPSHOT_INTERVAL = 10;

/**
 * Whether a given version number should store a full snapshot (keyframe).
 * Version 1 is always a keyframe, then every SNAPSHOT_INTERVAL versions after that.
 */
export function isKeyframe(version: number): boolean {
  return version === 1 || (version - 1) % SNAPSHOT_INTERVAL === 0;
}

/**
 * Create a new QueryVersion entry, automatically choosing between
 * a keyframe (full snapshot) and a delta (diff patch).
 */
export function createVersionEntry(
  queryId: string,
  version: number,
  queryText: string,
  previousVersionQuery?: string,
): QueryVersion {
  const isSnap = isKeyframe(version);
  if (!isSnap && previousVersionQuery === undefined) {
    throw new Error(`previousVersionQuery is required for delta version ${version}`);
  }
  return {
    id: `ver-${crypto.randomUUID()}`,
    queryId,
    version,
    snapshot: isSnap ? queryText : null,
    diff: isSnap ? null : patchToText(previousVersionQuery!, queryText),
    createdAt: new Date(),
  };
}

function patchToText(oldText: string, newText: string): string {
  const patches = dmp.patch_make(oldText, newText);
  return dmp.patch_toText(patches);
}

/**
 * Reconstruct full query text for each version by replaying snapshots and diffs.
 * Input versions are sorted by version number; output preserves that order.
 */
export function resolveVersions(versions: QueryVersion[]): ResolvedQueryVersion[] {
  const sorted = [...versions].sort((a, b) => a.version - b.version);
  const resolved: ResolvedQueryVersion[] = [];
  let currentText = "";

  for (const v of sorted) {
    if (v.snapshot !== null) {
      currentText = v.snapshot;
    } else if (v.diff !== null) {
      const patches = dmp.patch_fromText(v.diff);
      const [result, success] = dmp.patch_apply(patches, currentText);
      if (!success.every(Boolean)) {
        console.warn(
          `[query-versions] Patch partially failed for version ${v.version} of query ${v.queryId}`,
        );
      }
      currentText = result;
    }
    resolved.push({
      id: v.id,
      queryId: v.queryId,
      version: v.version,
      query: currentText,
      createdAt: v.createdAt,
    });
  }

  return resolved;
}
