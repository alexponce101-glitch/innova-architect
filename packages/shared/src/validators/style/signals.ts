export type StyleSignalKey = 'innovationLevel' | 'warmthLevel' | 'organicLevel' | 'luxuryLevel';
// | "complexityLevel"
// | "sustainabilityWeight"
export const STYLE_SIGNAL_META: Record<
  StyleSignalKey,
  { label: string; min: number; max: number; step: number }
> = {
  innovationLevel: { label: 'Nivel de innovación', min: 0, max: 1, step: 0.05 },
  warmthLevel: { label: 'Nivel de calidez', min: 0, max: 1, step: 0.05 },
  organicLevel: { label: 'Nivel orgánico', min: 0, max: 1, step: 0.05 },
  luxuryLevel: { label: 'Nivel de lujo', min: 0, max: 1, step: 0.05 },
};
