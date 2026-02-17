import { NextResponse } from "next/server";
import { z } from "zod";

import { dbGetExportJob } from "../../../../src/server/export/store";

const ParamsZ = z.object({
  exportId: z.string().uuid(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ exportId: string }> },
) {
  const params = await ctx.params;
  const exportId = String(params.exportId).trim();
  const { exportId: id } = ParamsZ.parse({ exportId });

  const job = await dbGetExportJob(id);
  if (!job) {
    return NextResponse.json(
      { ok: false, error: { message: "EXPORT_JOB_NOT_FOUND" } },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, job }, { status: 200 });
}
