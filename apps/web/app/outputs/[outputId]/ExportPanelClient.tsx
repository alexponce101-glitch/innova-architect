"use client";

import * as React from "react";

type ExportApiResponse =
  | {
      ok?: boolean;
      exportId: string;
      files?: Array<{
        name: string;
        mime: string;
        sha256: string;
        sizeBytes: number;
      }>;
      manifestSha256?: string | null;
      reused?: boolean;
      reusedFromExportId?: string | null;
      debugId?: string;
      tookMs?: number;
    }
  | {
      ok?: boolean;
      error: string;
      message?: string;
      issues?: any;
      debugId?: string;
      tookMs?: number;
    };

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function copyText(txt: string) {
  try {
    await navigator.clipboard.writeText(txt);
  } catch {
    // ignore
  }
}

function bytesLabel(n?: number) {
  if (n == null || !Number.isFinite(n)) return "—";
  const kb = n / 1024;
  const mb = kb / 1024;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  if (kb >= 1) return `${kb.toFixed(1)} KB`;
  return `${n} B`;
}

type ExportJobView = {
  exportId: string;
  reused?: boolean;
  reusedFromExportId?: string;
  debugId?: string;
  tookMs?: number;
  files: Array<{
    name: string;
    mime: string;
    sha256: string;
    sizeBytes: number;
  }>;
  manifestSha256?: string;
};

export default function ExportPanelClient({ outputId }: { outputId: string }) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<ExportJobView | null>(null);

  async function runExport() {
    setErr(null);
    setJob(null);
    setLoading(true);

    try {
      const res = await fetch(
        `/api/outputs/${encodeURIComponent(outputId)}/export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // si mañana quieres opciones: includeManifest, format, fileName, etc.
          body: JSON.stringify({}),
        },
      );

      const json = (await safeJson(res)) as ExportApiResponse;

      if (!res.ok) {
        const msg =
          (json as any)?.message ?? (json as any)?.error ?? "Export failed";
        const dbg = (json as any)?.debugId
          ? ` (debugId: ${(json as any).debugId})`
          : "";
        throw new Error(`${msg}${dbg}`);
      }

      const ok = json as any;
      if (!ok?.exportId) throw new Error("Export response missing exportId.");

      setJob({
        exportId: String(ok.exportId),
        reused: Boolean(ok.reused),
        reusedFromExportId: ok.reusedFromExportId
          ? String(ok.reusedFromExportId)
          : undefined,
        debugId: ok.debugId ? String(ok.debugId) : undefined,
        tookMs: typeof ok.tookMs === "number" ? ok.tookMs : undefined,
        files: Array.isArray(ok.files) ? ok.files : [],
        manifestSha256: ok.manifestSha256
          ? String(ok.manifestSha256)
          : undefined,
      });
    } catch (e: any) {
      setErr(e?.message ?? "Export failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-w-[320px] max-w-[520px] space-y-2">
      <div className="flex items-center gap-2 justify-end flex-wrap">
        <button
          className={clsx(
            "px-3 py-1.5 rounded-lg border text-sm",
            loading
              ? "bg-neutral-100 border-neutral-200 text-neutral-400"
              : "bg-white border-neutral-300 hover:bg-neutral-50",
          )}
          onClick={runExport}
          disabled={loading}
          title="Run export"
        >
          {loading ? "Exporting…" : "Export"}
        </button>

        {job?.exportId ? (
          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm bg-white hover:bg-neutral-50"
            onClick={() => copyText(job.exportId)}
            title="Copy exportId"
          >
            Copy exportId
          </button>
        ) : null}
      </div>

      <div className="border border-neutral-200 rounded-xl p-3 bg-white shadow-sm space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {job ? (
            <>
              <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-green-50 text-green-700 border-green-200">
                EXPORTED
              </span>

              {job.reused ? (
                <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-blue-50 text-blue-700 border-blue-200">
                  REUSED
                </span>
              ) : (
                <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-neutral-50 text-neutral-700 border-neutral-200">
                  GENERATED
                </span>
              )}
            </>
          ) : loading ? (
            <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-neutral-50 text-neutral-700 border-neutral-200">
              RUNNING
            </span>
          ) : (
            <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-neutral-50 text-neutral-600 border-neutral-200">
              READY
            </span>
          )}

          {job?.debugId ? (
            <span className="text-xs text-neutral-500">
              debugId <span className="font-mono">{job.debugId}</span>
            </span>
          ) : null}

          {job?.tookMs != null ? (
            <span className="text-xs text-neutral-500">
              • <span className="font-mono">{job.tookMs}ms</span>
            </span>
          ) : null}
        </div>

        {err ? <div className="text-sm text-red-600">{err}</div> : null}

        {job ? (
          <div className="text-sm text-neutral-700 space-y-2">
            <div>
              exportId: <span className="font-mono">{job.exportId}</span>
              {job.reusedFromExportId ? (
                <>
                  <span className="mx-2 text-neutral-400">|</span>
                  reusedFrom:{" "}
                  <span className="font-mono">{job.reusedFromExportId}</span>
                  <button
                    className="ml-2 text-xs px-2 py-1 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
                    onClick={() => copyText(job.reusedFromExportId!)}
                    title="Copy reusedFromExportId"
                  >
                    Copy
                  </button>
                </>
              ) : null}
            </div>

            {job.files.length > 0 ? (
              <div className="border border-neutral-200 rounded-lg bg-neutral-50 p-2">
                <div className="text-xs font-semibold text-neutral-700 mb-2">
                  Files ({job.files.length})
                </div>
                <div className="space-y-1">
                  {job.files.map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-neutral-800">
                          {f.name}
                        </span>
                        <span className="ml-2 text-neutral-500">
                          {bytesLabel(f.sizeBytes)}
                        </span>
                        {f.mime ? (
                          <span className="ml-2 text-neutral-400">
                            {f.mime}
                          </span>
                        ) : null}
                      </div>
                      <button
                        className="shrink-0 text-[10px] px-2 py-1 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
                        onClick={() => copyText(f.sha256)}
                        title="Copy sha256"
                      >
                        Copy sha
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-neutral-500">
                No files listed (yet).
              </div>
            )}

            {job.manifestSha256 ? (
              <div className="text-xs text-neutral-600">
                manifestSha256:{" "}
                <span className="font-mono">{job.manifestSha256}</span>
                <button
                  className="ml-2 text-[10px] px-2 py-1 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
                  onClick={() => copyText(job.manifestSha256!)}
                  title="Copy manifest sha"
                >
                  Copy
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-neutral-500">
            Export genera artifacts (o los reusa). Cuando esté listo verás el
            exportId y archivos.
          </div>
        )}
      </div>
    </div>
  );
}
