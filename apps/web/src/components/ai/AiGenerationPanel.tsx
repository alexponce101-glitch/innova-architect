"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import AiOutputViewer, { AiGenerationOutput } from "./AiOutputViewer";

import VersionHistoryPanel from "./VersionHistoryPanel";

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

  payloadJson?: unknown;
  outputJson?: unknown;
  errorJson?: unknown;
};

export default function AiGenerationPanel({ moodboardId }: Props) {
  // ---- Output (Sprint E)
  const [isGenerating, setIsGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [output, setOutput] = useState<AiGenerationOutput | null>(null);

  // ---- Jobs Audit (Sprint D/E)
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsErr, setJobsErr] = useState<string | null>(null);

  // ---- Selected job (Sprint E)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // ---- Sprint G: refine instructions
  const [refineInstructions, setRefineInstructions] = useState<string>("");
  const [refineLevel, setRefineLevel] = useState<"patch" | "minor" | "major">(
    "patch",
  );
  const [refineForce, setRefineForce] = useState<boolean>(true);

  const pollRef = useRef<number | null>(null);

  const latestJob = useMemo(() => jobs?.[0] ?? null, [jobs]);

  const selectedJob = useMemo(() => {
    if (!jobs.length) return null;
    if (!selectedJobId) return latestJob;
    return jobs.find((j) => j.id === selectedJobId) ?? latestJob;
  }, [jobs, selectedJobId, latestJob]);

  async function generate(force = false) {
    if (!moodboardId) return;

    setIsGenerating(true);
    setGenErr(null);

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moodboardId, force }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `generate: ${res.status}`);

      setOutput(data as AiGenerationOutput);

      // refrescar auditoría
      await refreshJobs();
    } catch (e: any) {
      setGenErr(e?.message ?? "No se pudo generar");
    } finally {
      setIsGenerating(false);
    }
  }

  async function refreshJobs() {
    if (!moodboardId) return;

    setLoadingJobs(true);
    setJobsErr(null);

    try {
      const res = await fetch(
        `/api/ai/jobs?moodboardId=${encodeURIComponent(moodboardId)}&limit=10`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `jobs: ${res.status}`);

      const next = Array.isArray(data.jobs) ? (data.jobs as Job[]) : [];
      setJobs(next);

      // Si no hay selección todavía (o la selección ya no existe), caer al latest
      if (next.length) {
        const stillExists = selectedJobId
          ? next.some((j) => j.id === selectedJobId)
          : false;
        if (!selectedJobId || !stillExists) setSelectedJobId(next[0]!.id);
      } else {
        setSelectedJobId(null);
      }
    } catch (e: any) {
      setJobsErr(e?.message ?? "No se pudieron cargar jobs");
      setJobs([]);
      setSelectedJobId(null);
    } finally {
      setLoadingJobs(false);
    }
  }

  // --- Sprint G: View output by id (GET /api/outputs/:id)
  async function loadOutputById(outputId: string) {
    if (!outputId) return;
    setGenErr(null);

    try {
      const res = await fetch(`/api/outputs/${encodeURIComponent(outputId)}`, {
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `output: ${res.status}`);

      // tolerante a shape: { output: {...} } o directamente {...}
      const out = (data?.output ?? data) as any;

      // si tu output real viene en outputJson, úsalo; si viene directo, úsalo igual
      const nextOutput =
        (out?.outputJson as AiGenerationOutput) ??
        (out as AiGenerationOutput) ??
        null;

      if (nextOutput) setOutput(nextOutput);
    } catch (e: any) {
      setGenErr(e?.message ?? "No se pudo cargar output");
    }
  }

  // --- Sprint G: Refine from selected base
  // OJO: aquí debes apuntar al endpoint real de refine que ya tienes.
  // Yo pongo un placeholder razonable: /api/ai/refine
  async function refineFromBaseOutput(baseOutputId: string) {
    if (!baseOutputId) return;

    const instructions = refineInstructions.trim();
    if (!instructions) {
      setGenErr("Escribe instrucciones para refinar (obligatorio).");
      return;
    }

    setIsGenerating(true);
    setGenErr(null);

    try {
      const res = await fetch(
        `/api/outputs/${encodeURIComponent(baseOutputId)}/refine`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instructions,
            level: refineLevel,
            force: refineForce,
          }),
        },
      );

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`refine ${res.status}: ${txt}`);
      }

      const txt = await res.text().catch(() => "");
      let data: any = {};
      try {
        data = txt ? JSON.parse(txt) : {};
      } catch {}

      if (!res.ok) {
        throw new Error(data?.error ?? txt ?? `refine: ${res.status}`);
      }

      // Tu route devuelve `result` de generateAiControlled.
      // Puede ser output directo o job; mantenemos lógica tolerante:
      if (data?.output || data?.outputJson) {
        const out = (data?.output ?? data) as any;
        const nextOutput =
          (out?.outputJson as AiGenerationOutput) ??
          (out as AiGenerationOutput) ??
          null;
        if (nextOutput) setOutput(nextOutput);
      }

      // ✅ Soporta respuesta { output: AiGenerationOutput }
      if (data?.output) {
        setOutput(data.output as AiGenerationOutput);
      }

      await refreshJobs();
      if (data?.job?.id) setSelectedJobId(String(data.job.id));
    } catch (e: any) {
      setGenErr(e?.message ?? "No se pudo refinar desde base");
    } finally {
      setIsGenerating(false);
    }
  }

  // cargar jobs al montar / cambiar moodboard
  useEffect(() => {
    if (!moodboardId) return;
    refreshJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moodboardId]);

  // si selecciono un job SUCCEEDED con outputJson, úsalo como output del viewer
  useEffect(() => {
    if (!selectedJob) return;

    if (selectedJob.status === "SUCCEEDED" && selectedJob.outputJson) {
      setOutput(selectedJob.outputJson as AiGenerationOutput);
      setGenErr(null);
      return;
    }

    if (selectedJob.status === "FAILED") {
      // mantenemos el output, pero mostramos error en tab error via errorJson/error
      // (genErr lo dejamos intacto, porque genErr es para errores de fetch)
      return;
    }
  }, [selectedJob]);

  // Polling: solo mientras haya jobs en progreso
  useEffect(() => {
    const hasInFlight = jobs.some(
      (j) => j.status === "QUEUED" || j.status === "RUNNING",
    );

    // si no hay jobs en vuelo, parar polling
    if (!hasInFlight) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    // si ya está corriendo polling, no lo dupliques
    if (pollRef.current) return;

    pollRef.current = window.setInterval(() => {
      refreshJobs();
    }, 2500);

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobs, moodboardId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // reset visual al cambiar moodboard
    setSelectedJobId(null);
    setOutput(null);
    setGenErr(null);

    // detener polling anterior
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [moodboardId]);

  async function regenerateFromPayloadHash(payloadHash: string) {
    const url = `/api/moodboards/${moodboardId}/outputs`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "REGENERATE_FROM_PAYLOAD_HASH",
        payloadHash,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`POST ${url} failed: ${res.status} ${txt}`);
    }

    return res.json();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => generate(false)}
          disabled={isGenerating || !moodboardId}
          className="rounded-xl bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {isGenerating ? "Generando…" : "Generar"}
        </button>

        <button
          type="button"
          onClick={() => generate(true)}
          disabled={isGenerating || !moodboardId}
          className="rounded-xl border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
        >
          Forzar (ignorar hash)
        </button>

        <button
          type="button"
          onClick={refreshJobs}
          disabled={loadingJobs || !moodboardId}
          className="rounded-xl border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
        >
          {loadingJobs ? "Cargando jobs…" : "Refresh jobs"}
        </button>

        {genErr ? <span className="text-sm text-red-700">{genErr}</span> : null}
        {jobsErr ? (
          <span className="text-sm text-red-700">{jobsErr}</span>
        ) : null}
      </div>

      <AiOutputViewer
        title="Innova Architect — Output"
        isLoading={isGenerating}
        error={genErr}
        output={output}
        payloadJson={selectedJob?.payloadJson}
        outputJson={selectedJob?.outputJson}
        errorJson={selectedJob?.errorJson}
        onRegenerate={(payloadHash) => {
          const h = payloadHash ?? selectedJob?.payloadHash;
          if (!h) return; // no hay hash, no hacemos nada
          void regenerateFromPayloadHash(h);
        }}
        showMetadataByDefault={false}
      />

      <section className="w-full rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <header className="border-b border-neutral-200 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-neutral-900">
                AI Generation (Audit)
              </h3>
              <p className="mt-1 text-sm text-neutral-600">
                Últimos jobs para este moodboard (store auditable).
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                moodboardId: {moodboardId}
              </p>
            </div>

            {latestJob ? (
              <div className="rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
                <div>
                  <span className="font-semibold">Último:</span>{" "}
                  {latestJob.status}
                </div>
                <div className="opacity-80">
                  v{latestJob.payloadVersion} · {latestJob.provider ?? "—"} /{" "}
                  {latestJob.model ?? "—"}
                </div>
              </div>
            ) : null}
          </div>
        </header>

        <div className="p-4">
          {jobs.length === 0 ? (
            <div className="text-sm text-neutral-600">No jobs yet.</div>
          ) : (
            <div className="grid gap-3">
              {jobs.map((j) => {
                const active = j.id === selectedJob?.id;
                return (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => setSelectedJobId(j.id)}
                    className={[
                      "rounded-2xl border p-4 text-left",
                      active
                        ? "border-neutral-900 bg-neutral-50"
                        : "border-neutral-200 bg-white hover:bg-neutral-50",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <code className="text-xs text-neutral-900">{j.id}</code>
                      <span className="text-xs font-semibold text-neutral-800">
                        {j.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-600">
                      v{j.payloadVersion} · {j.provider ?? "—"} /{" "}
                      {j.model ?? "—"}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {new Date(j.createdAt).toLocaleString()}
                    </div>
                    <div className="mt-2 text-xs text-neutral-700">
                      <span className="text-neutral-500">hash:</span>{" "}
                      <code className="text-xs">{j.payloadHash}</code>
                    </div>
                    {active ? (
                      <div className="mt-2 text-[11px] font-semibold text-neutral-900">
                        Seleccionado
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
      <section className="w-full rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <header className="border-b border-neutral-200 p-4">
          <h3 className="text-lg font-semibold text-neutral-900">
            Refine Controls
          </h3>
          <p className="mt-1 text-sm text-neutral-600">
            Instrucciones obligatorias para “Refine from selected base”.
          </p>
        </header>

        <div className="p-4 space-y-3">
          <textarea
            className="w-full min-h-[90px] rounded-xl border border-neutral-200 p-3 text-sm outline-none focus:border-neutral-400"
            placeholder='Ej: "Hazlo más minimalista, materiales cálidos, reduce complejidad, mantiene distribución."'
            value={refineInstructions}
            onChange={(e) => setRefineInstructions(e.target.value)}
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-neutral-700 flex items-center gap-2">
              <span className="text-xs text-neutral-500">Level</span>
              <select
                className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm"
                value={refineLevel}
                onChange={(e) => setRefineLevel(e.target.value as any)}
              >
                <option value="patch">patch</option>
                <option value="minor">minor</option>
                <option value="major">major</option>
              </select>
            </label>

            <label className="text-sm text-neutral-700 flex items-center gap-2">
              <input
                type="checkbox"
                checked={refineForce}
                onChange={(e) => setRefineForce(e.target.checked)}
              />
              <span>Force</span>
            </label>

            <div className="text-xs text-neutral-500">
              Tip: escribe instrucciones y luego usa “Refine from selected
              base”.
            </div>
          </div>
        </div>
      </section>

      <VersionHistoryPanel
        moodboardId={moodboardId}
        onViewOutput={(outputId) => loadOutputById(outputId)}
        onRefineFromBase={(baseOutputId) => refineFromBaseOutput(baseOutputId)}
      />
    </div>
  );
}
