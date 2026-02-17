// apps/web/app/api/outputs/compare/explain/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { explainCompareDeterministic } from "../../../../../src/server/ai-outputs/compare/explain";

export const runtime = "nodejs";

const BodyZ = z.object({
  compare: z.any(), // CompareResult (lo dejamos flexible para no pelear con tipos en API)
});

export async function POST(req: Request) {
  try {
    const body = BodyZ.parse(await req.json());
    const result = explainCompareDeterministic(body.compare);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    const message =
      err?.name === "ZodError"
        ? err.message
        : (err?.message ?? "Unknown error");
    return NextResponse.json(
      { error: "EXPLAIN_FAILED", message },
      { status: 400 },
    );
  }
}
