// apps/web/app/api/outputs/compare/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { dbGetAiOutput } from "../../../../src/server/ai-outputs/store";
import { compareAiOutputs } from "../../../../src/server/ai-outputs/compare";
import { structuralCompare } from "../../../../src/server/ai-outputs/compare/structural";

export const runtime = "nodejs";

const BodyZ = z.object({
  a: z.string().uuid(),
  b: z.string().uuid(),
  mode: z.enum(["payload", "output", "semantic"]).optional(),
});

function pickHeader(o: any) {
  if (!o) return null;
  return {
    id: o.id,
    moodboardId: o.moodboardId ?? null,
    kind: o.kind ?? null,
    version: o.version ?? null,
    parentOutputId: o.parentOutputId ?? null,
    payloadHash: o.payloadHash ?? null,
    provider: o.provider ?? null,
    model: o.model ?? null,
    tokensIn: o.tokensIn ?? null,
    tokensOut: o.tokensOut ?? null,
    createdAt: o.createdAt ?? null,
    finishedAt: o.finishedAt ?? null,
  };
}

async function handleCompare(payload: unknown) {
  const body = BodyZ.parse(payload);
  const mode = body.mode ?? "semantic";

  const [aOut, bOut] = await Promise.all([
    dbGetAiOutput(body.a),
    dbGetAiOutput(body.b),
  ]);

  if (!aOut) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: `Output A not found: ${body.a}` },
      { status: 404 },
    );
  }
  if (!bOut) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: `Output B not found: ${body.b}` },
      { status: 404 },
    );
  }

  // Base compare (mantiene semantic/estructural actual como lo tengas en engine.ts)
  const compare = compareAiOutputs({ a: aOut, b: bOut, mode });

  // Snapshots (UI side-by-side + guardrails)
  const aPayloadJson = (aOut as any).payloadJson ?? null;
  const bPayloadJson = (bOut as any).payloadJson ?? null;
  const aOutputJson = (aOut as any).outputJson ?? null;
  const bOutputJson = (bOut as any).outputJson ?? null;

  // ✅ NUEVO: 2 diffs estructurales SIEMPRE disponibles
  const structuralPayload = structuralCompare(aPayloadJson, bPayloadJson);
  const structuralOutput = structuralCompare(aOutputJson, bOutputJson);

  // ✅ UI needs these for Side-by-side + guardrails (no more “ghost buttons”)
  const response = {
    ...compare,
    headers: {
      a: pickHeader(aOut),
      b: pickHeader(bOut),
    },
    snapshots: {
      aPayloadJson,
      bPayloadJson,
      aOutputJson,
      bOutputJson,
    },
    structuralPayload,
    structuralOutput,
  };

  return NextResponse.json(response, { status: 200 });
}

export async function POST(req: Request) {
  try {
    return await handleCompare(await req.json());
  } catch (err: any) {
    const message =
      err?.name === "ZodError"
        ? err.message
        : (err?.message ?? "Unknown error");
    return NextResponse.json(
      { error: "COMPARE_FAILED", message },
      { status: 400 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const a = searchParams.get("a");
    const b = searchParams.get("b");
    const mode = searchParams.get("mode") ?? undefined;

    return await handleCompare({ a, b, mode });
  } catch (err: any) {
    const message =
      err?.name === "ZodError"
        ? err.message
        : (err?.message ?? "Unknown error");
    return NextResponse.json(
      { error: "COMPARE_FAILED", message },
      { status: 400 },
    );
  }
}
