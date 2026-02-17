import { NextRequest, NextResponse } from "next/server";
import { dbGetAiJob } from "../../../../../src/server/ai-jobs/store";

// Helper estándar (ya lo usas en otros routes)
async function unwrapParams(ctx: { params?: any }) {
  const p = ctx?.params;
  return p && typeof p.then === "function" ? await p : p;
}

export async function GET(_req: NextRequest, ctx: { params?: any }) {
  const params = await unwrapParams(ctx);
  const jobId = String(params?.jobId ?? "").trim();

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId param" }, { status: 400 });
  }

  const job = await dbGetAiJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ job }, { status: 200 });
}
