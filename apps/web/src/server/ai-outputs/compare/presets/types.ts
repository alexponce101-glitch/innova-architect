// apps/web/src/server/ai-outputs/compare/presets/types.ts

export type PresetOrigin = "engine" | "user";

export type SmartPreset = {
  id: string;
  label: string;
  icon: string; // emoji por ahora
  origin: PresetOrigin; // "engine" para auto
  confidence: number; // 0..1
  why: string[];
  pins: string[]; // PinPath (ej: "content.sections.*")
  tourId?: string; // opcional
};

// Mínimo contrato que necesitamos del compareResult
export type ComparePresetSignal = {
  // lista de pins sugeridos por el motor (lo que ya tienes)
  suggestedPins?: Array<{
    path: string;
    why?: string[];
    confidence?: number; // 0..1
    kind?: "metadata" | "content" | "model" | "input" | "other";
  }>;

  // opcional: si ya tienes contadores de cambios por zona
  zones?: {
    metadata?: number;
    content?: number;
    model?: number;
    input?: number;
    other?: number;
  };
};
