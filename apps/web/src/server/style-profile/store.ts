import type { StyleProfile } from "../../../../../packages/shared/src/validators/style-profile";

const g = globalThis as any;

const styleProfiles: Map<string, any> =
  g.__styleProfiles ?? (g.__styleProfiles = new Map());

const byMoodboard: Map<string, string[]> = // moodboardId -> [styleProfileId]
  g.__byMoodboard ?? (g.__byMoodboard = new Map());

export function dbInsertStyleProfile(p: StyleProfile) {
  styleProfiles.set(p.id, p);
  const list = byMoodboard.get(p.moodboardId) ?? [];
  byMoodboard.set(p.moodboardId, [p.id, ...list]);
}

export function dbGetStyleProfile(id: string) {
  return styleProfiles.get(id) ?? null;
}

export function dbListStyleProfilesByMoodboard(moodboardId: string) {
  const ids = byMoodboard.get(moodboardId) ?? [];
  return ids
    .map((id) => styleProfiles.get(id))
    .filter((p): p is StyleProfile => Boolean(p));
}

export function dbUpdateStyleProfile(id: string, next: StyleProfile) {
  styleProfiles.set(id, next);
}
