import { z } from "zod";

/**
 * What kind of output this is
 */
export const OutputKindZ = z.enum([
  "BRIEF",
  "STYLE_PROFILE",
  "PREPARE",
  "GENERATE",
  "REFINE",
  "EXPORT",
]);
export type OutputKind = z.infer<typeof OutputKindZ>;

/**
 * AI provider
 */
export const ProvenanceProviderZ = z.enum([
  "openai",
  "anthropic",
  "google",
  "local",
  "unknown",
]);
export type ProvenanceProvider = z.infer<typeof ProvenanceProviderZ>;

/**
 * Provenance record for an output
 */
export const OutputProvenanceZ = z.object({
  outputId: z.string().min(1),
  moodboardId: z.string(),
  kind: OutputKindZ,
  version: z.string(),
  parentOutputId: z.string().min(1).optional(),
  createdAt: z.string(), // ISO
  inputs: z.object({
    briefHash: z.string().optional(),
    styleProfileHash: z.string().optional(),
    moodboardHash: z.string().optional(),
    signalsHash: z.string().optional(),
  }),
  model: z.string().optional(),
  provider: ProvenanceProviderZ.optional(),
  promptHash: z.string().optional(),
  systemVersion: z.string(),
  notes: z.string().optional(),
});
export type OutputProvenance = z.infer<typeof OutputProvenanceZ>;

/**
 * Minimal node for lineage graph
 */
export const LineageNodeZ = z.object({
  outputId: z.string().uuid(),
  parentOutputId: z.string().uuid().optional(),
  kind: OutputKindZ,
  version: z.string(),
  createdAt: z.string(),
});
export type LineageNode = z.infer<typeof LineageNodeZ>;
