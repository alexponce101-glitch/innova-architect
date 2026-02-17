import { NextResponse } from "next/server";

import { dbGetStyleProfile } from "../../../../../../../src/server/style-profile/store";
import { buildDesignBrief } from "../../../../../../../src/server/style-profile/brief-engine";
import {
  dbGetBrief,
  dbUpsertBrief,
} from "../../../../../../../src/server/style-profile/brief-store";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ moodboardId: string; styleProfileId: string }> },
) {
  const { styleProfileId } = await ctx.params;

  const cached = dbGetBrief(styleProfileId);
  if (!cached)
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json(cached, { status: 200 });
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ moodboardId: string; styleProfileId: string }> },
) {
  const { styleProfileId } = await ctx.params;

  const profile = dbGetStyleProfile(styleProfileId);
  if (!profile)
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const out = buildDesignBrief(profile);
  dbUpsertBrief(styleProfileId, out);

  return NextResponse.json(out, { status: 200 });
}
