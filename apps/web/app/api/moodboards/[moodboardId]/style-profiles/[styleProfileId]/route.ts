import { NextResponse } from "next/server";

import {
  dbGetStyleProfile,
  dbUpdateStyleProfile,
} from "../../../../../../src/server/style-profile/store";
import { bumpPatchVersion } from "../../../../../../src/server/style-profile/engine";
import {
  StyleProfileZ,
  StyleProfilePatch,
} from "../../../../../../src/server/style-profile/validators";

function nowIso() {
  return new Date().toISOString();
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ moodboardId: string; styleProfileId: string }> },
) {
  const { styleProfileId } = await ctx.params;

  const profile = dbGetStyleProfile(styleProfileId);
  if (!profile)
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json(profile, { status: 200 });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ moodboardId: string; styleProfileId: string }> },
) {
  const { styleProfileId } = await ctx.params;

  const prev = dbGetStyleProfile(styleProfileId);
  if (!prev) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (prev.status === "locked")
    return NextResponse.json({ error: "PROFILE_LOCKED" }, { status: 409 });

  const body = await req.json().catch(() => null);
  const parsed = StyleProfilePatch.safeParse(body);

  // ✅ aquí era el error: debe ser !parsed.success
  if (!parsed.success) {
    return NextResponse.json(
      { error: "BAD_REQUEST", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // ✅ ya estamos en success=true
  const patchData = parsed.data as any;
  const now = nowIso();
  const reason = patchData.editReason ?? "";

  const next: any = {
    ...prev,

    // merge explícito por secciones (evita spreads raros)
    preferencesNormalized: {
      ...(prev.preferencesNormalized ?? {}),
      ...(patchData.preferencesNormalized ?? {}),
    },

    preferences: {
      ...((prev as any).preferences ?? {}),
      ...(patchData.preferences ?? {}),
    },

    constraints: {
      ...(prev.constraints ?? {}),
      ...(patchData.constraints ?? {}),
    },

    signals: {
      ...(prev.signals ?? {}),
      ...(patchData.signals ?? {}),
    },

    // si vienen estos campos top-level, aplícalos
    primaryStyle: patchData.primaryStyle ?? prev.primaryStyle,
    secondaryStyles: patchData.secondaryStyles ?? prev.secondaryStyles,

    updatedAt: now,
    version: bumpPatchVersion(prev.version),
  };

  // --- userEdits ---
  const edits: Array<{
    at: string;
    path: string;
    from: any;
    to: any;
    reason?: string;
  }> = [];

  if (patchData.primaryStyle) {
    edits.push({
      at: now,
      path: "primaryStyle",
      from: prev.primaryStyle,
      to: next.primaryStyle,
      reason,
    });
  }

  if (patchData.secondaryStyles) {
    edits.push({
      at: now,
      path: "secondaryStyles",
      from: prev.secondaryStyles,
      to: next.secondaryStyles,
      reason,
    });
  }

  if (patchData.preferences) {
    edits.push({
      at: now,
      path: "preferences",
      from: (prev as any).preferences,
      to: next.preferences,
      reason,
    });
  }

  if (patchData.preferencesNormalized?.innovationLevel !== undefined) {
    edits.push({
      at: now,
      path: "preferencesNormalized.innovationLevel",
      from: prev.preferencesNormalized?.innovationLevel,
      to: next.preferencesNormalized?.innovationLevel,
      reason,
    });
  }

  if (patchData.constraints) {
    edits.push({
      at: now,
      path: "constraints",
      from: prev.constraints,
      to: next.constraints,
      reason,
    });
  }

  next.userEdits = [...edits, ...(prev.userEdits ?? [])].slice(0, 200);

  // --- validación final y persistencia ---
  const validated = StyleProfileZ.parse(next);
  dbUpdateStyleProfile(styleProfileId, validated);

  return NextResponse.json(validated, { status: 200 });
}
