"use client";

import { useEffect, useMemo, useState } from "react";

type OutputKind = string;

export type OutputListItem = {
  id: string;
  moodboardId: string;
  version: string;
  kind: OutputKind;
  createdAt?: string;
  provider?: string;
  model?: string;
  parentOutputId?: string | null;
};

export type OutputDetail = OutputListItem & {
  diffFromParentJson?: unknown;
  outputJson?: unknown;
};

type Props = {
  moodboardId: string;

  // “View” debe cargar el output actual en tu UI existente
  onViewOutput: (outputId: string) => void;

  // “Refine from selected” debe disparar el refine usando baseOutputId elegido
  onRefineFromBase: (baseOutputId: string) => void;
};

// --- util: formatting ---
function fmtDate(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// --- util: small JSON diff (no deps) ---
// returns a flat list of changes: {path, type, before, after}
type DiffRow = {
  path: string;
  type: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepDiff(base: unknown, cur: unknown, path = ""): DiffRow[] {
  // identical
  if (Object.is(base, cur)) return [];

  // if primitives or different types -> changed
  const baseObj = isPlainObject(base);
  const curObj = isPlainObject(cur);

  const baseArr = Array.isArray(base);
  const curArr = Array.isArray(cur);

  if (
    (!baseObj && !baseArr) ||
    (!curObj && !curArr) ||
    baseArr !== curArr ||
    baseObj !== curObj
  ) {
    return [
      {
        path: path || "$",
        type: "changed",
        before: base,
        after: cur,
      },
    ];
  }

  // arrays: compare by index (simple)
  if (baseArr && curArr) {
    const max = Math.max(base.length, cur.length);
    const out: DiffRow[] = [];
    for (let i = 0; i < max; i++) {
      const p = `${path || "$"}[${i}]`;
      if (i >= base.length) {
        out.push({ path: p, type: "added", after: cur[i] });
      } else if (i >= cur.length) {
        out.push({ path: p, type: "removed", before: base[i] });
      } else {
        out.push(...deepDiff(base[i], cur[i], p));
      }
    }
    return out;
  }

  // objects: union keys
  const b = base as Record<string, unknown>;
  const c = cur as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(c)]);
  const out: DiffRow[] = [];

  for (const k of keys) {
    const p = path ? `${path}.${k}` : `$.${k}`;
    if (!(k in b)) {
      out.push({ path: p, type: "added", after: c[k] });
    } else if (!(k in c)) {
      out.push({ path: p, type: "removed", before: b[k] });
    } else {
      out.push(...deepDiff(b[k], c[k], p));
    }
  }

  return out;
}

