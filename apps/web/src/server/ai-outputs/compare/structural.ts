// apps/web/src/server/ai-outputs/compare/structural.ts
import type { JsonDiff } from "./types";

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function joinPath(base: string, key: string | number) {
  if (!base) return String(key);
  return `${base}.${String(key)}`;
}

function diffJson(a: unknown, b: unknown, basePath = ""): JsonDiff {
  const changedPaths: string[] = [];
  const addedPaths: string[] = [];
  const removedPaths: string[] = [];

  const walk = (va: unknown, vb: unknown, p: string) => {
    // Same reference or strict equal
    if (va === vb) return;

    const aArr = Array.isArray(va);
    const bArr = Array.isArray(vb);

    if (aArr && bArr) {
      const len = Math.max((va as unknown[]).length, (vb as unknown[]).length);
      for (let i = 0; i < len; i++) {
        const hasA = i < (va as unknown[]).length;
        const hasB = i < (vb as unknown[]).length;
        const np = joinPath(p, i);

        if (!hasA && hasB) {
          addedPaths.push(np);
          continue;
        }
        if (hasA && !hasB) {
          removedPaths.push(np);
          continue;
        }
        walk((va as unknown[])[i], (vb as unknown[])[i], np);
      }
      return;
    }

    if (isObject(va) && isObject(vb)) {
      const keys = new Set([...Object.keys(va), ...Object.keys(vb)]);
      for (const k of keys) {
        const hasA = Object.prototype.hasOwnProperty.call(va, k);
        const hasB = Object.prototype.hasOwnProperty.call(vb, k);
        const np = joinPath(p, k);

        if (!hasA && hasB) {
          addedPaths.push(np);
          continue;
        }
        if (hasA && !hasB) {
          removedPaths.push(np);
          continue;
        }
        walk((va as any)[k], (vb as any)[k], np);
      }
      return;
    }

    // Primitive change or different types
    changedPaths.push(p || "<root>");
  };

  walk(a, b, basePath);

  return {
    changedPaths,
    addedPaths,
    removedPaths,
    changedCount: changedPaths.length,
    addedCount: addedPaths.length,
    removedCount: removedPaths.length,
  };
}

/**
 * Returns a cheap "changed/unchanged keys" view + optional deep json diff.
 * - "changed" / "unchanged" is computed at top-level keys for UX friendliness.
 */
export function structuralCompare(
  aJson: unknown,
  bJson: unknown,
): { changed: string[]; unchanged: string[]; json: JsonDiff } {
  const json = diffJson(aJson, bJson, "");

  // top-level keys (friendly lists)
  const topChanged = new Set<string>();
  const topAdded = new Set<string>();
  const topRemoved = new Set<string>();

  for (const p of json.changedPaths) {
    const top = p.split(".")[0];
    if (top) topChanged.add(top === "<root>" ? "<root>" : top);
  }
  for (const p of json.addedPaths) {
    const top = p.split(".")[0];
    if (top) topAdded.add(top);
  }
  for (const p of json.removedPaths) {
    const top = p.split(".")[0];
    if (top) topRemoved.add(top);
  }

  const changed = Array.from(
    new Set([...topChanged, ...topAdded, ...topRemoved]),
  ).sort();

  // unchanged = common keys that are NOT in changed (best-effort)
  const aKeys = isObject(aJson) ? Object.keys(aJson) : [];
  const bKeys = isObject(bJson) ? Object.keys(bJson) : [];
  const common = new Set(aKeys.filter((k) => bKeys.includes(k)));
  const unchanged = Array.from(common)
    .filter((k) => !changed.includes(k))
    .sort();

  return { changed, unchanged, json };
}
