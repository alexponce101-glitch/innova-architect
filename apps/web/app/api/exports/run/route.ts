import { NextResponse } from "next/server";

import { runExport, newExportId } from "../../../../src/server/export/engine";
import { normalizeRunExportBody } from "../../../../src/server/export/normalize";

export const runtime = "nodejs";

function newDebugId() {
  return `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function isLikelyZodError(e: any) {
  return e && typeof e === "object" && Array.isArray(e.issues);
}

export async function POST(req: Request) {
  const debugId = newDebugId();
  const startedAt = Date.now();

  try {
    const raw = await safeJson(req);

    // ✅ Fuente única de verdad (Sprint J):
    // - valida body (outputId/systemVersion)
    // - normaliza request con defaults (format json + includeManifest true)
    // - valida request con ExportRequestZ real (types.ts)
    const { outputId, systemVersion, request } = normalizeRunExportBody(raw);

    const exportId = newExportId();

    const result = await runExport({
      exportId,
      outputId,
      request,
      systemVersion: systemVersion ?? "0.1.0",
      meta: { debugId },
    });

    // 🔥 Punto 2) Cache visibility:
    // - expone reused + reusedFromExportId para badge "REUSED" en UI
    // - normaliza campos para que la UI no dependa de "spread" ambiguo
    return NextResponse.json(
      {
        exportId,
        files: result.files ?? [],
        manifestSha256: result.manifestSha256 ?? null,

        reused: Boolean(result.reused),
        reusedFromExportId: result.reusedFromExportId ?? null,

        debugId,
        tookMs: Date.now() - startedAt,
      },
      { status: 201 },
    );
  } catch (e: any) {
    console.error("EXPORT_RUN_FAILED", {
      debugId,
      message: e?.message,
      issues: e?.issues,
      stack: e?.stack,
    });

    if (isLikelyZodError(e)) {
      return NextResponse.json(
        {
          error: "INVALID_INPUT",
          message: "Invalid input",
          issues: e.issues,
          debugId,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "EXPORT_RUN_FAILED",
        message: e?.message ?? "Export run failed",
        debugId,
      },
      { status: 500 },
    );
  }
}
