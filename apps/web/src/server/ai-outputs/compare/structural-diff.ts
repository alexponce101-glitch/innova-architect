// apps/web/src/server/ai-outputs/compare/structural-diff.ts

function isObject(x: any) {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

function joinPath(base: string, key: string | number) {
  const k = typeof key === "number" ? String(key) : key;
  return base ? `${base}.${k}` : k;
}

/**
 * Devuelve paths en formato dot:
 * - changedPaths: existe en ambos pero diferente
 * - addedPaths: existe sólo en B
 * - removedPaths: existe sólo en A
 */
export function diffJsonPaths(a: any, b: any) {
  const changedPaths: string[] = [];
  const addedPaths: string[] = [];
  const removedPaths: string[] = [];

  function walk(av: any, bv: any, path: string) {
    // mismos (incluye NaN edge si quieres, pero aquí simple)
    if (Object.is(av, bv)) return;

    // si uno es undefined → added/removed
    if (av === undefined && bv !== undefined) {
      addedPaths.push(path || "(root)");
      return;
    }
    if (av !== undefined && bv === undefined) {
      removedPaths.push(path || "(root)");
      return;
    }

    const aArr = Array.isArray(av);
    const bArr = Array.isArray(bv);

    // arrays
    if (aArr || bArr) {
      if (!aArr || !bArr) {
        changedPaths.push(path || "(root)");
        return;
      }

      const max = Math.max(av.length, bv.length);
      for (let i = 0; i < max; i++) {
        walk(av[i], bv[i], joinPath(path, i));
      }
      return;
    }

    // objects
    const aObj = isObject(av);
    const bObj = isObject(bv);
    if (aObj || bObj) {
      if (!aObj || !bObj) {
        changedPaths.push(path || "(root)");
        return;
      }

      const keys = new Set<string>([
        ...Object.keys(av ?? {}),
        ...Object.keys(bv ?? {}),
      ]);

      for (const k of keys) {
        walk(av?.[k], bv?.[k], joinPath(path, k));
      }
      return;
    }

    // scalars diferentes
    changedPaths.push(path || "(root)");
  }

  // root
  walk(a, b, "");

  // limpia "(root)" si te estorba: puedes quitarlo o dejarlo
  const clean = (xs: string[]) =>
    xs
      .filter(Boolean)
      .map((p) => (p === "(root)" ? "" : p))
      .filter((p) => p !== "(root)");

  const changed = clean(changedPaths);
  const added = clean(addedPaths);
  const removed = clean(removedPaths);

  return {
    changedPaths: changed,
    addedPaths: added,
    removedPaths: removed,
    changedCount: changed.length,
    addedCount: added.length,
    removedCount: removed.length,
  };
}
