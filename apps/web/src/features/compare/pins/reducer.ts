import type { CompareRowId, Pin, PinnedAction, PinnedStateV1 } from "./types";

export function makeEmptyPinnedState(compareSessionKey: string): PinnedStateV1 {
  return { version: 1, compareSessionKey, pinsById: {} };
}

function clone<T extends object>(obj: T): T {
  return { ...(obj as any) };
}

export function pinnedReducer(
  state: PinnedStateV1,
  action: PinnedAction,
): PinnedStateV1 {
  switch (action.type) {
    case "PIN_ADD": {
      const next = clone(state);
      next.pinsById = clone(state.pinsById);
      next.pinsById[action.pin.rowId] = action.pin;
      return next;
    }
    case "PIN_REMOVE": {
      const next = clone(state);
      if (!next.pinsById[action.rowId]) return state;
      next.pinsById = clone(state.pinsById);
      delete next.pinsById[action.rowId];
      return next;
    }
    case "PIN_TOGGLE": {
      const exists = !!state.pinsById[action.pin.rowId];
      return exists
        ? pinnedReducer(state, { type: "PIN_REMOVE", rowId: action.pin.rowId })
        : pinnedReducer(state, { type: "PIN_ADD", pin: action.pin });
    }
    case "PIN_CLEAR_ALL": {
      if (Object.keys(state.pinsById).length === 0) return state;
      return { ...state, pinsById: {} };
    }
    case "PIN_BULK_SET": {
      const pinsById: Record<string, Pin> = {};
      for (const p of action.pins) pinsById[p.rowId] = p;
      return { ...state, pinsById };
    }
    default:
      return state;
  }
}

export function isPinned(state: PinnedStateV1, rowId: CompareRowId): boolean {
  return !!state.pinsById[rowId];
}

export function pinnedCount(state: PinnedStateV1): number {
  return Object.keys(state.pinsById).length;
}

export function pinnedList(state: PinnedStateV1): Pin[] {
  return Object.values(state.pinsById).sort(
    (a, b) => b.updatedAtMs - a.updatedAtMs,
  );
}
