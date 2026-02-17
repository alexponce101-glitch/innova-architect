"use client";

import { useEffect, useState } from "react";

type Props = {
  moodboardId: string;
};

type Job = {
  id: string;
  status: string;
  payloadHash: string;
  payloadVersion: string;
  provider?: string;
  model?: string;
  createdAt: string;
};

function fmt(x: unknown) {
  return JSON.stringify(x, null, 2);
}

export default function AiGenerationAuditPanel({ moodboardId }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsErr, setJobsErr] = useState<string | null>(null);

  async function refreshJobs() {
    setLoadingJobs(true);
    setJobsErr(null);
    try {
      const res = await fetch(
        `/api/ai/jobs?moodboardId=${encodeURIComponent(moodboardId)}&limit=10`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error ?? `jobs: ${res.status}`);
      }

      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (e: any) {
      setJobsErr(e?.message ?? "No se pudieron cargar jobs");
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }

  useEffect(() => {
    if (!moodboardId) return;
    refreshJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moodboardId]);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
      <div style={{ fontWeight: 800 }}>AI Generation (Audit)</div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
        moodboardId: {moodboardId}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={refreshJobs} disabled={loadingJobs}>
          {loadingJobs ? "Loading…" : "Refresh jobs"}
        </button>
        {jobsErr ? (
          <span style={{ color: "crimson", fontSize: 12 }}>{jobsErr}</span>
        ) : null}
      </div>

      <div style={{ marginTop: 10 }}>
        {jobs.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            No jobs yet. (Cuando generes IA aparecerán aquí.)
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {jobs.map((j) => (
              <div
                key={j.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <code style={{ fontSize: 12 }}>{j.id}</code>
                  <span style={{ fontSize: 12 }}>{j.status}</span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>
                  v{j.payloadVersion} · {j.provider ?? "—"} / {j.model ?? "—"}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>
                  {new Date(j.createdAt).toLocaleString()}
                </div>
                <div style={{ fontSize: 11, marginTop: 6 }}>
                  <span style={{ opacity: 0.7 }}>hash:</span>{" "}
                  <code style={{ fontSize: 11 }}>{j.payloadHash}</code>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* debug opcional */}
      {/* <pre style={{ marginTop: 12, fontSize: 11, whiteSpace: "pre-wrap" }}>{fmt(jobs)}</pre> */}
    </div>
  );
}
