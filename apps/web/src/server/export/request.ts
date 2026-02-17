// apps/web/src/server/export/request.ts
import { z } from "zod";

export const ExportFormatZ = z.enum([
  "pdf",
  "json",
  "png",
  "jpeg",
  "svg",
  "dxf",
]);

export const ExportRequestZ = z
  .object({
    format: ExportFormatZ.optional(),
    includeManifest: z.boolean().optional(),

    fileName: z.string().min(1).nullable().optional(),
    template: z.string().min(1).nullable().optional(),

    // dejamos options flexible (para templates futuros)
    options: z.unknown().nullable().optional(),
  })
  .strict();

export type ExportRequest = z.infer<typeof ExportRequestZ>;
