// apps/web/app/api/moodboards/[moodboardId]/outputs/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  dbCreateAiOutput,
  dbListAiOutputsByMoodboard,
} from "../../../../../src/server/ai-outputs/store";

const ParamsZ = z.object({ moodboardId: z.string().min(1) });

async function getParams(ctx: { params?: any }) {
  const p = ctx?.params;
  return p && typeof p.then === "function" ? await p : p; // Next 16
}

function bumpPatchVersion(v: string) {
  const parts = (v || "1.0.0").split(".").map((x) => Number(x) || 0);
  const major = parts[0] ?? 1;
  const minor = parts[1] ?? 0;
  const patch = (parts[2] ?? 0) + 1;
  return `${major}.${minor}.${patch}`;
}

export async function GET(_req: Request, ctx: { params?: any }) {
  const params = await getParams(ctx);
  const parsed = ParamsZ.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_PARAMS", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { moodboardId } = parsed.data;
  const outputs = await dbListAiOutputsByMoodboard(moodboardId, 50);
  return NextResponse.json({ outputs });
}

export async function POST(req: Request, ctx: { params?: any }) {
  const params = await getParams(ctx);
  const parsed = ParamsZ.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_PARAMS", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { moodboardId } = parsed.data;
  const body = await req.json().catch(() => ({}));

  // ✅ Regenerar a partir de payloadHash
  if (body?.action === "REGENERATE_FROM_PAYLOAD_HASH") {
    const payloadHash = String(body.payloadHash ?? "");
    if (!payloadHash) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "payloadHash required" },
        { status: 400 },
      );
    }

    const outputs = await dbListAiOutputsByMoodboard(moodboardId, 200);
    const parent = outputs.find(
      (o: any) => o.promptHash === payloadHash || o.payloadHash === payloadHash,
    );

    if (!parent) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "No output found for payloadHash" },
        { status: 404 },
      );
    }

    const nextVersion = bumpPatchVersion(parent.version ?? "1.0.0");

    const created = await dbCreateAiOutput({
      moodboardId,
      kind: "GENERATE",
      version: nextVersion,
      parentOutputId: parent.id,
      payloadJson: parent.payloadJson ?? null,
      outputJson: null, // 👈 mejor dejarlo vacío para que se regenere de verdad
      promptHash: parent.promptHash ?? undefined,
      payloadVersion: parent.payloadVersion ?? undefined,
      provider: parent.provider ?? undefined,
      model: parent.model ?? undefined,
      inputSnapshotJson: parent.inputSnapshotJson ?? undefined,
    } as any);

    return NextResponse.json({ output: created }, { status: 201 });
  }

  return NextResponse.json(
    { error: "BAD_REQUEST", message: "Unknown action" },
    { status: 400 },
  );
}
