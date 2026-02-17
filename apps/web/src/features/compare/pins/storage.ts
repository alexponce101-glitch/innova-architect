import { z } from "zod";
import type { PinnedStateV1 } from "./types";

export interface PinnedStorage {
  load(compareSessionKey: string): Promise<PinnedStateV1 | null>;
  save(state: PinnedStateV1): Promise<void>;
  clear(compareSessionKey: string): Promise<void>;
}

const PinZ = z.object({
  rowId: z.string(),
  pointer: z.string(),
  tone: z.enum(["changed", "added", "removed"]),
  label: z.string().optional(),
  reason: z
    .enum(["QA", "DesignReview", "PMReview", "Regression", "Other"])
    .optional(),
  createdAtMs: z.number(),
  updatedAtMs: z.number(),
});

const PinnedStateV1Z = z.object({
  version: z.literal(1),
  compareSessionKey: z.string(),
  pinsById: z.record(z.string(), PinZ),
});

function keyFor(compareSessionKey: string) {
  return `innova.compare.pins:${compareSessionKey}`;
}

export class LocalPinnedStorage implements PinnedStorage {
  async load(compareSessionKey: string) {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(keyFor(compareSessionKey));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      const v = PinnedStateV1Z.safeParse(parsed);
      if (!v.success) return null;

      // sanity: no cross-session contamination
      if (v.data.compareSessionKey !== compareSessionKey) return null;

      return v.data as PinnedStateV1;
    } catch {
      return null;
    }
  }

  async save(state: PinnedStateV1) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      keyFor(state.compareSessionKey),
      JSON.stringify(state),
    );
  }

  async clear(compareSessionKey: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(keyFor(compareSessionKey));
  }
}
