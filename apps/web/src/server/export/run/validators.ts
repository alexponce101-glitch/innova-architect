// apps/web/src/server/export/run/validators.ts
import { z } from "zod";
import { ExportRequestZ } from "../validators";

/**
 * Body del endpoint POST /api/exports/run
 * Compatibilidad total con Sprint I:
 * - outputId requerido
 * - request opcional (overrides)
 * - systemVersion opcional
 */
export const RunExportBodyZ = z.object({
  outputId: z.string().uuid(),
  request: z.unknown().optional(),
  systemVersion: z.string().optional(),
});

export type RunExportBody = z.infer<typeof RunExportBodyZ>;

/**
 * Normaliza + aplica defaults de request para este endpoint.
 * Default base: json + includeManifest true.
 */
export function normalizeRunExportBody(input: unknown) {
  const parsed = RunExportBodyZ.parse(input);

  const request = ExportRequestZ.parse({
    format: "json",
    includeManifest: true,
    ...(typeof parsed.request === "object" && parsed.request
      ? (parsed.request as any)
      : {}),
  });

  return { ...parsed, request };
}
