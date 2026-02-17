import { NextResponse } from "next/server";
import { z } from "zod";

import { buildLineageChain } from "../../../../../src/server/provenance/engine";
import { dbGetAiOutput } from "../../../../../src/server/ai-outputs/store";
import {
  lineageGetParents,
  lineageGetChildren,
} from "../../../../../src/server/lineage/store";
import { lineageAddEdge } from "../../../../../src/server/lineage/store";

export const runtime = "nodejs";

const ParamsZ = z.object({
  outputId: z.string().min(1),
});

async function unwrapParams(ctx: { params?: any }) {
  const p = ctx?.params;
  return p && typeof p.then === "function" ? await p : p;
}

function asInt(v: string | null, def: number) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

type GraphNode = {
  id: string;
  moodboardId?: string;
  kind?: string;
  version?: string;
  createdAt?: string;
  contentFingerprint?: string;
  exportFingerprint?: string;
  reusedFromOutputId?: string;
};

type GraphEdge = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  reason?: string;
  meta?: any;
};

export async function GET(req: Request, ctx: { params?: any }) {
  const params = ParamsZ.parse(await unwrapParams(ctx));
  const url = new URL(req.url);

  // depth=0: solo root
  // depth=1: root + vecinos directos
  // depth=2: default recomendado
  const depth = asInt(url.searchParams.get("depth"), 2);

  const outputId = String(params.outputId).trim();

  // ===== Legacy chain (mantener compatibilidad) =====
  let chain: any[] = [];
  let integrity = true;
  const errors: Record<string, string> = {};

  try {
    chain = await buildLineageChain(outputId);
  } catch (e: any) {
    integrity = false;
    errors["chain"] = String(e?.message ?? e);
  }

  // ---- Backfill lineage edges from legacy chain (Sprint K) ----
  try {
    const hasAnyEdges =
      (await lineageGetParents(outputId)).length > 0 ||
      (await lineageGetChildren(outputId)).length > 0;

    // Solo backfill si NO hay edges aún y el chain legacy tiene sentido
    if (!hasAnyEdges && Array.isArray(chain) && chain.length > 1) {
      for (const n of chain) {
        const childId = String(n.outputId ?? "");
        const parentId = n.parentOutputId ? String(n.parentOutputId) : "";
        if (!childId || !parentId) continue;

        await lineageAddEdge({
          fromId: childId,
          toId: parentId,
          type: "DERIVED_FROM",
          reason: "Backfilled from legacy parentOutputId chain",
          actor: "SYSTEM",
          route: "api/outputs/[outputId]/lineage",
        });
      }
    }
  } catch (e: any) {
    // No rompemos el endpoint por backfill
    integrity = false;
    errors["backfill"] = String(e?.message ?? e);
  }

  // ===== Graph lineage (Sprint K) =====
  const root = await dbGetAiOutput(outputId);
  if (!root) {
    return NextResponse.json(
      { ok: false, outputId, error: "OUTPUT_NOT_FOUND" },
      { status: 404 },
    );
  }

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (o: any) => {
    if (!o?.id) return;
    const id = String(o.id);
    if (nodes.has(id)) return;

    nodes.set(id, {
      id,
      moodboardId: o.moodboardId ? String(o.moodboardId) : undefined,
      kind: o.kind ? String(o.kind) : undefined,
      version: o.version ? String(o.version) : undefined,
      createdAt: o.createdAt ? String(o.createdAt) : undefined,
      contentFingerprint: o.contentFingerprint
        ? String(o.contentFingerprint)
        : undefined,
      exportFingerprint: o.exportFingerprint
        ? String(o.exportFingerprint)
        : undefined,
      reusedFromOutputId: o.reusedFromOutputId
        ? String(o.reusedFromOutputId)
        : undefined,
    });
  };

  const addEdge = (e: any) => {
    if (!e?.id) return;
    const id = String(e.id);
    if (edges.has(id)) return;

    edges.set(id, {
      id,
      fromId: String(e.fromId),
      toId: String(e.toId),
      type: String(e.type),
      reason: e.reason ? String(e.reason) : undefined,
      meta: e.meta ?? undefined,
    });
  };

  addNode(root);

  // BFS sobre parents + children hasta depth
  const queue: Array<{ id: string; d: number }> = [
    { id: String(root.id), d: 0 },
  ];
  const seen = new Set<string>([String(root.id)]);

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.d >= depth) continue;

    let parentEdges: any[] = [];
    let childEdges: any[] = [];

    try {
      parentEdges = await lineageGetParents(cur.id);
    } catch (e: any) {
      integrity = false;
      errors["parents"] = String(e?.message ?? e);
    }

    try {
      childEdges = await lineageGetChildren(cur.id);
    } catch (e: any) {
      integrity = false;
      errors["children"] = String(e?.message ?? e);
    }

    for (const e of [...parentEdges, ...childEdges]) {
      addEdge(e);

      const aId = String(e.fromId);
      const bId = String(e.toId);

      if (!nodes.has(aId)) {
        const a = await dbGetAiOutput(aId);
        if (a) addNode(a);
      }
      if (!nodes.has(bId)) {
        const b = await dbGetAiOutput(bId);
        if (b) addNode(b);
      }

      for (const nid of [aId, bId]) {
        if (!seen.has(nid)) {
          seen.add(nid);
          queue.push({ id: nid, d: cur.d + 1 });
        }
      }
    }
  }

  // parents/children inmediatos del root
  const parentsImmediate = (await lineageGetParents(String(root.id))).map(
    (e: any) => String(e.toId),
  );
  const childrenImmediate = (await lineageGetChildren(String(root.id))).map(
    (e: any) => String(e.fromId),
  );

  return NextResponse.json({
    ok: true,
    outputId,

    // legacy fields
    integrity,
    chain: chain.map((n: any) => ({
      outputId: String(n.outputId ?? n.id ?? ""),
      parentOutputId: n.parentOutputId ? String(n.parentOutputId) : undefined,
      kind: String(n.kind ?? "UNKNOWN"),
      version: String(n.version ?? "0.0.0"),
      createdAt: String(n.createdAt ?? ""),
    })),
    errors,

    // Sprint K addition
    graph: {
      depth,
      rootId: String(root.id),
      parents: parentsImmediate,
      children: childrenImmediate,
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    },
  });
}
