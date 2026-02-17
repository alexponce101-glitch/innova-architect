// apps/web/src/server/ai-jobs/store.ts
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";

export type AiGenerationJob = {
  id: string;
  moodboardId: string;
  payloadVersion: string;
  payloadHash: string;
  payloadJson: unknown;
  status: JobStatus;
  provider?: string;
  model?: string;
  outputJson?: unknown;
  errorJson?: unknown;
  tokensIn?: number;
  tokensOut?: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type StoreShape = { jobs: AiGenerationJob[] };

// ---- Simple in-process write lock ----
let writeLock: Promise<void> = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return (
    crypto.randomUUID?.() ??
    crypto
      .createHash("sha1")
      .update(String(Date.now()) + Math.random())
      .digest("hex")
  );
}

/**
 * ✅ Ruta estable:
 * - Si cwd termina en apps/web -> usamos cwd/.data
 * - Si no -> usamos <repoRoot>/apps/web/.data
 */
function getWebAppDir() {
  const cwd = process.cwd().replace(/\\/g, "/");
  const parts = cwd.split("/");
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];

  const isInsideAppsWeb = last === "web" && prev === "apps";
  return isInsideAppsWeb
    ? process.cwd()
    : path.join(process.cwd(), "apps", "web");
}

const WEB_DIR = getWebAppDir();
const DATA_DIR = path.join(WEB_DIR, ".data");
const FILE_PATH = path.join(DATA_DIR, "ai_generation_jobs.json");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadStore(): Promise<StoreShape> {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoreShape;
    const normalized = parsed?.jobs ? parsed : { jobs: [] };
    return normalized;
  } catch {
    const empty: StoreShape = { jobs: [] };
    await fs.writeFile(FILE_PATH, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
}

async function saveStore(next: StoreShape) {
  writeLock = writeLock.then(async () => {
    await ensureDataDir();
    await fs.writeFile(FILE_PATH, JSON.stringify(next, null, 2), "utf8");
  });
  await writeLock;
}

// ---- Public db* API ----

export async function dbFindSucceededByHash(
  moodboardId: string,
  payloadHash: string,
) {
  const store = await loadStore();
  return (
    store.jobs
      .filter(
        (j) =>
          j.moodboardId === moodboardId &&
          j.payloadHash === payloadHash &&
          j.status === "SUCCEEDED",
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
  );
}

export async function dbCreateAiJob(args: {
  moodboardId: string;
  payloadVersion: string;
  payloadHash: string;
  payloadJson: unknown;
  provider?: string;
  model?: string;
}) {
  const store = await loadStore();

  const existing =
    store.jobs
      .filter(
        (j) =>
          j.moodboardId === args.moodboardId &&
          j.payloadHash === args.payloadHash,
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;

  if (existing) return existing;

  const job: AiGenerationJob = {
    id: newId(),
    moodboardId: args.moodboardId,
    payloadVersion: args.payloadVersion,
    payloadHash: args.payloadHash,
    payloadJson: args.payloadJson,
    status: "RUNNING",
    provider: args.provider,
    model: args.model,
    startedAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await saveStore({ jobs: [job, ...store.jobs] });
  return job;
}

export async function dbMarkAiJobSucceeded(
  jobId: string,
  args: { outputJson: unknown; tokensIn?: number; tokensOut?: number },
) {
  const store = await loadStore();
  const idx = store.jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) throw new Error(`AiGenerationJob not found: ${jobId}`);

  const prev = store.jobs[idx]!;
  const updated: AiGenerationJob = {
    ...prev,
    status: "SUCCEEDED",
    outputJson: args.outputJson,
    tokensIn: args.tokensIn,
    tokensOut: args.tokensOut,
    finishedAt: nowIso(),
    updatedAt: nowIso(),
  };

  const nextJobs = [...store.jobs];
  nextJobs[idx] = updated;
  await saveStore({ jobs: nextJobs });
  return updated;
}

export async function dbMarkAiJobFailed(jobId: string, errorJson: unknown) {
  const store = await loadStore();
  const idx = store.jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) throw new Error(`AiGenerationJob not found: ${jobId}`);

  const prev = store.jobs[idx]!;
  const updated: AiGenerationJob = {
    ...prev,
    status: "FAILED",
    errorJson,
    finishedAt: nowIso(),
    updatedAt: nowIso(),
  };

  const nextJobs = [...store.jobs];
  nextJobs[idx] = updated;
  await saveStore({ jobs: nextJobs });
  return updated;
}

export async function dbListAiJobs(moodboardId: string, limit = 20) {
  const store = await loadStore();
  return store.jobs
    .filter((j) => j.moodboardId === moodboardId)
    .slice(0, limit);
}

export async function dbGetAiJob(jobId: string) {
  const store = await loadStore();
  return store.jobs.find((j) => j.id === jobId) ?? null;
}

// ...tu código existente...

// ---- Regenerate from job (by payloadHash) ----

export async function dbFindLatestJobByPayloadHash(
  moodboardId: string,
  payloadHash: string,
) {
  const store = await loadStore();
  const matches = store.jobs
    .filter(
      (j: AiGenerationJob) =>
        j.moodboardId === moodboardId && j.payloadHash === payloadHash,
    )
    .sort((a: AiGenerationJob, b: AiGenerationJob) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  return matches[0] ?? null;
}

export async function dbRegenerateAiJobFromPayloadHash(
  moodboardId: string,
  payloadHash: string,
) {
  const source = await dbFindLatestJobByPayloadHash(moodboardId, payloadHash);
  if (!source) return null;

  const createdAt = nowIso();

  const job: AiGenerationJob = {
    id: newId(),
    moodboardId,
    payloadVersion: source.payloadVersion,
    payloadHash: source.payloadHash,
    payloadJson: source.payloadJson,
    status: "QUEUED",
    provider: source.provider,
    model: source.model,
    createdAt,
    updatedAt: createdAt,
  };

  const store = await loadStore();
  await saveStore({ jobs: [job, ...store.jobs] });

  return job;
}
