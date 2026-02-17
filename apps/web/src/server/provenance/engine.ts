import { z } from "zod";
import { OutputKindZ, OutputProvenance, OutputProvenanceZ } from "./types";
import { stableStringify, sha256Hex } from "../hash/sha256";
import { dbGetAiOutput } from "../ai-outputs/store";

// ISO timestamp helper
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Normalize any stored output into a lineage node.
 * IMPORTANT:
 * - NO UUID validation here
 * - lineage must tolerate legacy / non-uuid ids
 */
function toLineageNode(raw: any) {
  const outId =
    raw?.id ?? raw?.outputId ?? raw?._id ?? raw?.output_id ?? "unknown";
  return {
    outputId: String(outId),

    parentOutputId: raw.parentOutputId ? String(raw.parentOutputId) : undefined,
    kind: raw.kind ?? "GENERATE",
    version: String(raw.version ?? "0.0.0"),
    createdAt: String(raw.createdAt ?? raw.created_at ?? nowIso()),
  };
}

/**
 * Build lineage chain from root → leaf
 */
export async function buildLineageChain(
  outputId: string,
  opts?: { maxDepth?: number },
) {
  const maxDepth = opts?.maxDepth ?? 50;

  const visited = new Set<string>();
  const chain: any[] = [];

  let currentId: string | undefined = outputId;
  let depth = 0;

  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error(`LINEAGE_CYCLE_DETECTED: ${currentId}`);
    }
    visited.add(currentId);

    const raw = await dbGetAiOutput(currentId);
    if (!raw) {
      throw new Error(`LINEAGE_MISSING_NODE: ${currentId}`);
    }

    const node = toLineageNode(raw);
    chain.push(node);

    currentId = node.parentOutputId;
    depth += 1;

    if (depth > maxDepth) {
      throw new Error(`LINEAGE_MAX_DEPTH_EXCEEDED: ${maxDepth}`);
    }
  }

  return chain.reverse(); // root → leaf
}

/**
 * Validate lineage structural integrity
 */
export function assertLineageIntegrity(chain: any[]) {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error("LINEAGE_EMPTY");
  }

  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const cur = chain[i];

    if (cur.parentOutputId !== prev.outputId) {
      throw new Error(
        `LINEAGE_BROKEN_LINK: ${cur.outputId} expected parent ${prev.outputId}`,
      );
    }
  }
}

/**
 * Deterministic provenance hash
 */
export async function hashProvenance(prov: OutputProvenance): Promise<string> {
  const json = stableStringify(prov);
  return sha256Hex(json);
}

/**
 * Create normalized provenance record (boundary-safe)
 */
export function createProvenanceFromOutput(args: {
  outputId: string;
  moodboardId: string;
  kind: z.infer<typeof OutputKindZ>;
  version: string;
  parentOutputId?: string;
  createdAt?: string;

  inputs?: {
    briefHash?: string;
    styleProfileHash?: string;
    moodboardHash?: string;
    signalsHash?: string;
  };

  provider?: string;
  model?: string;
  promptHash?: string;

  systemVersion: string;
  notes?: string;
}) {
  const prov = {
    outputId: args.outputId,
    moodboardId: args.moodboardId,
    kind: args.kind,
    version: args.version,
    parentOutputId: args.parentOutputId,
    createdAt: args.createdAt ?? nowIso(),
    inputs: {
      briefHash: args.inputs?.briefHash,
      styleProfileHash: args.inputs?.styleProfileHash,
      moodboardHash: args.inputs?.moodboardHash,
      signalsHash: args.inputs?.signalsHash,
    },
    model: args.model,
    provider: args.provider as any,
    promptHash: args.promptHash,
    systemVersion: args.systemVersion,
    notes: args.notes,
  };

  return OutputProvenanceZ.parse(prov);
}
