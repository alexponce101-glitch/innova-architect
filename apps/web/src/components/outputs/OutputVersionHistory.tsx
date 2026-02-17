"use client";

import React, { useMemo, useState } from "react";
import { useOutputLineage } from "./useOutputLineage";

type Props = {
  outputId: string;
  depth?: number; // para graph (default 2)
  title?: string;
  onCompare?: (aId: string, bId: string) => void; // hook para Sprint K compare
};

type TimelineItem = {
  id: string;
  parentId?: string;
  kind: string;
  version: string;
  createdAt: string;
};

function fmt(ts?: string) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function short(id?: string | null) {
  const s = typeof id === "string" ? id : String(id ?? "");
  return s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function errText(e: unknown) {
  if (!e) return "";
  if (e instanceof Error) return e.message;
  try {
    return typeof e === "string" ? e : JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      {children}
    </span>
  );
}

async function copyText(s: string) {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export default function OutputVersionHistory({
  outputId,
  depth = 2,
  title = "Version History",
  onCompare,
}: Props) {
  const { data, loading, error, refresh } = useOutputLineage(outputId, depth);
  const [mode, setMode] = useState<"timeline" | "graph">("timeline");

  const timeline: TimelineItem[] = useMemo(() => {
    const chain = data?.chain;
    if (!Array.isArray(chain) || chain.length === 0) return [];

    const items = chain
      .map((n: any) => ({
        id: String(n.outputId ?? n.id ?? ""),
        parentId: n.parentOutputId ? String(n.parentOutputId) : undefined,
        kind: String(n.kind ?? "UNKNOWN"),
        version: String(n.version ?? "0.0.0"),
        createdAt: String(n.createdAt ?? ""),
      }))
      .filter((x: any) => x.id);

    // orden estable por createdAt
    items.sort((a: TimelineItem, b: TimelineItem) =>
      String(a.createdAt).localeCompare(String(b.createdAt)),
    );

    return items;
  }, [data]);

  const rootId = data?.graph?.rootId ? String(data.graph.rootId) : outputId;

  const findPrevId = (id: string): string | null => {
    const node = timeline.find((t: TimelineItem) => t.id === id);
    return node?.parentId ?? null;
  };

  const handleComparePrev = (id: string) => {
    const prev = findPrevId(id);
    if (!prev) return;
    if (onCompare) return onCompare(prev, id);

    alert(`Compare (placeholder)\nA (prev): ${prev}\nB (current): ${id}`);
  };

  const isCurrentInTimeline = timeline.some((t) => t.id === outputId);

  return (
    <div className="rounded-2xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{title}</div>
          <div className="mt-1 text-sm opacity-70">
            Root: <span className="font-mono">{short(rootId)}</span>
            {!isCurrentInTimeline && (
              <span className="ml-2 text-xs opacity-60">
                (current output not in chain)
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className={`rounded-xl border px-3 py-1 text-sm ${
              mode === "timeline" ? "font-semibold" : "opacity-70"
            }`}
            onClick={() => setMode("timeline")}
            type="button"
          >
            Timeline
          </button>
          <button
            className={`rounded-xl border px-3 py-1 text-sm ${
              mode === "graph" ? "font-semibold" : "opacity-70"
            }`}
            onClick={() => setMode("graph")}
            type="button"
          >
            Graph
          </button>
          <button
            className="rounded-xl border px-3 py-1 text-sm opacity-80 hover:opacity-100"
            onClick={refresh}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className="mt-4 text-sm opacity-70">Loading lineage…</div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-300 p-3 text-sm">
          <div className="font-semibold">Error</div>
          <div className="mt-1 font-mono opacity-80">{errText(error)}</div>
        </div>
      )}

      {!loading && !error && mode === "timeline" && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <div className="text-sm opacity-70">
              {timeline.length} version(s)
            </div>
            <div className="text-sm opacity-70">
              Graph edges: {data?.graph?.edges?.length ?? 0}
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {timeline.map((v: TimelineItem, idx: number) => {
              const isLatest = v.id === outputId;
              const hasPrev = Boolean(v.parentId);

              return (
                <div
                  key={v.id}
                  className={`rounded-2xl border p-3 ${
                    isLatest ? "ring-1 ring-black/10" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>
                        <span className="font-mono">{v.version}</span>
                      </Badge>
                      <Badge>{v.kind}</Badge>
                      {isLatest && <Badge>CURRENT</Badge>}
                      {v.parentId && <Badge>PARENT: {short(v.parentId)}</Badge>}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-xl border px-3 py-1 text-sm opacity-80 hover:opacity-100"
                        onClick={async () => {
                          const ok = await copyText(v.id);
                          if (!ok) alert("Copy failed");
                        }}
                        type="button"
                      >
                        Copy ID
                      </button>
                      <button
                        className={`rounded-xl border px-3 py-1 text-sm ${
                          hasPrev
                            ? "opacity-80 hover:opacity-100"
                            : "opacity-40"
                        }`}
                        disabled={!hasPrev}
                        onClick={() => handleComparePrev(v.id)}
                        type="button"
                      >
                        Compare w/ prev
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 text-sm opacity-70">
                    <span className="font-mono">{short(v.id)}</span>{" "}
                    <span className="mx-2">•</span> {fmt(v.createdAt)}
                  </div>

                  {idx < timeline.length - 1 && (
                    <div className="mt-2 text-xs opacity-50">
                      ↓ derived to next
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !error && mode === "graph" && (
        <div className="mt-4">
          <div className="text-sm opacity-70">
            Nodes: {data?.graph?.nodes?.length ?? 0} • Edges:{" "}
            {data?.graph?.edges?.length ?? 0} • Depth:{" "}
            {data?.graph?.depth ?? depth}
          </div>

          <div className="mt-3 rounded-2xl border p-3">
            <div className="text-sm font-semibold">Edges</div>
            <div className="mt-2 space-y-2">
              {(data?.graph?.edges ?? []).map((e: any) => (
                <div key={e.id} className="rounded-xl border p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{String(e.type)}</Badge>
                    <span className="font-mono">{short(String(e.fromId))}</span>
                    <span className="opacity-50">→</span>
                    <span className="font-mono">{short(String(e.toId))}</span>
                  </div>
                  {e.reason && (
                    <div className="mt-1 text-xs opacity-60">
                      {String(e.reason)}
                    </div>
                  )}
                </div>
              ))}
              {!data?.graph?.edges?.length && (
                <div className="text-sm opacity-70">
                  No edges yet for this node (or depth too low). Try Refresh or
                  increase depth.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
