// apps/web/src/server/export/paths.ts
import path from "path";
import fs from "fs";

/**
 * Devuelve la raíz del monorepo.
 * Soporta correr con cwd = repo root o cwd = apps/web o cwd = apps/web/apps/web
 */
export function repoRootFromCwd() {
  const cwd = path.resolve(process.cwd());

  const tail1 = path.join("apps", "web");
  const tail2 = path.join("apps", "web", "apps", "web");

  // Caso bug: .../<repo>/apps/web/apps/web
  if (cwd.endsWith(tail2)) return path.resolve(cwd, "..", "..", "..", "..");

  // Caso ideal: .../<repo>/apps/web
  if (cwd.endsWith(tail1)) return path.resolve(cwd, "..", "..");

  // Caso: .../<repo>
  return cwd;
}

function firstExisting(candidates: string[]) {
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  // fallback determinístico
  return candidates[0]!;
}

/** Canonical (donde SIEMPRE escribimos) */
export function exportFilesDirWriteAbs() {
  const repoRoot = repoRootFromCwd();
  return path.join(repoRoot, "apps", "web", ".data", "export-files");
}

/** Read (acepta drift histórico si existe) */
export function exportFilesDirReadAbs() {
  const repoRoot = repoRootFromCwd();
  const canonical = path.join(repoRoot, "apps", "web", ".data", "export-files");
  const drift = path.join(
    repoRoot,
    "apps",
    "web",
    "apps",
    "web",
    ".data",
    "export-files",
  );
  return firstExisting([canonical, drift]);
}

/** Directorio absoluto del exportId (WRITE) */
export function exportDirAbs(exportId: string) {
  return path.join(exportFilesDirWriteAbs(), exportId);
}

/** Path absoluto de un archivo dentro del exportId (WRITE) */
export function exportFileAbs(exportId: string, name: string) {
  return path.join(exportDirAbs(exportId), name);
}

/** Path absoluto para LEER artifacts (acepta drift) */
export function exportFileAbsRead(exportId: string, name: string) {
  return path.join(exportFilesDirReadAbs(), exportId, name);
}
