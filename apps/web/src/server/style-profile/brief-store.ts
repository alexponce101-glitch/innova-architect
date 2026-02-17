import type { DesignBrief, PromptPack } from "./brief-engine";

type BriefRecord = { brief: DesignBrief; promptPack: PromptPack };

const g = globalThis as any;

const briefs: Map<string, BriefRecord> = g.__briefs ?? (g.__briefs = new Map());

export function dbUpsertBrief(styleProfileId: string, record: BriefRecord) {
  briefs.set(styleProfileId, record);
}

export function dbGetBrief(styleProfileId: string) {
  return briefs.get(styleProfileId) ?? null;
}
