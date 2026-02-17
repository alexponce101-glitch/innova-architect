"use client";

import * as React from "react";

type WrittenFile = {
  name: string;
  mime: string;
  sha256: string;
  sizeBytes: number;
};

type ExportRunResponse = {
  exportId: string;
  files: WrittenFile[];
  manifestSha256: string | null;
  reusedFromExportId: string | null;
};

export function RunExportButton({
  outputId,
  includeManifest = false,
}: {
  outputId: string;
  includeManifest?: boolean;
}) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<ExportRunResponse | null>(null);

  async function run() {
    setErr(null);
    setRes(null);
    setLoading(true);

    try {
      const r = await fetch("/api/exports/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputId,
          includeManifest,
          format: "json",
        }),
      });

      const json = (await r
        .json()
        .catch(() => ({}))) as Partial<ExportRunResponse> & {
        message?: string;
      };

      if (!r.ok) {
        throw new Error(json?.message ?? "Export failed");
      }

      setRes(json as ExportRunResponse);
    } catch (e: any) {
      setErr(e?.message ?? "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        className="px-3 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-sm"
        onClick={run}
        disabled={loading}
      >
        {loading ? "Exporting…" : "Run Export"}
      </button>

      {err ? <div className="text-sm text-red-600">{err}</div> : null}

      {res ? (
        <div className="border border-neutral-200 rounded-xl p-3 bg-white shadow-sm space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm">
              <span className="text-neutral-500">exportId:</span>{" "}
              <span className="font-mono">{res.exportId}</span>
            </div>

            {res.reusedFromExportId ? (
              <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-blue-50 text-blue-700 border-blue-200">
                REUSED
              </span>
            ) : (
              <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-neutral-50 text-neutral-700 border-neutral-200">
                GENERATED
              </span>
            )}
          </div>

          {res.reusedFromExportId ? (
            <div className="text-xs text-neutral-600">
              Reused from:{" "}
              <span className="font-mono">{res.reusedFromExportId}</span>
            </div>
          ) : null}

          <div className="text-xs text-neutral-600">
            Files: <span className="font-mono">{res.files?.length ?? 0}</span>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              className="text-xs px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50"
              onClick={() => navigator.clipboard.writeText(res.exportId)}
              title="Copy exportId"
            >
              Copy exportId
            </button>

            {res.reusedFromExportId ? (
              <button
                className="text-xs px-2 py-1 rounded border border-neutral-300 bg-white hover:bg-neutral-50"
                onClick={() =>
                  navigator.clipboard.writeText(res.reusedFromExportId!)
                }
                title="Copy reusedFromExportId"
              >
                Copy reusedFrom
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
