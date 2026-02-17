import type { MoodboardItem, MoodboardStateV1 } from "./types";

const KEY_V0 = "innova.moodboard.v0";
const KEY_V1 = "innova.moodboard.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeTag(label: string) {
  return label.trim().replace(/\s+/g, " ");
}

function collectTags(items: MoodboardItem[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    for (const t of it.tags ?? []) set.add(normalizeTag(t));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function loadMoodboardState(): MoodboardStateV1 {
  // Try v1 first
  const v1 = safeParse<MoodboardStateV1>(localStorage.getItem(KEY_V1));
  if (
    v1 &&
    v1.version === 1 &&
    Array.isArray(v1.items) &&
    Array.isArray(v1.tags)
  ) {
    return v1;
  }

  // Fallback v0 (array of items)
  const v0 = safeParse<MoodboardItem[]>(localStorage.getItem(KEY_V0));
  const items = Array.isArray(v0) ? v0 : [];

  // Migrate: ensure tags exists on items
  const migratedItems = items.map((it) => ({
    ...it,
    tags: Array.isArray(it.tags) ? it.tags : [],
  }));

  const state: MoodboardStateV1 = {
    version: 1,
    items: migratedItems,
    tags: collectTags(migratedItems),
    ui: { selectedTags: [], view: "grid", sort: "newest" },
  };

  // Save migration and keep v0 untouched (safe)
  try {
    localStorage.setItem(KEY_V1, JSON.stringify(state));
  } catch {
    // ignore
  }

  return state;
}

export function saveMoodboardState(state: MoodboardStateV1) {
  // normalize tag registry
  const normalizedTags = Array.from(
    new Set((state.tags ?? []).map(normalizeTag)),
  ).filter(Boolean);
  const items = (state.items ?? []).map((it) => ({
    ...it,
    tags: Array.from(new Set((it.tags ?? []).map(normalizeTag))).filter(
      Boolean,
    ),
  }));

  const next: MoodboardStateV1 = {
    ...state,
    version: 1,
    tags: normalizedTags.sort((a, b) => a.localeCompare(b)),
    items,
  };

  localStorage.setItem(KEY_V1, JSON.stringify(next));
}

export function clearMoodboard() {
  localStorage.removeItem(KEY_V0);
  localStorage.removeItem(KEY_V1);
}

// Backward-compat helpers (si todavía los usas en otro lado)
export function loadMoodboard(): MoodboardItem[] {
  return loadMoodboardState().items;
}

export function saveMoodboard(items: MoodboardItem[]) {
  const state = loadMoodboardState();
  saveMoodboardState({
    ...state,
    items,
    tags: collectTags(items),
  });
}
