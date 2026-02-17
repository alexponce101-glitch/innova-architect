import { NextRequest, NextResponse } from "next/server";

import { dbListStyleProfilesByMoodboard } from "../../../../src/server/style-profile/store";

async function unwrapParams(ctx: { params?: any }) {
  const p = ctx?.params;
  return p && typeof p.then === "function" ? await p : p;
}

export async function GET(_req: NextRequest, ctx: { params?: any }) {
  const params = await unwrapParams(ctx);
  const moodboardId = String(params?.moodboardId ?? "").trim();

  if (!moodboardId) {
    return NextResponse.json(
      { error: "Missing moodboardId param" },
      { status: 400 },
    );
  }

  const items = await dbListStyleProfilesByMoodboard(moodboardId);
  return NextResponse.json({ items }, { status: 200 });
}
