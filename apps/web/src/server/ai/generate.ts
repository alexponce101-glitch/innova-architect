import { hashPayload } from "./hash";
import { AiOutputV1Z } from "./output/schema";
import {
  dbCreateAiJob,
  dbFindSucceededByHash,
  dbMarkAiJobFailed,
  dbMarkAiJobSucceeded,
} from "../ai-jobs/store";

import {
  dbGetStyleProfile,
  dbInsertStyleProfile,
} from "../style-profile/store";
import { generateStyleProfileDraft } from "../style-profile/engine";

import { dbGetBrief, dbUpsertBrief } from "../style-profile/brief-store";

import { dbCreateAiOutput, dbFindLatestAiOutput } from "../ai-outputs/store";
import { diffJson } from "../ai-outputs/diff";

import { bump } from "../ai-outputs/versioning";

// ✅ AJUSTA ESTE IMPORT A TU FUNCIÓN REAL DE SPRINT C
// Ejemplo: buildPromptPayload(moodboardId) o preparePromptPayload(moodboardId)
import {
  buildStyleProfileSummary,
  buildPromptPayload, // <-- ajusta ruta/nombre
} from "../style-profile/intelligence";

const PROVIDER = "openai";
const MODEL = "gpt-4.1-mini";

// Stub controlado: luego lo conectamos al provider real.
// Debe regresar JSON parseable por AiOutputV1Z.
async function runModel(payload: any) {
  const now = new Date().toISOString();
  const fake = {
    version: "1.0",
    summary: {
      style_name: "Modern Warm Minimal",
      one_liner: "Limpio, cálido y funcional.",
      confidence: 0.78,
    },
    style_profile: {
      innovation_level: payload?.signals?.innovation_level ?? 0.5,
      keywords: ["clean", "warm"],
      do: ["Materiales naturales"],
      dont: ["Saturación"],
    },
    recommendations: {
      materials: ["madera clara", "concreto"],
      colors: ["blanco roto", "arena"],
      lighting: ["indirecta cálida"],
    },
    rationale: {
      based_on: {
        tags: payload?.tags ?? [],
        notes: payload?.notes ?? [],
        signals: payload?.signals ? Object.keys(payload.signals) : [],
      },
      explanation: "Derivado de tu payload v1.0 (audit-able).",
    },
    audit: {
      payload_hash: "REPLACE_ME",
      prompt_version: payload?.prompt_version ?? "1.0",
      generated_at: now,
      model: MODEL,
    },
  };
  return {
    output: fake,
    tokensIn: undefined as number | undefined,
    tokensOut: undefined as number | undefined,
  };
}

function toViewerOutput(args: {
  parsed: any;
  moodboardId: string;
  hash: string;
  jobId: string;
  provider: string;
  model: string;
  promptVersion: string;
  startedAtIso: string;
}) {
  const generatedAt =
    args.parsed?.audit?.generated_at ?? new Date().toISOString();

  // Convertimos el output V1 en secciones legibles
  const sections = [
    {
      title: "Resumen",
      content:
        `**Estilo:** ${args.parsed?.summary?.style_name ?? "—"}\n\n` +
        `${args.parsed?.summary?.one_liner ?? ""}\n\n` +
        `**Confianza:** ${args.parsed?.summary?.confidence ?? "—"}`,
    },
    {
      title: "Perfil de estilo",
      content:
        `**Innovación:** ${args.parsed?.style_profile?.innovation_level ?? "—"}\n\n` +
        `**Keywords:** ${(args.parsed?.style_profile?.keywords ?? []).join(", ") || "—"}\n\n` +
        `**Do:** ${(args.parsed?.style_profile?.do ?? []).join(" • ") || "—"}\n\n` +
        `**Don't:** ${(args.parsed?.style_profile?.dont ?? []).join(" • ") || "—"}`,
    },
    {
      title: "Recomendaciones",
      content:
        `**Materiales:** ${(args.parsed?.recommendations?.materials ?? []).join(" • ") || "—"}\n\n` +
        `**Colores:** ${(args.parsed?.recommendations?.colors ?? []).join(" • ") || "—"}\n\n` +
        `**Iluminación:** ${(args.parsed?.recommendations?.lighting ?? []).join(" • ") || "—"}`,
    },
    {
      title: "Razonamiento",
      content: args.parsed?.rationale?.explanation ?? "—",
    },
  ];

  return {
    interpretedContext: {
      projectType: "—",
      style: args.parsed?.summary?.style_name ?? "—",
      innovationLevel:
        typeof args.parsed?.style_profile?.innovation_level === "number"
          ? args.parsed.style_profile.innovation_level
          : undefined,
      constraints: args.parsed?.rationale?.based_on?.tags ?? [],
      notes:
        "Derivado del payload audit-able + señales del brief/style profile.",
    },
    sections,
    metadata: {
      model: args.model,
      hash: args.hash,
      version: args.promptVersion,
      generatedAt,
      jobId: args.jobId,
      durationMs: Date.now() - new Date(args.startedAtIso).getTime(),
    },
  };
}

