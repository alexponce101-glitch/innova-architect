// apps/web/src/server/export/engine.ts
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

import type { ExportRequest } from "./validators";
import { ExportRequestZ } from "./validators";

import { ExportManifest, ExportManifestZ } from "./manifest";
import { sha256Hex } from "../hash/sha256";
import { buildLineageChain } from "../provenance/engine";

import { computeExportInputsHash } from "./inputs-hash";
import { dbFindSucceededExportByInputsHash, dbUpdateExportJob } from "./store";

import {
  dbGetAiOutput,
  dbCreateAiOutput,
  buildContentFingerprint,
  buildExportFingerprint,
  buildDigest,
  fpFindOutputIdByExportFingerprint,
  fpRegisterExportFingerprint,
} from "../ai-outputs/store";

import { lineageAddEdge } from "../lineage/store";
import type { OutputSpec } from "../lineage/types";

import type { ExportJob } from "./types";
import { exportDirAbs, exportFileAbs, exportFilesDirReadAbs } from "./paths";

export type WrittenFile = {
  name: string;
  mime: string;
  sha256: string;
  sizeBytes: number;
};

async function ensureFilesDir() {
  await fs.mkdir(exportFilesDirReadAbs(), { recursive: true });
}

async function writeFile(exportId: string, name: string, bytes: Buffer) {
  await ensureFilesDir();
  const dir = exportDirAbs(exportId);
  await fs.mkdir(dir, { recursive: true });

  const p = exportFileAbs(exportId, name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, bytes);
  return p;
}

function mimeForName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".dxf")) return "application/dxf";
  return "application/octet-stream";
}

function nowIso() {
  return new Date().toISOString();
}

function buildBaseExportJob(args: {
  exportId: string;
  outputId: string;
  inputsHash: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  files?: WrittenFile[];
  reusedFromExportId?: string;
  error?: { code: string; message?: string };
}): ExportJob {
  const createdAt = nowIso();
  const finishedAt =
    args.status === "SUCCEEDED" || args.status === "FAILED"
      ? nowIso()
      : undefined;

  return {
    id: args.exportId,
    outputId: args.outputId,
    status: args.status,
    inputsHash: args.inputsHash,
    files: args.files ?? [],
    reusedFromExportId: args.reusedFromExportId,
    createdAt,
    finishedAt,
    error: args.error,
  } as ExportJob;
}

function buildExportSpec(args: {
  moodboardId: string;
  systemVersion: string;
  req: ExportRequest;
  sourceOutputId: string;
}): OutputSpec {
  const includeManifest = Boolean((args.req as any)?.includeManifest);

  return {
    moodboardId: args.moodboardId,
    kind: "EXPORT",
    engineVersion: String(args.systemVersion ?? "0.0.0"),
    params: {
      includeManifest,
      format: (args.req as any)?.format ?? "json",
      fileName: (args.req as any)?.fileName ?? null,
      template: (args.req as any)?.template ?? null,
      options: (args.req as any)?.options ?? null,
    },
    inputs: {
      parentOutputIds: [args.sourceOutputId],
    },
    packaging: {
      format: "json",
      templateId: "export-v1",
      locale: "en-US",
    },
  };
}

/**
 * Copy artifacts from a previous exportId to the current exportId.
 */
async function reuseArtifacts(opts: {
  fromExportId: string;
  toExportId: string;
  files: WrittenFile[];
}) {
  await ensureFilesDir();

  const dstDir = exportDirAbs(opts.toExportId);
  await fs.mkdir(dstDir, { recursive: true });

  for (const f of opts.files) {
    const relName = f.name;
    const srcAbs = exportFileAbs(opts.fromExportId, relName);
    const dstAbs = exportFileAbs(opts.toExportId, relName);

    await fs.mkdir(path.dirname(dstAbs), { recursive: true });
    await fs.copyFile(srcAbs, dstAbs);
  }
}

function expectedArtifacts(requireManifest: boolean): string[] {
  const base = ["output.json"];
  if (requireManifest) base.push("manifest.json");
  return base;
}

/**
 * Re-hash real artifacts from disk (repairs legacy jobs where manifest was mutated after save).
 */
async function rehashWrittenFiles(opts: {
  exportId: string;
  files: WrittenFile[];
}): Promise<WrittenFile[]> {
  const out: WrittenFile[] = [];

  for (const f of opts.files) {
    const abs = exportFileAbs(opts.exportId, f.name);
    const bytes = await fs.readFile(abs);
    out.push({
      name: f.name,
      mime: mimeForName(f.name),
      sha256: await sha256Hex(bytes),
      sizeBytes: bytes.length,
    });
  }

  return out;
}

