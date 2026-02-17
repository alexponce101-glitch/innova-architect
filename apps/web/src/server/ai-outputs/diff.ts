// apps/web/src/server/ai-outputs/diff.ts
export type JsonDiff = {
  addedKeys: string[];
  removedKeys: string[];
  modifiedKeys: string[];
  unchangedKeys: string[];
};

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

export function diffJson(prev: unknown, next: unknown): JsonDiff {
  if (!isPlainObject(prev) || !isPlainObject(next)) {
    // fallback simple
    const same = JSON.stringify(prev) === JSON.stringify(next);
    return {
      addedKeys: same ? [] : ["(non-object)"],
      removedKeys: [],
      modifiedKeys: same ? [] : ["(non-object)"],
      unchangedKeys: same ? ["(non-object)"] : [],
    };
  }

  const prevKeys = new Set(Object.keys(prev));
  const nextKeys = new Set(Object.keys(next));

  const addedKeys: string[] = [];
  const removedKeys: string[] = [];
  const modifiedKeys: string[] = [];
  const unchangedKeys: string[] = [];

  for (const k of nextKeys) {
    if (!prevKeys.has(k)) addedKeys.push(k);
    else {
      const a = (prev as any)[k];
      const b = (next as any)[k];
      const same = JSON.stringify(a) === JSON.stringify(b);
      (same ? unchangedKeys : modifiedKeys).push(k);
    }
  }

  for (const k of prevKeys) {
    if (!nextKeys.has(k)) removedKeys.push(k);
  }

  return { addedKeys, removedKeys, modifiedKeys, unchangedKeys };
}