export async function generateAiControlled(args: {
  moodboardId: string;
  force?: boolean;
  refinement?: {
    baseOutputId: string;
    instructions: string;
    level?: "patch" | "minor" | "major";
  };
}) {
  const startedAtIso = new Date().toISOString();
  const moodboardId = args.moodboardId;

  // 1) StyleProfile (auto-healing)
  let styleProfile = await dbGetStyleProfile(moodboardId);
  if (!styleProfile) {
    const draft = generateStyleProfileDraft(moodboardId);
    await dbInsertStyleProfile(draft);
    styleProfile = draft;
  }

  const styleProfileId = (styleProfile as any).id ?? moodboardId;

  // 2) Brief (fallback suave, store indexado por styleProfileId)
  let briefRec = await dbGetBrief(styleProfileId);

  if (!briefRec) {
    const nowIso = new Date().toISOString();

    const draftBrief = {
      id: `brief_${styleProfileId}`,
      moodboardId,
      createdAt: nowIso,
      notes: [],
    } as any;

    const draftPromptPack = {
      prompt_version: "1.0",
    } as any;

    dbUpsertBrief(styleProfileId, {
      brief: draftBrief,
      promptPack: draftPromptPack,
    });
    briefRec = { brief: draftBrief, promptPack: draftPromptPack };
  }

  // Ya tenemos brief
  const brief = briefRec.brief;

  // buildStyleProfileSummary espera IDs + preferences (mínimo)
  const summary = buildStyleProfileSummary({
    briefId: (brief as any).id ?? `brief_${styleProfileId}`,
    moodboardId,
    styleProfileId,
    preferences: {},

    // opcionales (puedes dejarlos fuera si quieres)
    // locale: "en",
    // topTags: undefined,
    // assetsCount: undefined,
    // keywords: undefined,
  });

  const basePayload = buildPromptPayload({ summary });

  // ✅ IMPORTANTÍSIMO: si hay refinement, debe entrar al payload ANTES del hash
  const payload = args.refinement
    ? { ...basePayload, refinement: args.refinement }
    : basePayload;

  // hash SIEMPRE después de payload
  const { hash } = hashPayload(payload);

  if (!args.force) {
    const hit = await dbFindSucceededByHash(args.moodboardId, hash);
    if (hit?.outputJson) {
      return {
        reused: true,
        payloadHash: hash,
        jobId: hit.id,
        output: hit.outputJson, // 👈 YA es AiGenerationOutput
      };
    }
  }

  const job = await dbCreateAiJob({
    moodboardId: args.moodboardId,
    payloadVersion: (payload as any)?.prompt_version ?? "1.0",
    payloadHash: hash,
    payloadJson: payload,
    provider: PROVIDER,
    model: MODEL,
  });

  try {
    const res = await runModel(payload);

    // Inject audit fields and validate
    const merged = {
      ...(res.output as any),
      audit: {
        ...((res.output as any)?.audit ?? {}),
        payload_hash: hash,
        prompt_version: (payload as any)?.prompt_version ?? "1.0",
        model: MODEL,
        generated_at: new Date().toISOString(),
      },
    };

    const parsed = AiOutputV1Z.parse(merged);

    const viewer = toViewerOutput({
      parsed,
      moodboardId: args.moodboardId,
      hash,
      jobId: job.id,
      provider: PROVIDER,
      model: MODEL,
      promptVersion: (payload as any)?.prompt_version ?? "1.0",
      startedAtIso,
    });

    // 1) Marcar job como exitoso
    const succeeded = await dbMarkAiJobSucceeded(job.id, {
      outputJson: viewer,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
    });

    // 2) Versionado / Parent / Kind
    const prevOutput = await dbFindLatestAiOutput(job.moodboardId);

    const version = prevOutput
      ? bump(prevOutput.version, args.refinement?.level ?? "patch")
      : "1.0.0";

    const parentOutputId = args.refinement?.baseOutputId ?? prevOutput?.id;

    const kind = args.refinement ? "REFINE" : "GENERATE";

    // 3) Diff (si hay parent real)
    const diffFromParentJson =
      parentOutputId && prevOutput
        ? diffJson(prevOutput.outputJson, succeeded.outputJson)
        : undefined;

    // 4) Persistencia AiOutput (Sprint F)
    await dbCreateAiOutput({
      moodboardId: job.moodboardId,
      styleProfileId,
      briefId: (brief as any).id ?? `brief_${styleProfileId}`,

      version,
      parentOutputId,
      kind,

      payloadVersion: job.payloadVersion,
      promptHash: job.payloadHash,
      provider: job.provider ?? PROVIDER,
      model: job.model ?? MODEL,

      tokensIn: succeeded.tokensIn,
      tokensOut: succeeded.tokensOut,

      inputSnapshotJson: job.payloadJson,
      outputJson: succeeded.outputJson,
      diffFromParentJson,
    });

    // 5) Respuesta (no cambia contrato)
    return {
      reused: false,
      payloadHash: hash,
      jobId: job.id,
      output: viewer,
    }; // <- fin del return
  } catch (err: any) {
    await dbMarkAiJobFailed(job.id, {
      message: err?.message ?? "AI generation failed",
      stack: err?.stack ?? null,
    });
    throw err;
  }
}
