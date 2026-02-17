import { NextResponse } from "next/server";
import { z } from "zod";
import { dbGetAiOutput } from "../../../../../src/server/ai-outputs/store";
import { generateAiControlled } from "../../../../../src/server/ai/generate";

export const runtime = "nodejs";

const BodyZ = z.object({
  instructions: z.string().min(1),
  level: z.enum(["patch", "minor", "major"]).optional(),
  force: z.boolean().optional(),
});

async function unwrapParams(ctx: { params?: any }) {
  const p = ctx?.params;
  return p && typeof p.then === "function" ? await p : p;
}

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, { status });
}

export async function POST(req: Request, ctx: { params?: any }) {
  // 1) Params (robusto)
  const params = await unwrapParams(ctx);
  const outputIdRaw = params?.outputId;

  if (typeof outputIdRaw !== "string" || !outputIdRaw.trim()) {
    return json(400, {
      error: "BAD_PARAMS",
      message: "Missing outputId param",
    });
  }

  // Si quieres “strict”, valida UUID (tu outputIds parecen UUID)
  const outputId = outputIdRaw.trim();
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      outputId,
    );
  if (!isUuid) {
    return json(400, {
      error: "BAD_PARAMS",
      message: "outputId must be a valid UUID",
      outputId,
    });
  }

  // 2) Body JSON (robusto)
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return json(400, {
      error: "INVALID_JSON",
      message: "Body must be valid JSON",
    });
  }

  // 3) Body schema (Zod)
  const parsed = BodyZ.safeParse(bodyJson);
  if (!parsed.success) {
    return json(400, {
      error: "INVALID_BODY",
      issues: parsed.error.issues,
    });
  }

  const body = parsed.data;

  // 4) Base output
  const base = await dbGetAiOutput(outputId);
  if (!base) {
    return json(404, { error: "NOT_FOUND", outputId });
  }

  if (!base.moodboardId || typeof base.moodboardId !== "string") {
    return json(409, {
      error: "BASE_INCOMPLETE",
      message: "Base output missing moodboardId",
      outputId: base.id,
    });
  }

  // 5) Generate (errores internos => 500)
  try {
    const result = await generateAiControlled({
      moodboardId: base.moodboardId,
      // Default: si no mandan force, NO forzamos (mejor para diagnóstico estable)
      // Si tú prefieres “siempre forzar”, cambia a: body.force ?? true
      force: body.force ?? false,
      refinement: {
        baseOutputId: base.id,
        instructions: body.instructions,
        level: body.level ?? "patch",
      },
    });

    return json(200, result);
  } catch (e: any) {
    // Esto es un error REAL interno (ej. undefined.split)
    const message = e?.message ?? "Internal error";
    const stack = e?.stack;

    return json(500, {
      error: "INTERNAL",
      message,
      // Stack solo en dev
      ...(process.env.NODE_ENV !== "production" ? { stack } : {}),
    });
  }
}
