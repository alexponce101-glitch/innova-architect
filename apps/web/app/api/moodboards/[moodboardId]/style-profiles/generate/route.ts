import { NextResponse } from "next/server";

import { generateStyleProfileDraft } from "../../../../../../src/server/style-profile/engine";
import { dbInsertStyleProfile } from "../../../../../../src/server/style-profile/store";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ moodboardId: string }> },
) {
  const { moodboardId } = await ctx.params;

  const draft = generateStyleProfileDraft(moodboardId);
  dbInsertStyleProfile(draft);

  return NextResponse.json(draft, { status: 201 });
}
