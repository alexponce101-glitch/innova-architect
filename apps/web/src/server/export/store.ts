// apps/web/src/server/export/store.ts
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { ExportJob } from "./types";
import { ExportJobZ } from "./types";

/**
 * Repo root robusto: soporta cwd en:
 * - repo root
 * - apps/web
 * - apps/web/apps/web
 */
function repoRootFromCwd() {
  const cwd = path.resolve(process.cwd());

  const tail1 = path.join("apps", "web");
  const tail2 = path.join("apps", "web", "apps", "web");

  if (cwd.endsWith(tail2)) return path.resolve(cwd, "..", "..", "..", "..");
  if (cwd.endsWith(tail1)) return path.resolve(cwd, "..", "..");

  return cwd;
}

function exportsDirCanonicalAbs() {
  const repoRoot = repoRootFromCwd();
  return path.join(repoRoot, "apps", "web", ".data", "exports");
}

function exportsDirDriftAbs() {
  const repoRoot = repoRootFromCwd();
  return path.join(repoRoot, "apps", "web", "apps", "web", ".data", "exports");
}

/**
 * Read candidates:
 * - canonical
 * - drift (legacy)
 */
function exportsDirCandidatesRead() {
  return [exportsDirCanonicalAbs(), exportsDirDriftAbs()];
}

/**
 * Write targets:
 * - ALWAYS canonical
 * - ALSO drift if it already exists (to keep old runtime paths consistent)
 *
 * This prevents "reused=false" due to jobs being written in the other folder.
 */
function exportsDirTargetsWrite() {
  const canonical = exportsDirCanonicalAbs();
  const drift = exportsDirDriftAbs();

  const targets = [canonical];

  // si drift ya existe (o si el parent existe), hacemos dual-write
  try {
    if (fsSync.existsSync(drift)) targets.push(drift);
  } catch {
    // ignore
  }

  return targets;
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

function jobFileAbs(dirAbs: string, exportId: string) {
  return path.join(dirAbs, `${exportId}.json`);
}

/**
 * Update (write) the export job as JSON file.
 * Strong: validates with ExportJobZ.
 *
 * Dual-write (canonical + optional drift) to avoid cwd drift bugs.
 */
export async function dbUpdateExportJob(job: ExportJob): Promise<ExportJob> {
  const parsed = ExportJobZ.parse(job);

  const targets = exportsDirTargetsWrite();
  await Promise.all(targets.map((d) => ensureDir(d)));

  const payload = JSON.stringify(parsed, null, 2) + "\n";

  await Promise.all(
    targets.map((dir) =>
      fs.writeFile(jobFileAbs(dir, parsed.id), payload, "utf8"),
    ),
  );

  return parsed;
}

/**
 * Get a job by id. (reads from canonical OR drift)
 */
export async function dbGetExportJob(
  exportId: string,
): Promise<ExportJob | null> {
  const id = String(exportId ?? "").trim();
  if (!id) return null;

  for (const dir of exportsDirCandidatesRead()) {
    try {
      const p = jobFileAbs(dir, id);
      const txt = await fs.readFile(p, "utf8");
      return ExportJobZ.parse(JSON.parse(txt));
    } catch {
      // try next
    }
  }

  return null;
}

/**
 * Finds the most recent SUCCEEDED ExportJob by inputsHash.
 * Strong: returns ExportJob parsed by ExportJobZ (real job), not "like".
 *
 * IMPORTANT: scans both canonical + drift dirs to survive historical cwd drift.
 */
export async function dbFindSucceededExportByInputsHash(
  inputsHash: string,
): Promise<ExportJob | null> {
  const target = String(inputsHash ?? "").trim();
  if (!target) return null;

  let best: ExportJob | null = null;
  let bestTime = -1;

  for (const dir of exportsDirCandidatesRead()) {
    let entries: any[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // dir may not exist
    }

    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (!String(ent.name).toLowerCase().endsWith(".json")) continue;

      const p = path.join(dir, ent.name);

      try {
        const raw = JSON.parse(await fs.readFile(p, "utf8"));
        const job = ExportJobZ.parse(raw);

        if (job.status !== "SUCCEEDED") continue;
        if (job.inputsHash !== target) continue;

        const t = Date.parse(job.finishedAt ?? job.createdAt ?? "");
        const time = Number.isFinite(t) ? t : 0;

        if (time >= bestTime) {
          best = job;
          bestTime = time;
        }
      } catch {
        // ignore bad files
      }
    }
  }

  return best;
}
