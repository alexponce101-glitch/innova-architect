"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";

import StyleSignalSlider from "../../../components/style/StyleSignalSlider";
import AiGenerationPanel from "../../../../src/components/ai/AiGenerationPanel";

// 🔧 Feature flag de debug (no se renderiza en prod)
const DEBUG = process.env.NODE_ENV !== "production";

type BriefResponse = {
  brief: {
    moodboardId: string;
    styleProfileId: string;
    version: string;
    generatedAt: string;
    summary: string;
    preferencesNormalized?: {
      innovationLevel?: number;
      warmthLevel?: number;
      organicLevel?: number;
      luxuryLevel?: number;
    };
  };
  promptPack: {
    system: string;
    user: string;
    params: Record<string, any>;
  };
};

type SaveState = "idle" | "saving" | "error";

export default function MoodboardBriefPage() {
  const params = useParams<{ moodboardId: string }>();
  const moodboardId = String(params?.moodboardId ?? "");

  const base = useMemo(() => {
    if (!moodboardId) return "";
    return `/api/moodboards/${moodboardId}/style-profiles`;
  }, [moodboardId]);

  const [spid, setSpid] = useState("");
  const [out, setOut] = useState<BriefResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Editor fields
  const [uiInnovationLevel, setUiInnovationLevel] = useState<number>(0.2);
  const [uiWarmthLevel, setUiWarmthLevel] = useState<number>(0.5);
  const [uiOrganicLevel, setUiOrganicLevel] = useState<number>(0.5);
  const [uiLuxuryLevel, setUiLuxuryLevel] = useState<number>(0.5);

  const [isEditing, setIsEditing] = useState(false);
  const [editReason, setEditReason] = useState("Ajuste desde UI");

  // save UI
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Para cancelar PATCH previo si el usuario sigue moviendo el slider
  const inFlightAbortRef = useRef<AbortController | null>(null);
  // Para debounce
  const debounceTimerRef = useRef<number | null>(null);

  function syncUiFromBrief(payload: BriefResponse | any) {
    if (isEditing) return; // evita pisar UI mientras editas

    const pref = payload?.brief?.preferencesNormalized ?? {};
    const params = payload?.promptPack?.params ?? {};

    const pick = (a: any, b: any) =>
      typeof a === "number" ? a : typeof b === "number" ? b : undefined;

    const innovation = pick(pref.innovationLevel, params.innovationLevel);
    const warmth = pick(pref.warmthLevel, params.warmthLevel);
    const organic = pick(pref.organicLevel, params.organicLevel);
    const luxury = pick(pref.luxuryLevel, params.luxuryLevel);

    if (typeof innovation === "number") setUiInnovationLevel(innovation);
    if (typeof warmth === "number") setUiWarmthLevel(warmth);
    if (typeof organic === "number") setUiOrganicLevel(organic);
    if (typeof luxury === "number") setUiLuxuryLevel(luxury);
  }

  // Cuando ya tenemos styleProfileId, generamos/actualizamos brief
  useEffect(() => {
    if (!spid) return;
    void genBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spid]);

  // Auto-PATCH con debounce cuando el usuario mueve sliders
  useEffect(() => {
    if (!spid) return;
    if (!isEditing) return;

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = window.setTimeout(async () => {
      try {
        setSaveState("saving");
        setSaveError(null);

        // cancela request anterior si existe
        if (inFlightAbortRef.current) inFlightAbortRef.current.abort();
        const ac = new AbortController();
        inFlightAbortRef.current = ac;

        const body = {
          preferences: {
            innovationLevel: uiInnovationLevel,
            warmthLevel: uiWarmthLevel,
            organicLevel: uiOrganicLevel,
            luxuryLevel: uiLuxuryLevel,
          },
          editReason: editReason?.trim() || undefined,
        };

        if (DEBUG) console.log("AUTO PATCH body =>", body);

        const res = await fetch(`${base}/${spid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify(body),
        });

        const json = await res.json().catch(() => null);

        if (!res.ok) {
          throw new Error(`PARCHE: ${res.status} ${json?.error ?? ""}`.trim());
        }

        setSaveState("idle");
        setLastSavedAt(new Date().toLocaleTimeString());
        setIsEditing(false);

        // AHEAD MODE: regeneramos brief para confirmar
        await genBrief();
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setSaveState("error");
        setSaveError(e?.message ?? "No se pudo guardar");
      }
    }, 600);

    return () => {
      if (debounceTimerRef.current)
        window.clearTimeout(debounceTimerRef.current);
    };
  }, [
    spid,
    isEditing,
    uiInnovationLevel,
    uiWarmthLevel,
    uiOrganicLevel,
    uiLuxuryLevel,
    editReason,
    base,
  ]);

  async function genStyleProfile() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${base}/generate`, { method: "POST" });
      if (!res.ok) throw new Error(`generate: ${res.status}`);
      const json = await res.json();
      setSpid(json.id);
      setOut(null);
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function genBrief() {
    if (!base || !spid) return;
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${base}/${spid}/brief`, { method: "POST" });
      if (!res.ok) throw new Error(`brief POST: ${res.status}`);
      const payload = (await res.json()) as BriefResponse;
      setOut(payload);
      syncUiFromBrief(payload);
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function getBrief() {
    if (!base || !spid) return;
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${base}/${spid}/brief`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`brief GET: ${res.status}`);
      const payload = (await res.json()) as any;

      if (!payload?.brief) {
        setOut(null);
        return;
      }

      setOut(payload);
      syncUiFromBrief(payload);
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function prepareAi() {
    if (!base || !spid) return;
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${base}/${spid}/prepare`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(`prepare: ${res.status} ${json?.error ?? ""}`.trim());

      if (DEBUG) console.log("PREPARE IA =>", json);
      console.log("IA preparada ✅ payloadHash:", json?.payloadHash);
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
  }

  const banner =
    saveState === "saving"
      ? { text: "Guardando cambios…", color: "#b45309" }
      : saveState === "error"
        ? { text: "Error al guardar", color: "#b91c1c" }
        : lastSavedAt
          ? { text: `Guardado: ${lastSavedAt}`, color: "#15803d" }
          : null;

  // ✅ EARLY RETURN: si no hay brief cargado aún
  if (!out) {
    return (
      <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
        <div
          style={{
            background: "yellow",
            color: "black",
            padding: 8,
            marginBottom: 12,
            borderRadius: 8,
          }}
        >
          BRIEF PAGE LIVE ✅ moodboardId: {String(moodboardId)}
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 800 }}>Brief Inteligente</h1>
        <p style={{ opacity: 0.8 }}>
          Tablero de estado de ánimo: <b>{moodboardId}</b>
        </p>

        {banner ? (
          <div style={{ fontSize: 12, marginTop: 6, color: banner.color }}>
            {banner.text}
          </div>
        ) : null}

        {saveError ? (
          <div style={{ fontSize: 12, marginTop: 6, color: "crimson" }}>
            {saveError}
          </div>
        ) : null}

        <div
          style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}
        >
          <button onClick={genStyleProfile} disabled={loading || !base}>
            1) Perfil de estilo general
          </button>
          <button onClick={genBrief} disabled={loading || !spid}>
            2) Resumen general (POST)
          </button>
          <button onClick={getBrief} disabled={loading || !spid}>
            3) Cargar Brief (GET)
          </button>
          <button onClick={prepareAi} disabled={loading || !spid}>
            4) Preparar IA (stub)
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ opacity: 0.9 }}>
            estiloPerfilId: <code>{spid || "(vacío)"}</code>
          </div>
          {err ? (
            <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>
          ) : null}
        </div>

        {/* ✅ AI Generation (Audit) */}
        <div style={{ marginTop: 16 }}>
          <AiGenerationPanel moodboardId={String(moodboardId)} />
        </div>

        <div
          style={{
            marginTop: 16,
            border: "1px solid #ddd",
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Editor rápido</div>

          <div style={{ display: "grid", gap: 12 }}>
            <StyleSignalSlider
              signal="innovationLevel"
              value={uiInnovationLevel}
              onChange={(v) => {
                setIsEditing(true);
                setUiInnovationLevel(v);
              }}
              saveState={saveState}
              lastSavedAt={lastSavedAt}
              saveError={saveError}
              debug={DEBUG}
            />

            <StyleSignalSlider
              signal="warmthLevel"
              value={uiWarmthLevel}
              onChange={(v) => {
                setIsEditing(true);
                setUiWarmthLevel(v);
              }}
              saveState={saveState}
              lastSavedAt={lastSavedAt}
              saveError={saveError}
              debug={DEBUG}
            />

            <StyleSignalSlider
              signal="organicLevel"
              value={uiOrganicLevel}
              onChange={(v) => {
                setIsEditing(true);
                setUiOrganicLevel(v);
              }}
              saveState={saveState}
              lastSavedAt={lastSavedAt}
              saveError={saveError}
              debug={DEBUG}
            />

            <StyleSignalSlider
              signal="luxuryLevel"
              value={uiLuxuryLevel}
              onChange={(v) => {
                setIsEditing(true);
                setUiLuxuryLevel(v);
              }}
              saveState={saveState}
              lastSavedAt={lastSavedAt}
              saveError={saveError}
              debug={DEBUG}
            />

            <div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
                editReason
              </div>
              <input
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                style={{ width: "100%", padding: 8 }}
                placeholder="Ej: Más conservador"
              />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, opacity: 0.8 }}>
          Aún no hay brief cargado. Presiona <b>2) Resumen general (POST)</b> o{" "}
          <b>3) Cargar Brief (GET)</b>.
        </div>
      </div>
    );
  }

  // ✅ A partir de aquí, out ya NO es null
  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Brief Inteligente</h1>

      {banner ? (
        <div style={{ fontSize: 12, marginTop: 6, color: banner.color }}>
          {banner.text}
        </div>
      ) : null}

      {saveError ? (
        <div style={{ fontSize: 12, marginTop: 6, color: "crimson" }}>
          {saveError}
        </div>
      ) : null}

      <p style={{ opacity: 0.8 }}>
        Tablero de estado de ánimo: <b>{moodboardId}</b>
      </p>

      <div
        style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}
      >
        <button onClick={genStyleProfile} disabled={loading || !base}>
          1) Perfil de estilo general
        </button>
        <button onClick={genBrief} disabled={loading || !spid}>
          2) Resumen general (POST)
        </button>
        <button onClick={getBrief} disabled={loading || !spid}>
          3) Cargar Brief (GET)
        </button>
        <button onClick={prepareAi} disabled={loading || !spid}>
          4) Preparar IA (stub)
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ opacity: 0.9 }}>
          estiloPerfilId: <code>{spid || "(vacío)"}</code>
        </div>
        {err ? (
          <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 16,
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 14,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Editor rápido</div>

        <div style={{ display: "grid", gap: 12 }}>
          <StyleSignalSlider
            signal="innovationLevel"
            value={uiInnovationLevel}
            onChange={(v) => {
              setIsEditing(true);
              setUiInnovationLevel(v);
            }}
            saveState={saveState}
            lastSavedAt={lastSavedAt}
            saveError={saveError}
            debug={DEBUG}
          />

          <StyleSignalSlider
            signal="warmthLevel"
            value={uiWarmthLevel}
            onChange={(v) => {
              setIsEditing(true);
              setUiWarmthLevel(v);
            }}
            saveState={saveState}
            lastSavedAt={lastSavedAt}
            saveError={saveError}
            debug={DEBUG}
          />

          <StyleSignalSlider
            signal="organicLevel"
            value={uiOrganicLevel}
            onChange={(v) => {
              setIsEditing(true);
              setUiOrganicLevel(v);
            }}
            saveState={saveState}
            lastSavedAt={lastSavedAt}
            saveError={saveError}
            debug={DEBUG}
          />

          <StyleSignalSlider
            signal="luxuryLevel"
            value={uiLuxuryLevel}
            onChange={(v) => {
              setIsEditing(true);
              setUiLuxuryLevel(v);
            }}
            saveState={saveState}
            lastSavedAt={lastSavedAt}
            saveError={saveError}
            debug={DEBUG}
          />

          <div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
              editReason
            </div>
            <input
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              style={{ width: "100%", padding: 8 }}
              placeholder="Ej: Más conservador"
            />
          </div>
        </div>
      </div>

      {/* ✅ OUT: ahora es seguro */}
      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        <div
          style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}
        >
          <div style={{ fontWeight: 800 }}>Resumen</div>
          <div style={{ opacity: 0.75, marginTop: 4 }}>
            v{out.brief.version} ·{" "}
            {new Date(out.brief.generatedAt).toLocaleString()}
          </div>
          <p style={{ marginTop: 10 }}>{out.brief.summary}</p>
        </div>

        {/* ✅ AI Generation (Audit) */}
        <div style={{ marginTop: 6 }}>
          <AiGenerationPanel moodboardId={String(moodboardId)} />
        </div>

        <div
          style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Params</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(out.promptPack.params, null, 2)}
          </pre>
        </div>

        <div
          style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 800 }}>Prompt (user)</div>
            <button onClick={() => copy(out.promptPack.user)}>
              Copy prompt
            </button>
          </div>

          <pre style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
            {out.promptPack.user}
          </pre>
        </div>
      </div>
    </div>
  );
}
