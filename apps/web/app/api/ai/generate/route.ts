import { NextResponse } from "next/server";
import { z } from "zod";
import { generateAiControlled } from "../../../../src/server/ai/generate";

const BodyZ = z.object({
  moodboardId: z.string().min(1),
  force: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    const body = BodyZ.parse(await req.json());
    const result = await generateAiControlled({
      moodboardId: body.moodboardId,
      force: body.force ?? false,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Bad Request" },
      { status: 400 },
    );
  }
}
