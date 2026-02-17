// apps/web/src/server/ai-outputs/compare/autoPinsTypes.ts

export type AutoPinConfidence = "high" | "medium" | "low";

export type AutoPinEvidence = {
  kind: "diff" | "semantic" | "heuristic";
  path: string; // ejemplo: "metadata.title" / "content.sections[2].body"
  detail?: string; // micro-explicación
  score?: number; // opcional
};

export type ExplainableAutoPin = {
  key: string; // `${compareSessionKey}:${path}`
  path: string; // el pin target (ej. "metadata.*")
  label: string; // corto para UI
  confidence: AutoPinConfidence;

  reason: string; // 1 frase
  evidenceCount: number;
  evidence: AutoPinEvidence[]; // top N (ej. 5)
};

export type ExplainableAutoPinsResult = {
  compareSessionKey: string;
  generatedAt: string; // ISO
  version: "wow12@1";
  pins: ExplainableAutoPin[];
};
