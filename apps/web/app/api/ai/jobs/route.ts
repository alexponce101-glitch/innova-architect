import { NextResponse } from "next/server";
import { z } from "zod";
import { dbListAiJobs } from "../../../../src/server/ai-jobs/store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const moodboardId = z
    .string()
    .min(1)
    .parse(url.searchParams.get("moodboardId"));
  const limit = Math.min(
    50,
    Math.max(1, Number(url.searchParams.get("limit") ?? "10")),
  );
  const jobs = await dbListAiJobs(moodboardId, limit);
  return NextResponse.json({ jobs }, { status: 200 });
}
