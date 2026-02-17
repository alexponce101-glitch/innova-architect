import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

import { OutputDigest, OutputSpec } from "../lineage/types";
import { hashObjectStable, stableStringify } from "../lineage/fingerprint";

const STORE_FILE = "ai_outputs.json";
const FP_FILE = "ai_outputs_fingerprints.json";

async function fileExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

let _resolvedStorePath: string | null = null;
let _resolvedFpPath: string | null = null;

/**
 * Resuelve la ruta real del store de ai outputs en `.data`
 * (soporta distintos cwd según cómo corres dev/build).
 */
async function resolveStorePath() {
  if (_resolvedStorePath) return _resolvedStorePath;

  const cwd = process.cwd();

  // Candidate A: when running from apps/web (pnpm --filter web dev)
  const a = path.join(cwd, ".data", STORE_FILE);

  // Candidate B: when running from repo root (turbo dev / pnpm dev at root)
  const b = path.join(cwd, "apps", "web", ".data", STORE_FILE);

  // Candidate C: when cwd is apps/web but code expects repo root-ish
  const c = path.join(cwd, "..", "..", "apps", "web", ".data", STORE_FILE);

  for (const p of [a, b, c]) {
    if (await fileExists(p)) {
      _resolvedStorePath = p;
      console.log("[ai-outputs] using store path:", p);
      return p;
    }
  }

  // Default to A so saves go to a predictable place in web app
  _resolvedStorePath = a;
  return a;
}

/**
 * Resuelve ruta del índice de fingerprints en la MISMA carpeta que el store.
 * (Mantiene consistencia con `.data`).
 */
async function resolveFingerprintsPath() {
  if (_resolvedFpPath) return _resolvedFpPath;

  const storePath = await resolveStorePath();
  const dir = path.dirname(storePath);
  const fpPath = path.join(dir, FP_FILE);

  // Si existe ya, úsalo
  if (await fileExists(fpPath)) {
    _resolvedFpPath = fpPath;
    return fpPath;
  }

  // Si no existe, igual lo usamos como destino por default
  _resolvedFpPath = fpPath;
  return fpPath;
}

type AiOutputsStore = { outputs: any[] };
type FingerprintIndex = { map: Record<string, string> };

export async function loadStore(): Promise<AiOutputsStore> {
  const STORE_PATH = await resolveStorePath();
  try {
    const txt = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(txt);
    return { outputs: Array.isArray(parsed.outputs) ? parsed.outputs : [] };
  } catch {
    return { outputs: [] };
  }
}

export async function saveStore(store: AiOutputsStore) {
  const STORE_PATH = await resolveStorePath();
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

async function loadFpIndex(): Promise<FingerprintIndex> {
  const FP_PATH = await resolveFingerprintsPath();
  try {
    const txt = await fs.readFile(FP_PATH, "utf8");
    const parsed = JSON.parse(txt);
    return { map: parsed?.map ?? {} };
  } catch {
    return { map: {} };
  }
}

async function saveFpIndex(idx: FingerprintIndex) {
  const FP_PATH = await resolveFingerprintsPath();
  await fs.mkdir(path.dirname(FP_PATH), { recursive: true });
  await fs.writeFile(FP_PATH, JSON.stringify(idx, null, 2), "utf8");
}

/** Get output by id (uuid or legacy). Returns null if not found */
export async function dbGetAiOutput(outputId: string) {
  const store = await loadStore();
  return (
    store.outputs.find(
      (o: any) =>
        o.id === outputId || o.outputId === outputId || o._id === outputId,
    ) ?? null
  );
}

/** List outputs for a moodboard (newest first) */
export async function dbListAiOutputsByMoodboard(
  moodboardId: string,
  limit = 50,
) {
  const store = await loadStore();

  const items = store.outputs
    .filter((o: any) => o.moodboardId === moodboardId)
    .sort((a: any, b: any) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
    );

  return items.slice(0, Math.max(0, limit));
}

export async function dbFindLatestAiOutput(moodboardId: string) {
  const store = await loadStore();

  const items = store.outputs
    .filter((o: any) => o.moodboardId === moodboardId)
    .sort((a: any, b: any) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
    );

  return items[0] ?? null;
}

/** Create/insert an output (ensures id + createdAt) */
export async function dbCreateAiOutput(output: any) {
  const store = await loadStore();

  const created = {
    ...output,
    id: output?.id ?? output?.outputId ?? crypto.randomUUID(),
    createdAt: output?.createdAt ?? new Date().toISOString(),
  };

  store.outputs.push(created);
  await saveStore(store);
  return created;
}

/* ======================================================================================
   Fingerprints + Compare helpers (Sprint K — Lineage Model)
   ====================================================================================== */

/**
 * contentFingerprint: ignora packaging (pdf/json/zip) para permitir re-export sin recalcular contenido.
 */
export function buildContentFingerprint(spec: OutputSpec): string {
  const { packaging, ...rest } = spec as any;
  return hashObjectStable(rest);
}

/**
 * exportFingerprint: incluye packaging. Si es idéntico, podemos reutilizar el export completo 1:1.
 */
export function buildExportFingerprint(spec: OutputSpec): string {
  return hashObjectStable(spec);
}

/**
 * structural hash: útil para compare rápido (shape/estructura).
 * Por ahora hash del JSON estable completo.
 */
export function buildStructuralHash(outputJson: unknown): string {
  return hashObjectStable(outputJson);
}

/**
 * Preview de texto estable para UX (compare/version history).
 */
export function buildTextPreview(
  outputJson: unknown,
  maxLen = 400,
): string | undefined {
  try {
    const s = stableStringify(outputJson);
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
  } catch {
    return undefined;
  }
}

/**
 * Construye digest recomendado para compare UX.
 */
export function buildDigest(args: {
  contentHash: string;
  outputJson: unknown;
}): OutputDigest {
  const { contentHash, outputJson } = args;
  let bytes: number | undefined = undefined;
  try {
    bytes = Buffer.byteLength(JSON.stringify(outputJson), "utf8");
  } catch {}

  return {
    schemaVersion: "1",
    contentHash,
    structuralHash: buildStructuralHash(outputJson),
    textPreview: buildTextPreview(outputJson),
    stats: { bytes },
  };
}

/**
 * Busca un output existente por exportFingerprint (re-export inteligente).
 */
export async function fpFindOutputIdByExportFingerprint(
  exportFingerprint: string,
): Promise<string | null> {
  const idx = await loadFpIndex();
  return idx.map[exportFingerprint] ?? null;
}

/**
 * Registra/actualiza el índice exportFingerprint -> outputId.
 */
export async function fpRegisterExportFingerprint(
  exportFingerprint: string,
  outputId: string,
): Promise<void> {
  const idx = await loadFpIndex();
  idx.map[exportFingerprint] = outputId;
  await saveFpIndex(idx);
}
