import { NextResponse } from "next/server";
import { z } from "zod";
import {
  loadComparePins,
  saveComparePins,
} from "../../../../../src/server/compare-pins/store";

export const runtime = "nodejs";

const GetZ = z.object({
  compareKey: z.string().min(1),
});

const PutZ = z.object({
  compareKey: z.string().min(1),
  snapshot: z.unknown(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = GetZ.safeParse({
    compareKey: url.searchParams.get("compareKey"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "BAD_REQUEST", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const snap = await loadComparePins(parsed.data.compareKey);
  return NextResponse.json({ snapshot: snap }, { status: 200 });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = PutZ.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "BAD_REQUEST", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await saveComparePins(parsed.data.compareKey, parsed.data.snapshot);
  return NextResponse.json({ ok: true }, { status: 200 });
}
