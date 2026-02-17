// apps/web/src/server/export/types.ts
import { z } from "zod";

/**
 * Formatos soportados por el export engine.
 * (Incluimos los que ya te han salido en types previos: pdf/json/png/jpeg/svg/dxf)
 */
export const ExportFormatZ = z.enum([
  "pdf",
  "json",
  "png",
  "jpeg",
  "svg",
  "dxf",
]);
export type ExportFormat = z.infer<typeof ExportFormatZ>;

/** Archivo escrito como artifact del export */
export const WrittenFileZ = z.object({
  name: z.string().min(1),
  mime: z.string().min(1),
  sha256: z.string().min(16),
  sizeBytes: z.number().int().nonnegative(),
});
export type WrittenFile = z.infer<typeof WrittenFileZ>;

export const ExportJobStatusZ = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);
export type ExportJobStatus = z.infer<typeof ExportJobStatusZ>;

export const ExportJobZ = z.object({
  id: z.string().min(1),
  outputId: z.string().min(1),

  status: ExportJobStatusZ,

  // determinístico, para smart re-export
  inputsHash: z.string().min(1).optional(),

  // artifacts
  files: z.array(WrittenFileZ).default([]),

  // smart reuse
  reusedFromExportId: z.string().min(1).optional(),

  // timestamps
  createdAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
});
export type ExportJob = z.infer<typeof ExportJobZ>;
