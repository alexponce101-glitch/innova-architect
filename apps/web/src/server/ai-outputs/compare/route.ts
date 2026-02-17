// apps/web/src/app/api/outputs/compare/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { dbGetAiOutput } from "../../../server/ai-outputs/store";
import { diffJsonPaths } from "../../../server/ai-outputs/compare/structural-diff";

export const runtime = "nodejs";

const BodyZ = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  mode: z.enum(["payload", "output", "semantic"]).optional(),
});

type CompareMode = "payload" | "output" | "semantic";

function nowIso() {
  return new Date().toISOString();
}

function safeJson(v: any) {
  // Asegura que undefined -> null para que el UI no reviente con undefined
  return v === undefined ? null : v;
}

function pickHeader(o: any) {
  return {
    id: String(o?.id ?? ""),
    moodboardId: String(o?.moodboardId ?? ""),
    kind: (o?.kind === "REFINE" ? "REFINE" : "GENERATE") as
      | "GENERATE"
      | "REFINE",
    version: String(o?.version ?? ""),
    parentOutputId: o?.parentOutputId ? String(o.parentOutputId) : undefined,
    payloadHash: o?.payloadHash ? String(o.payloadHash) : undefined,
    provider: o?.provider ? String(o.provider) : undefined,
    model: o?.model ? String(o.model) : undefined,
    tokensIn: typeof o?.tokensIn === "number" ? o.tokensIn : undefined,
    tokensOut: typeof o?.tokensOut === "number" ? o.tokensOut : undefined,
    createdAt: String(o?.createdAt ?? o?.generatedAt ?? nowIso()),
    finishedAt: o?.finishedAt ? String(o.finishedAt) : undefined,
  };
}

function pickSnapshots(oA: any, oB: any) {
  // Ajusta aquí si tus campos se llaman diferente.
  const aPayloadJson = safeJson(
    oA?.payloadJson ?? oA?.payload?.json ?? oA?.payload,
  );
  const bPayloadJson = safeJson(
    oB?.payloadJson ?? oB?.payload?.json ?? oB?.payload,
  );

  const aOutputJson = safeJson(
    oA?.outputJson ?? oA?.output?.json ?? oA?.output,
  );
  const bOutputJson = safeJson(
    oB?.outputJson ?? oB?.output?.json ?? oB?.output,
  );

  return { aPayloadJson, bPayloadJson, aOutputJson, bOutputJson };
}

export async function POST(req: Request) {
  try {
    const body = BodyZ.parse(await req.json());
    const mode: CompareMode = (body.mode ?? "semantic") as CompareMode;

    // ✅ IMPORTANTE: await aquí (esto elimina tus 20+ rojos)
    const aOut = await dbGetAiOutput(body.a);
    const bOut = await dbGetAiOutput(body.b);

    if (!aOut || !bOut) {
      return NextResponse.json(
        {
          error: "NOT_FOUND",
          message:
            !aOut && !bOut
              ? "Outputs A y B no encontrados."
              : !aOut
                ? "Output A no encontrado."
                : "Output B no encontrado.",
        },
        { status: 404 },
      );
    }

    const headers = { a: pickHeader(aOut), b: pickHeader(bOut) };
    const snapshots = pickSnapshots(aOut, bOut);

    // Elegimos base para structural
    const aBase =
      mode === "payload" ? snapshots.aPayloadJson : snapshots.aOutputJson;
    const bBase =
      mode === "payload" ? snapshots.bPayloadJson : snapshots.bOutputJson;

    // Si estamos en semantic, igual devolvemos structural de outputJson (para el WOW del inspector)
    const aStructuralBase = mode === "payload" ? aBase : aBase;
    const bStructuralBase = mode === "payload" ? bBase : bBase;

    const structuralJson = diffJsonPaths(aStructuralBase, bStructuralBase);

    // Semantic (si tu engine real ya existe en otro módulo, cámbialo aquí)
    // Por ahora: una señal simple basada en "¿hubo diffs estructurales?"
    const changedCount =
      structuralJson.changedCount ?? structuralJson.changedPaths?.length ?? 0;
    const addedCount =
      structuralJson.addedCount ?? structuralJson.addedPaths?.length ?? 0;
    const removedCount =
      structuralJson.removedCount ?? structuralJson.removedPaths?.length ?? 0;
    const total = changedCount + addedCount + removedCount;

    const semantic =
      mode === "semantic"
        ? {
            score: total === 0 ? 0 : Math.min(1, total / 50),
            classification:
              total === 0
                ? "UNCHANGED"
                : total < 5
                  ? "MINOR"
                  : total < 15
                    ? "MEANINGFUL"
                    : "MAJOR_SHIFT",
            summary:
              total === 0
                ? "Sin cambios estructurales detectados."
                : `Cambios estructurales detectados: ${total}.`,
            method: "HEURISTIC_TEXT_JACCARD" as const,
          }
        : undefined;

    return NextResponse.json({
      a: body.a,
      b: body.b,
      mode,

      headers,
      snapshots,

      structural: {
        changed: structuralJson.changedPaths ?? [],
        unchanged: [],
        json: structuralJson,
      },

      semantic,

      meta: {
        createdAt: nowIso(),
        engineVersion: "v1",
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "COMPARE_FAILED";
    return NextResponse.json(
      { error: "COMPARE_FAILED", message: msg },
      { status: 500 },
    );
  }
}
