import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { ok: true, where: "apps/web/app/api" },
    { status: 200 },
  );
}
