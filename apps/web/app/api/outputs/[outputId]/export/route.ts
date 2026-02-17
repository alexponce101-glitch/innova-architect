import { NextResponse } from "next/server";

import {
  runExport,
  newExportId,
} from "../../../../../src/server/export/engine";
import { normalizeRunExportBody } from "../../../../../src/server/export/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newDebugId() {
  return `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    // Si no hay body, Next puede lanzar error al parsear. Fail-open a {}
    return await req.json();
  } catch {
    return {};
  }
}

// Next a veces entrega params como Promise en route handlers
async function unwrapParams(ctx: { params?: any }) {
  const p = ctx?.params;
  return p && typeof p.then === "function" ? await p : p;
}

function isLikelyZodError(e: unknown) {
  if (!e || typeof e !== "object") return false;
  const anyE = e as any;
  return Array.isArray(anyE.issues) || anyE.name === "ZodError";
}

function isUuid(s: string) {
  // RFC4122 v1-v5 (suficiente para gatekeeper del param)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function jsonNoStore(body: any, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request, ctx: { params?: any }) {
  const debugId = newDebugId();
  const startedAt = Date.now();

  try {
    const params = await unwrapParams(ctx);
    const outputIdFromParam = String(params?.outputId ?? "").trim();

    if (!outputIdFromParam) {
      return jsonNoStore(
        {
          ok: false,
          error: "OUTPUT_ID_MISSING",
          message: "Missing outputId param.",
          debugId,
          tookMs: Date.now() - startedAt,
        },
        { status: 400 },
      );
    }

    if (!isUuid(outputIdFromParam)) {
      return jsonNoStore(
        {
          ok: false,
          error: "OUTPUT_ID_INVALID",
          message: "outputId param must be a UUID.",
          debugId,
          tookMs: Date.now() - startedAt,
        },
        { status: 400 },
      );
    }

    const rawBody = await safeJson(req);

    // ✅ Fuente única de verdad:
    // - outputId sale del URL param (no del body)
    // - body puede traer systemVersion + request overrides
    const { outputId, systemVersion, request } = normalizeRunExportBody({
      ...(rawBody as any),
      outputId: outputIdFromParam,
    });

    const exportId = newExportId();

    const result = await runExport({
      exportId,
      outputId,
      request,
      systemVersion: systemVersion ?? "0.1.0",
      meta: { debugId },
    });

    return jsonNoStore(
      {
        ok: true,
        exportId,

        inputsHash: (result as any).inputsHash ?? null, // ✅ ADD

        files: result.files ?? [],
        manifestSha256: result.manifestSha256 ?? null,

        // Sprint L — Cache visibility (WOW+++)
        reused: Boolean((result as any).reused),
        reusedFromExportId: (result as any).reusedFromExportId ?? null,

        debugId,
        tookMs: Date.now() - startedAt,
      },
      { status: 201 },
    );
  } catch (e: any) {
    console.error("EXPORT_OUTPUT_RUN_FAILED", {
      debugId,
      message: e?.message,
      issues: e?.issues,
      stack: e?.stack,
    });

    if (isLikelyZodError(e)) {
      return jsonNoStore(
        {
          ok: false,
          error: "INVALID_INPUT",
          message: e?.message ?? "Invalid input",
          issues: e?.issues ?? [],
          debugId,
          tookMs: Date.now() - startedAt,
        },
        { status: 400 },
      );
    }

    return jsonNoStore(
      {
        ok: false,
        error: "EXPORT_RUN_FAILED",
        message: e?.message ?? "Export run failed",
        debugId,
        tookMs: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
