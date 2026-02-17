"use client";

import * as React from "react";

export type AiGenerationOutput = {
  interpretedContext?: {
    projectType?: string;
    style?: string;
    innovationLevel?: number; // 0..1
    constraints?: string[];
    notes?: string;
  };
  sections: {
    title: string;
    content: string;
  }[];
  metadata: {
    model: string;
    hash: string;
    version: string;
    generatedAt: string; // ISO
    jobId?: string;
    durationMs?: number;
  };
};

type Props = {
  title?: string;

  isLoading?: boolean;
  error?: string | null;

  output?: AiGenerationOutput | null;

  payloadJson?: unknown;
  outputJson?: unknown;
  errorJson?: unknown;

  onRegenerate?: (payloadHash?: string) => void;
  onAdjust?: () => void;
  onSave?: () => void;

  showMetadataByDefault?: boolean;
};

type TabKey = "output" | "audit" | "payload" | "error";

function formatIso(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function pct01(n: number) {
  return Math.round(clamp01(n) * 100);
}

function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeJsonStringify(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-xl px-3 py-1.5 text-sm font-semibold",
        active
          ? "bg-neutral-900 text-white"
          : "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function AiOutputViewer({
  title = "AI Output",
  isLoading = false,
  error = null,
  output = null,
  payloadJson,
  outputJson,
  errorJson,
  onRegenerate,
  onAdjust,
  onSave,
  showMetadataByDefault = false,
}: Props) {
  const hasOutput =
    !!output && Array.isArray(output.sections) && output.sections.length > 0;

  const [tab, setTab] = React.useState<TabKey>("output");
  const [auditOpen, setAuditOpen] = React.useState<boolean>(
    showMetadataByDefault || !!error,
  );
  const [openSections, setOpenSections] = React.useState<
    Record<number, boolean>
  >({});

  React.useEffect(() => {
    if (error || errorJson) setTab("error");
    else if (hasOutput) setTab("output");
    else setTab("output");
  }, [error, errorJson, hasOutput]);

  React.useEffect(() => {
    if (showMetadataByDefault || error) setAuditOpen(true);
  }, [showMetadataByDefault, error]);

  const payloadHash = output?.metadata?.hash;

  // ------- NODES (evita inferencias raras en JSX) -------
  const loadingNode: React.ReactNode = isLoading ? (
    <div className="space-y-3">
      <div className="h-4 w-1/3 animate-pulse rounded bg-neutral-200" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200" />
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-neutral-200" />
        <div className="h-3 w-11/12 animate-pulse rounded bg-neutral-200" />
        <div className="h-3 w-10/12 animate-pulse rounded bg-neutral-200" />
      </div>
      <p className="pt-2 text-sm text-neutral-600">Generando…</p>
    </div>
  ) : null;

  const quickErrorNode: React.ReactNode =
    !isLoading && error && tab !== "error" ? (
      <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-red-800">Error</p>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </div>
    ) : null;

  const outputTabNode: React.ReactNode =
    tab === "output" && !isLoading ? (
      <>
        {!error && !hasOutput ? (
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm font-semibold text-neutral-900">
              Aún no hay resultado
            </p>
            <p className="mt-1 text-sm text-neutral-700">
              Ejecuta una generación para ver aquí el output estructurado.
            </p>
          </div>
        ) : null}

        {!error && hasOutput && output ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold text-neutral-900">
                  🧠 La IA interpretó
                </h3>

                {typeof output.interpretedContext?.innovationLevel ===
                "number" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-neutral-600">
                      Innovación
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-900">
                      {pct01(output.interpretedContext.innovationLevel)}%
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <InfoRow
                  label="Tipo de proyecto"
                  value={output.interpretedContext?.projectType}
                />
                <InfoRow
                  label="Estilo"
                  value={output.interpretedContext?.style}
                />

                <div className="md:col-span-2">
                  <InfoRow
                    label="Restricciones detectadas"
                    value={
                      output.interpretedContext?.constraints?.length
                        ? output.interpretedContext.constraints.join(" • ")
                        : undefined
                    }
                  />
                </div>

                {output.interpretedContext?.notes ? (
                  <div className="md:col-span-2">
                    <p className="text-xs font-medium text-neutral-600">
                      Notas
                    </p>
                    <p className="mt-1 text-sm text-neutral-800">
                      {output.interpretedContext.notes}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white">
              <div className="border-b border-neutral-200 p-4">
                <h3 className="text-sm font-semibold text-neutral-900">
                  ✨ Resultado
                </h3>
                <p className="mt-1 text-sm text-neutral-600">
                  Secciones generadas. Puedes colapsar y copiar por sección.
                </p>
              </div>

              <div className="divide-y divide-neutral-200">
                {output.sections.map((sec, idx) => {
                  const isOpen = openSections[idx] ?? idx < 2;
                  return (
                    <div key={`${sec.title}-${idx}`} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenSections((prev) => ({
                              ...prev,
                              [idx]: !isOpen,
                            }))
                          }
                          className="min-w-0 text-left"
                        >
                          <h4 className="text-base font-semibold text-neutral-900">
                            {isOpen ? "▾" : "▸"} {sec.title}
                          </h4>
                        </button>

                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await copyToClipboard(sec.content);
                              if (!ok)
                                alert("No se pudo copiar al portapapeles.");
                            }}
                            className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                          >
                            Copiar
                          </button>
                        </div>
                      </div>

                      {isOpen ? (
                        <div className="mt-2 space-y-2">
                          {splitParagraphs(sec.content).map((p, i) => (
                            <p
                              key={i}
                              className="text-sm leading-relaxed text-neutral-800"
                            >
                              {p}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {outputJson ? (
              <div className="rounded-2xl border border-neutral-200 bg-white">
                <div className="flex items-center justify-between gap-3 border-b border-neutral-200 p-4">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-900">
                      🧾 Output JSON (raw)
                    </h3>
                    <p className="mt-1 text-sm text-neutral-600">
                      Útil para debug / export rápido.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyToClipboard(
                        safeJsonStringify(outputJson),
                      );
                      if (!ok) alert("No se pudo copiar al portapapeles.");
                    }}
                    className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                  >
                    Copiar JSON
                  </button>
                </div>

                <pre className="max-h-[520px] overflow-auto p-4 text-xs leading-relaxed text-neutral-800">
                  {safeJsonStringify(outputJson)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </>
    ) : null;

  const auditTabNode: React.ReactNode =
    tab === "audit" && !isLoading ? (
      <div className="rounded-2xl border border-neutral-200 bg-white">
        <button
          type="button"
          onClick={() => setAuditOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-4 p-4 text-left"
        >
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              🔎 Detalles técnicos
            </h3>
            <p className="mt-1 text-sm text-neutral-600">
              Auditoría (hash, modelo, versión, timestamps).
            </p>
          </div>
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-900">
            {auditOpen ? "Ocultar" : "Mostrar"}
          </span>
        </button>

        {auditOpen ? (
          <div className="border-t border-neutral-200 p-4">
            {output?.metadata ? (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyToClipboard(
                        safeJsonStringify(output.metadata),
                      );
                      if (!ok) alert("No se pudo copiar al portapapeles.");
                    }}
                    className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                  >
                    Copiar metadata JSON
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InfoRow label="Modelo" value={output.metadata.model} />
                  <InfoRow label="Versión" value={output.metadata.version} />
                  <InfoRow
                    label="Hash (payloadHash)"
                    value={output.metadata.hash}
                  />
                  <InfoRow
                    label="Generado"
                    value={formatIso(output.metadata.generatedAt)}
                  />
                  <InfoRow label="Job ID" value={output.metadata.jobId} />
                  <InfoRow
                    label="Duración"
                    value={
                      typeof output.metadata.durationMs === "number"
                        ? `${output.metadata.durationMs} ms`
                        : undefined
                    }
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-700">
                — No hay metadata disponible.
              </p>
            )}
          </div>
        ) : null}
      </div>
    ) : null;

  const payloadTabNode: React.ReactNode =
    tab === "payload" && !isLoading ? (
      <div className="rounded-2xl border border-neutral-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 p-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              📦 Payload
            </h3>
            <p className="mt-1 text-sm text-neutral-600">
              Input usado para generar este job.
            </p>
          </div>

          <button
            type="button"
            onClick={async () => {
              const ok = await copyToClipboard(
                safeJsonStringify(payloadJson ?? {}),
              );
              if (!ok) alert("No se pudo copiar al portapapeles.");
            }}
            className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            Copiar JSON
          </button>
        </div>

        <pre className="max-h-[520px] overflow-auto p-4 text-xs leading-relaxed text-neutral-800">
          {safeJsonStringify(payloadJson ?? "— No payloadJson provisto —")}
        </pre>
      </div>
    ) : null;

  const errorTabNode: React.ReactNode =
    tab === "error" && !isLoading ? (
      <div className="rounded-2xl border border-red-200 bg-red-50">
        <div className="flex items-start justify-between gap-3 border-b border-red-200 p-4">
          <div>
            <p className="text-sm font-semibold text-red-800">❗ Error</p>
            <p className="mt-1 text-sm text-red-700">
              {error ?? "— Revisa errorJson —"}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {onRegenerate ? (
              <button
                type="button"
                onClick={() => onRegenerate(payloadHash)}
                className="rounded-xl bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-600"
              >
                Intentar de nuevo
              </button>
            ) : null}

            <button
              type="button"
              onClick={async () => {
                const ok = await copyToClipboard(
                  safeJsonStringify(errorJson ?? error ?? ""),
                );
                if (!ok) alert("No se pudo copiar al portapapeles.");
              }}
              className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50"
            >
              Copiar error
            </button>
          </div>
        </div>

        <pre className="max-h-[520px] overflow-auto p-4 text-xs leading-relaxed text-red-900">
          {safeJsonStringify(errorJson ?? error ?? "—")}
        </pre>
      </div>
    ) : null;

  return (
    <section className="w-full rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-4 border-b border-neutral-200 p-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Visualización estructurada del resultado IA (interpretación,
            secciones y auditoría).
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {onAdjust ? (
            <button
              type="button"
              onClick={onAdjust}
              className="rounded-xl border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Ajustar
            </button>
          ) : null}

          {onSave ? (
            <button
              type="button"
              onClick={onSave}
              className="rounded-xl border border-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Guardar
            </button>
          ) : null}

          {onRegenerate ? (
            <button
              type="button"
              onClick={() => onRegenerate(payloadHash)}
              className="rounded-xl bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-800"
              title={
                payloadHash
                  ? "Regenerar desde el mismo payloadHash"
                  : "Regenerar"
              }
            >
              Regenerar
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 p-3">
        <TabButton active={tab === "output"} onClick={() => setTab("output")}>
          ✨ Resultado
        </TabButton>
        <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>
          🔎 Auditoría
        </TabButton>
        <TabButton active={tab === "payload"} onClick={() => setTab("payload")}>
          📦 Payload
        </TabButton>
        <TabButton active={tab === "error"} onClick={() => setTab("error")}>
          ❗ Error
        </TabButton>
      </div>

      <div className="p-4">
        {loadingNode}
        {quickErrorNode}
        {outputTabNode}
        {auditTabNode}
        {payloadTabNode}
        {errorTabNode}
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-600">{label}</p>
      <p className="mt-1 text-sm text-neutral-900">
        {value && value.trim() ? value : "—"}
      </p>
    </div>
  );
}
