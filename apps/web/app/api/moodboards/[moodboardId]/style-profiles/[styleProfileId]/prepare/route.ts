import { NextResponse } from "next/server";
import { z } from "zod";

const UrlZ = z.object({
  moodboardId: z.string().min(1),
  styleProfileId: z.string().min(1),
});

function safeHash(input: unknown) {
  try {
    const s = JSON.stringify(input ?? null);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `stub_${h.toString(16)}`;
  } catch {
    return `stub_${Date.now().toString(16)}`;
  }
}

function extractIds(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);

  // Esperado:
  // /api/moodboards/{moodboardId}/style-profiles/{styleProfileId}/prepare
  const iMoodboards = parts.indexOf("moodboards");
  const iStyleProfiles = parts.indexOf("style-profiles");

  const moodboardId = iMoodboards >= 0 ? parts[iMoodboards + 1] : undefined;
  const styleProfileId =
    iStyleProfiles >= 0 ? parts[iStyleProfiles + 1] : undefined;

  return UrlZ.parse({ moodboardId, styleProfileId });
}

export async function POST(req: Request) {
  try {
    const { moodboardId, styleProfileId } = extractIds(req);

    const payload = {
      moodboardId,
      styleProfileId,
      version: "v1.0.0-stub",
      preferences: {
        innovationLevel: 0.5,
        warmthLevel: 0.5,
        organicLevel: 0.5,
        luxuryLevel: 0.5,
      },
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(
      { ok: true, payloadHash: safeHash(payload), payload },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "PREPARE_FAILED", message: e?.message ?? String(e) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "METHOD_NOT_ALLOWED", hint: "Use POST to /prepare" },
    { status: 405 },
  );
}