/**
 * STRONG reuse validation:
 * - Must contain required artifacts
 * - Every file listed must exist
 * - sha256 must match (recompute)
 */
async function validateReusableArtifacts(opts: {
  exportId: string;
  files: WrittenFile[];
  requireManifest: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!Array.isArray(opts.files) || opts.files.length === 0) {
    return { ok: false, reason: "NO_FILES" };
  }

  const required = expectedArtifacts(opts.requireManifest);
  const listedNames = new Set(opts.files.map((f) => String(f.name)));

  for (const r of required) {
    if (!listedNames.has(r))
      return { ok: false, reason: `MISSING_REQUIRED_ENTRY:${r}` };
  }

  for (const f of opts.files) {
    const abs = exportFileAbs(opts.exportId, f.name);

    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) return { ok: false, reason: `NOT_A_FILE:${f.name}` };
    } catch {
      return { ok: false, reason: `MISSING_FILE:${f.name}` };
    }

    try {
      const bytes = await fs.readFile(abs);
      const sha = await sha256Hex(bytes);
      if (sha !== f.sha256)
        return { ok: false, reason: `SHA_MISMATCH:${f.name}` };
    } catch {
      return { ok: false, reason: `READ_FAIL:${f.name}` };
    }
  }

  return { ok: true };
}

/**
 * Best-effort job update without coupling engine to store signature.
 */
async function tryUpdateJob(patch: any) {
  try {
    await (dbUpdateExportJob as any)(patch);
  } catch {
    // swallow
  }
}

