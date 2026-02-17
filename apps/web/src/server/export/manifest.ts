import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { sha256File } from "../hash/sha256";

export async function readExportManifest(
  exportDirAbs: string,
): Promise<ExportManifest> {
  const manifestPath = path.join(exportDirAbs, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf-8");
  const parsed = ExportManifestZ.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error("Invalid export manifest.json: " + parsed.error.message);
  }
  return parsed.data;
}

export async function writeExportManifest(
  exportDirAbs: string,
  manifest: ExportManifest,
): Promise<void> {
  const manifestPath = path.join(exportDirAbs, "manifest.json");
  // Validación antes de escribir (evita manifest corrupto)
  const parsed = ExportManifestZ.safeParse(manifest);
  if (!parsed.success) {
    throw new Error(
      "Refusing to write invalid manifest.json: " + parsed.error.message,
    );
  }
  await fs.writeFile(
    manifestPath,
    JSON.stringify(parsed.data, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Llena manifest.checksums con los archivos del export folder.
 * Evita el “checksum circular”:
 *  1) calcula checksums de todo EXCEPTO manifest.json
 *  2) escribe manifest
 *  3) calcula checksum del manifest final y lo agrega
 *  4) re-escribe manifest
 */
export async function writeManifestWithChecksums(
  exportDirAbs: string,
): Promise<ExportManifest> {
  const manifestPath = path.join(exportDirAbs, "manifest.json");

  // 1) leer manifest actual
  const manifest = await readExportManifest(exportDirAbs);

  // 2) listar archivos (solo files) y calcular checksums sin manifest.json
  const entries = await fs.readdir(exportDirAbs, { withFileTypes: true });
  const fileNames = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => n !== "manifest.json")
    .sort();

  const checksums: Record<string, string> = {};
  for (const name of fileNames) {
    checksums[name] = await sha256File(path.join(exportDirAbs, name));
  }

  // 3) escribir manifest con checksums parciales
  const updated1: ExportManifest = { ...manifest, checksums };
  await writeExportManifest(exportDirAbs, updated1);

  // 4) checksum del manifest ya final
  const manifestChecksum = await sha256File(manifestPath);

  const updated2: ExportManifest = {
    ...updated1,
    checksums: { ...updated1.checksums, "manifest.json": manifestChecksum },
  };

  // 5) escribir manifest final
  await writeExportManifest(exportDirAbs, updated2);

  return updated2;
}

export const ExportManifestZ = z.object({
  innovaArchitectVersion: z.string(),
  exportId: z.string().uuid(),
  outputId: z.string().uuid(),

  lineage: z
    .array(
      z.object({
        outputId: z.string().min(1), // ✅ tolerante a legacy / non-uuid
        version: z.string(),
        kind: z.string(),
        createdAt: z.string(),
      }),
    )
    .default([]),

  createdAt: z.string(),
  checksums: z.record(z.string(), z.string()),
});
export type ExportManifest = z.infer<typeof ExportManifestZ>;
