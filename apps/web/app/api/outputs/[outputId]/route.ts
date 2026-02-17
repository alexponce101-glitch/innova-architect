// apps/web/app/api/outputs/[outputId]/route.ts
import { NextResponse } from "next/server";
import { dbGetAiOutput } from "../../../../src/server/ai-outputs/store";

async function unwrapParams(ctx: { params?: any }) {
  const p = ctx?.params;
  return p && typeof p.then === "function" ? await p : p;
}

export async function GET(_req: Request, ctx: { params?: any }) {
  const params = await unwrapParams(ctx);
  const outputId = params?.outputId;

  if (!outputId) {
    return NextResponse.json({ error: "INVALID_PARAMS" }, { status: 400 });
  }

  const output = await dbGetAiOutput(String(outputId));
  if (!output) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ output });
}