export async function runExport(args: {
  exportId: string;
  outputId: string;
  request: ExportRequest;
  systemVersion: string;
  meta?: { debugId?: string; requestedAt?: string };
}): Promise<{
  files: WrittenFile[];
  manifestSha256?: string;
  reused?: boolean;
  reusedFromExportId?: string;
  inputsHash: string;
}> {
  const req = ExportRequestZ.parse(args.request);

  const exportId = String(args.exportId).trim();
  const outputId = String(args.outputId).trim();

  if (!exportId) throw new Error("EXPORT_ID_MISSING");
  if (!outputId) throw new Error("OUTPUT_ID_MISSING");

  // 1) Load source output
  const output = await dbGetAiOutput(outputId);
  if (!output) throw new Error(`EXPORT_OUTPUT_NOT_FOUND: ${outputId}`);

  // 2) Logical EXPORT output (lineage + fingerprint)
  const moodboardId = String(output.moodboardId ?? "");
  const includeManifest = Boolean((req as any)?.includeManifest);

  const spec = buildExportSpec({
    moodboardId,
    systemVersion: args.systemVersion,
    req,
    sourceOutputId: outputId,
  });

  const contentFingerprint = buildContentFingerprint(spec);
  const exportFingerprint = buildExportFingerprint(spec);

  const reusableExportOutputId =
    await fpFindOutputIdByExportFingerprint(exportFingerprint);

  const exportEvent = await dbCreateAiOutput({
    moodboardId,
    kind: "EXPORT",
    spec,
    contentFingerprint,
    exportFingerprint,
    reusedFromOutputId: reusableExportOutputId ?? undefined,
    digest: buildDigest({
      contentHash: contentFingerprint,
      outputJson: output,
    }),
  });

  await lineageAddEdge({
    fromId: String(exportEvent.id),
    toId: outputId,
    type: "USES_AS_INPUT",
    reason: "Export generated from source output",
    actor: "SYSTEM",
    route: "export/engine:runExport",
  });

  if (reusableExportOutputId) {
    await lineageAddEdge({
      fromId: String(exportEvent.id),
      toId: reusableExportOutputId,
      type: "REEXPORT_OF",
      reason: "exportFingerprint matched; export is logically identical",
      actor: "SYSTEM",
      route: "export/engine:runExport",
    });
  } else {
    await fpRegisterExportFingerprint(
      exportFingerprint,
      String(exportEvent.id),
    );
  }

  // 3) Compute inputsHash (determinístico)
  const inputsHash = computeExportInputsHash({
    outputId: output.id,
    outputVersion: output.version,
    outputKind: output.kind,
    payloadHash: output.payloadHash ?? null,
    provider: output.provider ?? null,
    model: output.model ?? null,
    export: {
      format: (req as any)?.format ?? "json",
      fileName: (req as any)?.fileName ?? null,
      template: (req as any)?.template ?? null,
      options: (req as any)?.options ?? null,
      includeManifest,
    },
  });

  await tryUpdateJob({
    id: exportId,
    inputsHash,
    route: "export/engine:runExport",
  });

  // 4) Smart Re-Export (physical reuse)
  const prev = await dbFindSucceededExportByInputsHash(inputsHash);
  const prevFiles = ((prev?.files ?? []) as WrittenFile[]) ?? [];
  const reuseCandidateOk =
    Boolean(prev) && Array.isArray(prevFiles) && prevFiles.length > 0;

  if (reuseCandidateOk) {
    // Rehash real files from disk (repairs legacy manifests)
    let prevFilesFixed: WrittenFile[] = prevFiles;
    try {
      prevFilesFixed = await rehashWrittenFiles({
        exportId: String(prev!.id),
        files: prevFiles,
      });
    } catch {
      prevFilesFixed = prevFiles;
    }

    const valid = await validateReusableArtifacts({
      exportId: String(prev!.id),
      files: prevFilesFixed,
      requireManifest: includeManifest,
    });

    if (valid.ok) {
      await reuseArtifacts({
        fromExportId: String(prev!.id),
        toExportId: exportId,
        files: prevFilesFixed,
      });

      const manifestEntry = prevFilesFixed.find(
        (f) => f.name === "manifest.json",
      );

      const reusedJob = buildBaseExportJob({
        exportId,
        outputId,
        inputsHash,
        status: "SUCCEEDED",
        files: prevFilesFixed,
        reusedFromExportId: String(prev!.id),
      });

      await dbUpdateExportJob(reusedJob);

      await tryUpdateJob({
        id: exportId,
        status: "SUCCEEDED",
        finishedAt: nowIso(),
        inputsHash,
        files: prevFilesFixed,
        reusedFromExportId: String(prev!.id),
        route: "export/engine:runExport",
      });

      return {
        files: prevFilesFixed,
        manifestSha256: manifestEntry?.sha256,
        reused: true,
        reusedFromExportId: String(prev!.id),
        inputsHash,
      };
    } else {
      await tryUpdateJob({
        id: exportId,
        inputsHash,
        reuseRejectedReason: valid.reason ?? "REUSE_REJECTED",
        route: "export/engine:runExport",
      });
    }
  }

  // 5) Export real (generate artifacts)
  const exportJsonName = "output.json";
  const exportJsonBytes = Buffer.from(JSON.stringify(output, null, 2), "utf8");
  const exportJsonSha = await sha256Hex(exportJsonBytes);

  await writeFile(exportId, exportJsonName, exportJsonBytes);

  const files: WrittenFile[] = [
    {
      name: exportJsonName,
      mime: mimeForName(exportJsonName),
      sha256: exportJsonSha,
      sizeBytes: exportJsonBytes.length,
    },
  ];

  let manifestSha256: string | undefined = undefined;

  if (includeManifest) {
    const lineage = await buildLineageChain(outputId);

    const checksums = files.reduce<Record<string, string>>((acc, f) => {
      acc[f.name] = f.sha256;
      return acc;
    }, {});

    const manifest: ExportManifest = ExportManifestZ.parse({
      innovaArchitectVersion: args.systemVersion,
      exportId,
      outputId,
      lineage: lineage.map((n: any) => ({
        outputId: String(n.outputId),
        version: String(n.version ?? "0.0.0"),
        kind: String(n.kind ?? "UNKNOWN"),
        createdAt: String(n.createdAt ?? nowIso()),
      })),
      createdAt: nowIso(),
      checksums,
    });

    const manifestBytes = Buffer.from(
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );
    manifestSha256 = await sha256Hex(manifestBytes);

    await writeFile(exportId, "manifest.json", manifestBytes);

    files.push({
      name: "manifest.json",
      mime: "application/json",
      sha256: manifestSha256,
      sizeBytes: manifestBytes.length,
    });

    // 🚫 IMPORTANT: do NOT call writeManifestWithChecksums here (it mutates manifest).
  }

  const finalJob = buildBaseExportJob({
    exportId,
    outputId,
    inputsHash,
    status: "SUCCEEDED",
    files,
  });

  await dbUpdateExportJob(finalJob);

  await tryUpdateJob({
    id: exportId,
    status: "SUCCEEDED",
    finishedAt: nowIso(),
    inputsHash,
    files,
    route: "export/engine:runExport",
  });

  return { files, manifestSha256, reused: false, inputsHash };
}

export function newExportId() {
  return crypto.randomUUID();
}
