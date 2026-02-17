// apps/web/src/server/lineage/store.ts
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { LineageEdge, LineageEdgeType } from "./types";

function nowIso() {
  return new Date().toISOString();
}

async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encuentra repo root caminando hacia arriba buscando turbo.json / pnpm-workspace.yaml / .git
 * Esto evita bugs de cwd dentro de apps/web.
 */
export async function findRepoRoot(fromDir = process.cwd()): Promise<string> {
  let cur = fromDir;
  for (let i = 0; i < 12; i++) {
    const turbo = path.join(cur, "turbo.json");
    const pnpmWs = path.join(cur, "pnpm-workspace.yaml");
    const git = path.join(cur, ".git");
    if (
      (await pathExists(turbo)) ||
      (await pathExists(pnpmWs)) ||
      (await pathExists(git))
    )
      return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // fallback
  return fromDir;
}

export async function dataDir(): Promise<string> {
  // Permite override por env si lo necesitas
  const override = process.env.INNOVA_DATA_DIR;
  if (override) return override;

  const root = await findRepoRoot();
  return path.join(root, "data");
}

function randId(): string {
  return crypto.randomUUID();
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

type EdgeIndex = {
  byFrom: Record<string, string[]>; // fromId -> edgeIds
  byTo: Record<string, string[]>; // toId   -> edgeIds
};

async function edgesBaseDir() {
  const dd = await dataDir();
  return {
    dir: path.join(dd, "lineage", "edges"),
    indexPath: path.join(dd, "lineage", "edges", "index.json"),
  };
}

async function readIndexSafe(indexPath: string): Promise<EdgeIndex> {
  try {
    const raw = await fs.readFile(indexPath, "utf-8");
    const json = JSON.parse(raw);
    return {
      byFrom: json?.byFrom ?? {},
      byTo: json?.byTo ?? {},
    };
  } catch {
    return { byFrom: {}, byTo: {} };
  }
}

async function writeIndex(indexPath: string, idx: EdgeIndex) {
  await fs.writeFile(indexPath, JSON.stringify(idx, null, 2), "utf-8");
}

export async function lineageAddEdge(args: {
  fromId: string;
  toId: string;
  type: LineageEdgeType;
  reason?: string;
  actor?: "SYSTEM" | "USER" | "API";
  route?: string;
}): Promise<LineageEdge> {
  const base = await edgesBaseDir();
  await ensureDir(base.dir);

  // ---- DEDUPE: evitar edges duplicados (fromId + toId + type) ----
  try {
    const idx = await readIndexSafe(base.indexPath);
    const existingEdgeIds = idx.byFrom[args.fromId] ?? [];

    for (const edgeId of existingEdgeIds) {
      try {
        const raw = await fs.readFile(
          path.join(base.dir, `${edgeId}.json`),
          "utf-8",
        );
        const existing = JSON.parse(raw) as LineageEdge;

        if (
          existing.fromId === args.fromId &&
          existing.toId === args.toId &&
          existing.type === args.type
        ) {
          // Edge ya existe → no duplicar
          return existing;
        }
      } catch {
        // ignorar edge corrupto / borrado
      }
    }
  } catch {
    // si el index falla, no bloqueamos la creación
  }

  const id = randId();
  const edge: LineageEdge = {
    id,
    fromId: args.fromId,
    toId: args.toId,
    type: args.type,
    reason: args.reason,
    meta: {
      createdAt: nowIso(),
      actor: args.actor ?? "SYSTEM",
      route: args.route,
    },
  };

  const edgePath = path.join(base.dir, `${id}.json`);
  await fs.writeFile(edgePath, JSON.stringify(edge, null, 2), "utf-8");

  const idx = await readIndexSafe(base.indexPath);
  idx.byFrom[edge.fromId] = Array.from(
    new Set([...(idx.byFrom[edge.fromId] ?? []), id]),
  );
  idx.byTo[edge.toId] = Array.from(
    new Set([...(idx.byTo[edge.toId] ?? []), id]),
  );
  await writeIndex(base.indexPath, idx);

  return edge;
}

export async function lineageGetParents(
  outputId: string,
): Promise<LineageEdge[]> {
  const base = await edgesBaseDir();
  const idx = await readIndexSafe(base.indexPath);
  const edgeIds = idx.byFrom[outputId] ?? [];
  const edges: LineageEdge[] = [];

  for (const id of edgeIds) {
    try {
      const raw = await fs.readFile(path.join(base.dir, `${id}.json`), "utf-8");
      edges.push(JSON.parse(raw));
    } catch {}
  }

  // parents = edges where fromId == outputId, so toId is parent
  return edges;
}

export async function lineageGetChildren(
  outputId: string,
): Promise<LineageEdge[]> {
  const base = await edgesBaseDir();
  const idx = await readIndexSafe(base.indexPath);
  const edgeIds = idx.byTo[outputId] ?? [];
  const edges: LineageEdge[] = [];

  for (const id of edgeIds) {
    try {
      const raw = await fs.readFile(path.join(base.dir, `${id}.json`), "utf-8");
      edges.push(JSON.parse(raw));
    } catch {}
  }

  // children = edges where toId == outputId, so fromId is child
  return edges;
}