async function fetchOutputs(moodboardId: string): Promise<OutputListItem[]> {
  const res = await fetch(`/api/moodboards/${moodboardId}/outputs`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load outputs (${res.status})`);
  const data = await res.json();

  // tolerante a shapes: {outputs:[...]} o [...]
  const list = Array.isArray(data) ? data : data.outputs;
  return (list ?? []) as OutputListItem[];
}

async function fetchOutputDetail(outputId: string): Promise<OutputDetail> {
  const res = await fetch(`/api/outputs/${outputId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load output detail (${res.status})`);
  const data = await res.json();

  // tolerante a shapes: {output:{...}} o {...}
  return ((data?.output ?? data) as OutputDetail) ?? ({} as OutputDetail);
}

export default function VersionHistoryPanel({
  moodboardId,
  onViewOutput,
  onRefineFromBase,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [items, setItems] = useState<OutputListItem[]>([]);

  // Compare UI state
  const [baseId, setBaseId] = useState<string>("");
  const [curId, setCurId] = useState<string>("");

  const [baseDetail, setBaseDetail] = useState<OutputDetail | null>(null);
  const [curDetail, setCurDetail] = useState<OutputDetail | null>(null);

  const [compareMode, setCompareMode] = useState<"parentDiff" | "recomputed">(
    "parentDiff",
  );

  const curItem = useMemo(
    () => items.find((x) => x.id === curId) ?? null,
    [items, curId],
  );

  const shouldRecompute = useMemo(() => {
    // recompute only makes sense if we have both details AND current has outputJson
    // and base != current.parent
    const parentId = curItem?.parentOutputId ?? null;
    return (
      compareMode === "recomputed" &&
      !!baseDetail?.outputJson &&
      !!curDetail?.outputJson &&
      !!baseId &&
      !!curId &&
      baseId !== parentId
    );
  }, [compareMode, baseDetail, curDetail, baseId, curId, curItem]);

  const recomputedDiffRows: DiffRow[] = useMemo(() => {
    if (!shouldRecompute) return [];
    return deepDiff(baseDetail?.outputJson, curDetail?.outputJson);
  }, [shouldRecompute, baseDetail, curDetail]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);

    fetchOutputs(moodboardId)
      .then((list) => {
        if (!alive) return;
        // orden: más reciente arriba (createdAt desc si existe)
        const sorted = [...list].sort((a, b) => {
          const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
          const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
          return tb - ta;
        });
        setItems(sorted);

        // defaults: current = latest, base = parent of latest si existe
        const latest = sorted[0];
        if (latest?.id) {
          setCurId(latest.id);
          const parent = latest.parentOutputId ?? "";
          if (parent) setBaseId(parent);
          else if (sorted[1]?.id) setBaseId(sorted[1].id);
        }
      })
      .catch((e) => alive && setErr(e?.message ?? String(e)))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [moodboardId]);

  useEffect(() => {
    let alive = true;
    if (!baseId) {
      setBaseDetail(null);
      return;
    }
    fetchOutputDetail(baseId)
      .then((d) => alive && setBaseDetail(d))
      .catch(() => alive && setBaseDetail(null));
    return () => {
      alive = false;
    };
  }, [baseId]);

  useEffect(() => {
    let alive = true;
    if (!curId) {
      setCurDetail(null);
      return;
    }
    fetchOutputDetail(curId)
      .then((d) => alive && setCurDetail(d))
      .catch(() => alive && setCurDetail(null));
    return () => {
      alive = false;
    };
  }, [curId]);

  return (
    <div className="w-full rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Version History</div>
          <div className="text-sm text-neutral-600">
            Historial de outputs del moodboard y comparación visual de diffs
          </div>
        </div>

        <button
          type="button"
          className="rounded-lg border px-3 py-2 text-sm hover:bg-neutral-50"
          onClick={() => {
            setLoading(true);
            setErr(null);
            fetchOutputs(moodboardId)
              .then((list) => {
                const sorted = [...list].sort((a, b) => {
                  const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
                  const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
                  return tb - ta;
                });
                setItems(sorted);
              })
              .catch((e) => setErr(e?.message ?? String(e)))
              .finally(() => setLoading(false));
          }}
        >
          Refresh
        </button>
      </div>

      {err ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-lg border">
        <table className="min-w-[900px] w-full text-left text-sm">
          <thead className="bg-neutral-50">
            <tr className="text-neutral-700">
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Provider</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-neutral-600" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : null}

            {items.map((x) => (
              <tr key={x.id} className="border-t">
                <td className="px-3 py-2 font-medium">{x.version}</td>
                <td className="px-3 py-2">{x.kind}</td>
                <td className="px-3 py-2 text-neutral-700">
                  {fmtDate(x.createdAt)}
                </td>
                <td className="px-3 py-2">{x.provider ?? ""}</td>
                <td className="px-3 py-2">{x.model ?? ""}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-md border px-2 py-1 hover:bg-neutral-50"
                      onClick={() => onViewOutput(x.id)}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="rounded-md border px-2 py-1 hover:bg-neutral-50"
                      onClick={() => {
                        // compare quick action: base = parent (si existe) y current = this
                        setCurId(x.id);
                        setBaseId(x.parentOutputId ?? "");
                      }}
                    >
                      Compare
                    </button>
                    <button
                      type="button"
                      className="rounded-md border px-2 py-1 hover:bg-neutral-50"
                      onClick={() => onRefineFromBase(x.id)}
                    >
                      Refine from this
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && items.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-neutral-600" colSpan={6}>
                  No outputs yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Compare UI */}
      <div className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">Compare & Diff</div>
            <div className="text-sm text-neutral-600">
              Selecciona un Base Output y un Current Output.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`rounded-lg border px-3 py-2 text-sm ${
                compareMode === "parentDiff" ? "bg-white" : "hover:bg-white"
              }`}
              onClick={() => setCompareMode("parentDiff")}
              title="Muestra diffFromParentJson (tal como lo trae el output)"
            >
              diffFromParentJson
            </button>
            <button
              type="button"
              className={`rounded-lg border px-3 py-2 text-sm ${
                compareMode === "recomputed" ? "bg-white" : "hover:bg-white"
              }`}
              onClick={() => setCompareMode("recomputed")}
              title="Recalcula diff base vs current (solo si base != parent)"
            >
              diff recomputed
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-neutral-700">
              Base Output
            </div>
            <select
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              value={baseId}
              onChange={(e) => setBaseId(e.target.value)}
            >
              <option value="">(none)</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.version} — {x.kind} — {fmtDate(x.createdAt)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-neutral-700">
              Current Output
            </div>
            <select
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              value={curId}
              onChange={(e) => setCurId(e.target.value)}
            >
              <option value="">(none)</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.version} — {x.kind} — {fmtDate(x.createdAt)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
            disabled={!curId}
            onClick={() => curId && onViewOutput(curId)}
          >
            View current
          </button>

          <button
            type="button"
            className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
            disabled={!baseId}
            onClick={() => baseId && onViewOutput(baseId)}
          >
            View base
          </button>

          <button
            type="button"
            className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
            disabled={!baseId}
            onClick={() => baseId && onRefineFromBase(baseId)}
            title="Refine usando baseOutputId = Base Output seleccionado"
          >
            Refine from selected base
          </button>
        </div>

        {/* Diff viewer */}
        <div className="mt-4 rounded-lg border bg-white p-3">
          {compareMode === "parentDiff" ? (
            <>
              <div className="mb-2 text-xs font-semibold text-neutral-700">
                diffFromParentJson (del Current Output)
              </div>
              <pre className="max-h-[320px] overflow-auto rounded-md bg-neutral-50 p-3 text-xs">
                {JSON.stringify(curDetail?.diffFromParentJson ?? null, null, 2)}
              </pre>

              {baseId &&
              curItem?.parentOutputId &&
              baseId !== curItem.parentOutputId ? (
                <div className="mt-2 text-xs text-amber-700">
                  Nota: Base seleccionado ≠ parent del current. Si quieres ver
                  diff base vs current, usa “diff recomputed”.
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="mb-2 text-xs font-semibold text-neutral-700">
                diff recomputed (Base outputJson vs Current outputJson)
              </div>

              {!baseId || !curId ? (
                <div className="text-sm text-neutral-600">
                  Selecciona Base y Current.
                </div>
              ) : shouldRecompute ? (
                recomputedDiffRows.length === 0 ? (
                  <div className="text-sm text-neutral-600">No changes.</div>
                ) : (
                  <div className="max-h-[320px] overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="text-neutral-700">
                          <th className="py-2 pr-2 text-left">Path</th>
                          <th className="py-2 pr-2 text-left">Type</th>
                          <th className="py-2 pr-2 text-left">Before</th>
                          <th className="py-2 text-left">After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recomputedDiffRows.slice(0, 500).map((r, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="py-2 pr-2 font-mono">{r.path}</td>
                            <td className="py-2 pr-2">{r.type}</td>
                            <td className="py-2 pr-2">
                              <span className="font-mono">
                                {r.before === undefined
                                  ? ""
                                  : JSON.stringify(r.before)}
                              </span>
                            </td>
                            <td className="py-2">
                              <span className="font-mono">
                                {r.after === undefined
                                  ? ""
                                  : JSON.stringify(r.after)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {recomputedDiffRows.length > 500 ? (
                      <div className="mt-2 text-xs text-neutral-600">
                        Mostrando 500 cambios (limite UI).
                      </div>
                    ) : null}
                  </div>
                )
              ) : (
                <div className="text-sm text-neutral-600">
                  Para recomputar, se requiere que:
                  <ul className="mt-2 list-disc pl-5 text-xs text-neutral-600">
                    <li>
                      Base y Current tengan <code>outputJson</code>
                    </li>
                    <li>
                      Base seleccionado sea distinto al{" "}
                      <code>parentOutputId</code> del Current
                    </li>
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
