"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { MoodboardItem, MoodboardStateV1 } from "./types";
import {
  clearMoodboard,
  loadMoodboardState,
  saveMoodboardState,
} from "./storage";

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function isValidUrl(input: string) {
  try {
    const u = new URL(input);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function getDomain(url: string) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

const STOPWORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "de",
  "del",
  "y",
  "o",
  "en",
  "a",
  "para",
  "por",
  "con",
  "sin",
  "que",
  "me",
  "mi",
  "mis",
  "tu",
  "tus",
  "su",
  "sus",
  "es",
  "son",
  "this",
  "that",
  "the",
  "and",
  "or",
  "to",
  "for",
  "with",
  "without",
  "in",
  "on",
  "of",
  "i",
  "we",
  "you",
  "it",
]);

function extractKeywords(items: MoodboardItem[]) {
  const freq = new Map<string, number>();
  const text = items
    .map((it) => `${it.title ?? ""} ${it.note ?? ""}`)
    .join(" ")
    .toLowerCase();

  const words = text
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  for (const w0 of words) {
    const w = w0.replace(/^-+|-+$/g, "");
    if (w.length < 4) continue;
    if (STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));
}

function deriveStyleSummary(items: MoodboardItem[], globalTags: string[]) {
  const tagCount = new Map<string, number>();
  for (const it of items) {
    for (const t of it.tags ?? []) {
      const n = normalizeTag(t);
      if (!n) continue;
      tagCount.set(n, (tagCount.get(n) ?? 0) + 1);
    }
  }

  // prefer tags registry order if exists; otherwise by count
  const topTags = Array.from(tagCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));

  const contentMix = {
    images: items.filter((i) => i.type === "image").length,
    links: items.filter((i) => i.type === "link").length,
    text: items.filter((i) => i.type === "text").length,
  };

  const domainCount = new Map<string, number>();
  for (const it of items) {
    if (it.type !== "link" || !it.url) continue;
    const d = getDomain(it.url);
    if (!d) continue;
    domainCount.set(d, (domainCount.get(d) ?? 0) + 1);
  }
  const topDomains = Array.from(domainCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([domain, count]) => ({ domain, count }));

  const keywords = extractKeywords(items);

  const blurb = (() => {
    const t = topTags.slice(0, 3).map((x) => x.label);
    const k = keywords.slice(0, 4).map((x) => x.term);
    const d = topDomains.slice(0, 2).map((x) => x.domain);

    const parts: string[] = [];
    if (t.length) parts.push(`tendencia a **${t.join(", ")}**`);
    if (k.length) parts.push(`énfasis en **${k.join(", ")}**`);
    if (d.length) parts.push(`referencias de **${d.join(", ")}**`);

    if (!parts.length)
      return "Agrega algunas imágenes, links o notas para generar tu Style Summary.";
    return `Tu moodboard muestra ${parts.join(" • ")}.`;
  })();

  return {
    topTags,
    keywords,
    contentMix,
    topDomains,
    blurb,
    allTags: globalTags,
  };
}

function splitTags(input: string): string[] {
  return String(input)
    .split(/[,;\n]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

// Normalización para comparar (consistente)
function normalizeTag(label: string) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

// Limpia tags dentro de cada item
function cleanItemTags(item: MoodboardItem): MoodboardItem {
  const raw = item.tags ?? [];
  const cleaned = uniq(
    raw
      .flatMap((t) => splitTags(t))
      .map(normalizeTag)
      .filter(Boolean),
  );
  return { ...item, tags: cleaned };
}

export default function MoodboardClient() {
  const [state, setState] = useState<MoodboardStateV1>({
    version: 1,
    items: [],
    tags: [],
    ui: { selectedTags: [], view: "grid", sort: "newest" },
  });

  const [filter, setFilter] = useState<string>("");
  const [newLink, setNewLink] = useState<string>("");
  const [newText, setNewText] = useState<string>("");

  const [tagInput, setTagInput] = useState<string>("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // Modal (Detail)
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  const activeItem = useMemo(() => {
    return state.items.find((i) => i.id === activeItemId) ?? null;
  }, [state.items, activeItemId]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load on mount (includes v0 -> v1 migration)
  useEffect(() => {
    const loaded = loadMoodboardState();

    // Limpia tags en items (por si alguno trae "a, b, c" en un solo string)
    const cleanedItems = (loaded.items ?? []).map(cleanItemTags);

    // Limpia tags globales (rompe tags con coma/;/\n y hace uniq)
    const cleanedGlobalTags = uniq(
      (loaded.tags ?? [])
        .flatMap((t) => splitTags(t))
        .map(normalizeTag)
        .filter(Boolean),
    );

    const nextLoaded: MoodboardStateV1 = {
      ...loaded,
      items: cleanedItems,
      tags: cleanedGlobalTags,
      ui: { ...(loaded.ui ?? {}), selectedTags: loaded.ui?.selectedTags ?? [] },
    };

    setState(nextLoaded);
    setSelectedTags(nextLoaded.ui?.selectedTags ?? []);
    setFilter(nextLoaded.ui?.filterText ?? "");
  }, []);

  // ===== Helpers / Handlers =====

  function setSelectedTagsAll(
    updater: string[] | ((prev: string[]) => string[]),
  ) {
    setSelectedTags((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;

      // Mantén state.ui.selectedTags sincronizado
      setState((s) => ({
        ...s,
        ui: { ...(s.ui ?? {}), selectedTags: next },
      }));

      return next;
    });
  }

  function clearSelectedTags() {
    // Limpia tags seleccionados + también limpia el filtro de texto
    setSelectedTagsAll([]);
    setFilter("");
  }

  function updateItem(itemId: string, patch: Partial<MoodboardItem>) {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === itemId ? { ...it, ...patch } : it,
      ),
    }));
  }

  function removeItem(itemId: string) {
    setState((prev) => ({
      ...prev,
      items: prev.items.filter((it) => it.id !== itemId),
    }));
  }

  const items = state.items;
  const tags = state.tags;

  const summary = useMemo(() => deriveStyleSummary(items, tags), [items, tags]);

  /* tagsOrdered */
  const tagsOrdered = useMemo(() => {
    const counts = new Map<string, number>();

    // cuenta cuántas veces aparece cada tag en items
    for (const it of items) {
      for (const t of it.tags ?? []) {
        const n = normalizeTag(t);
        if (!n) continue;
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }

    // normaliza catálogo global y quita vacíos/duplicados
    const catalog = uniq(tags.map(normalizeTag).filter(Boolean));

    // orden: primero por uso (desc), luego alfabético
    return catalog.sort((a, b) => {
      const ca = counts.get(a) ?? 0;
      const cb = counts.get(b) ?? 0;
      if (cb !== ca) return cb - ca;
      return a.localeCompare(b);
    });
  }, [items, tags]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const activeTags = selectedTags.map(normalizeTag).filter(Boolean);

    return items.filter((it) => {
      // text search
      if (q) {
        const blob = [
          it.type,
          it.title ?? "",
          it.note ?? "",
          it.url ?? "",
          (it.tags ?? []).join(" "),
          it.imageFileName ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(q)) return false;
      }

      // tag filter (OR)
      if (activeTags.length) {
        const itTags = (it.tags ?? []).map(normalizeTag).filter(Boolean);
        const hit = activeTags.some((t) => itTags.includes(t));
        if (!hit) return false;
      }

      return true;
    });
  }, [items, filter, selectedTags]);

  function addGlobalTag(labelRaw: string) {
    const parts = splitTags(labelRaw).map(normalizeTag).filter(Boolean);
    if (parts.length === 0) return;

    setState((prev) => {
      const existing = prev.tags.map((t) => normalizeTag(t)).filter(Boolean);
      const toAdd = parts.filter((p) => !existing.includes(p));
      if (toAdd.length === 0) return prev;

      return { ...prev, tags: [...toAdd, ...prev.tags] };
    });
  }

  function displayTag(label: string) {
    const t = normalizeTag(label);
    if (!t) return "";

    return t.replace(/\b\p{L}+/gu, (w) => {
      const first = w.charAt(0);
      return first ? first.toUpperCase() + w.slice(1) : w;
    });
  }

  function onToggleTag(labelRaw: string) {
    const t = normalizeTag(labelRaw);
    if (!t) return;

    setSelectedTagsAll((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function toggleTagOnItem(itemId: string, labelRaw: string) {
    const label = normalizeTag(labelRaw);
    if (!label) return;

    // ensure tag exists globally
    addGlobalTag(label);

    setState((prev) => {
      const nextItems = prev.items.map((it) => {
        if (it.id !== itemId) return it;
        const cur = (it.tags ?? []).map(normalizeTag).filter(Boolean);
        const has = cur.includes(label);
        const nextTags = has ? cur.filter((t) => t !== label) : [label, ...cur];
        return { ...it, tags: nextTags };
      });
      return { ...prev, items: nextItems };
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const fileArr = Array.from(files);
    const images = fileArr.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;

    const newItems: MoodboardItem[] = [];
    for (const f of images) {
      const dataUrl = await fileToDataUrl(f);
      newItems.push({
        id: uid(),
        type: "image",
        title: f.name,
        imageFileName: f.name,
        imageDataUrl: dataUrl,
        createdAt: Date.now(),
        tags: [],
      });
    }

    setState((prev) => ({ ...prev, items: [...newItems, ...prev.items] }));

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function addLink() {
    const url = newLink.trim();
    if (!url) return;
    if (!isValidUrl(url)) {
      alert("Ese link no parece válido. Debe empezar con http:// o https://");
      return;
    }

    const item: MoodboardItem = {
      id: uid(),
      type: "link",
      url,
      title: url,
      createdAt: Date.now(),
      tags: [],
    };
    setState((prev) => ({ ...prev, items: [item, ...prev.items] }));
    setNewLink("");
  }

  function addText() {
    const text = newText.trim();
    if (!text) return;
    const item: MoodboardItem = {
      id: uid(),
      type: "text",
      title: "Nota",
      note: text,
      createdAt: Date.now(),
      tags: [],
    };
    setState((prev) => ({ ...prev, items: [item, ...prev.items] }));
    setNewText("");
  }

  function clearAll() {
    const ok = confirm(
      "¿Seguro? Esto borrará el moodboard guardado localmente.",
    );
    if (!ok) return;
    setSelectedTags([]);
    setState({
      version: 1,
      items: [],
      tags: [],
      ui: { selectedTags: [], view: "grid", sort: "newest" },
    });

    clearMoodboard();
  }

  function addTagFromInput() {
    const parts = splitTags(tagInput).map(normalizeTag).filter(Boolean);
    if (parts.length === 0) return;

    parts.forEach((t) => addGlobalTag(t));
    setTagInput("");
  }

  function exportJson() {
    const payload: MoodboardStateV1 = {
      ...state,
      ui: { ...(state.ui ?? {}), selectedTags, view: "grid", sort: "newest" },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `innova-moodboard-v1-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const persistPayload = useMemo(() => {
    const next: MoodboardStateV1 = {
      ...state,
      ui: {
        ...(state.ui ?? {}),
        selectedTags,
        filterText: filter, // ✅ persistir búsqueda
        view: state.ui?.view ?? "grid",
        sort: state.ui?.sort ?? "newest",
      },
    };
    return next;
  }, [state, selectedTags, filter]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveMoodboardState(persistPayload);
    }, 600);

    return () => window.clearTimeout(t);
  }, [persistPayload]);

  /* DESPUÉS DE ESTO ya empieza el return */
  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20 }}>
      {/* Left: Controls */}
      <section
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14,
          padding: 16,
          background: "rgba(255,255,255,0.03)",
          height: "fit-content",
          position: "sticky",
          top: 16,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
          Agregar referencias
        </h2>

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label
              style={{
                display: "block",
                fontSize: 12,
                opacity: 0.8,
                marginBottom: 6,
              }}
            >
              Subir imágenes (local)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
            />
            <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>
              Tip: sube 3–10 imágenes por estilo (fachadas, interiores,
              materiales).
            </div>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 12,
                opacity: 0.8,
                marginBottom: 6,
              }}
            >
              Link (YouTube / web)
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newLink}
                onChange={(e) => setNewLink(e.target.value)}
                placeholder="https://..."
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              />
              <button
                onClick={addLink}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  cursor: "pointer",
                }}
              >
                Add
              </button>
            </div>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 12,
                opacity: 0.8,
                marginBottom: 6,
              }}
            >
              Nota rápida
            </label>
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Ej: Me gusta este estilo minimalista, concreto aparente, madera clara..."
              rows={4}
              style={{
                width: "100%",
                padding: "10px 10px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                onClick={addText}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  cursor: "pointer",
                }}
              >
                Guardar nota
              </button>
              <button
                onClick={() => {
                  setState((prev) => ({
                    ...prev,
                    items: [
                      {
                        id: uid(),
                        type: "text",
                        title: "Test Modal",
                        note: "Si ves esto en el modal, funciona.",
                        tags: ["test"],
                        createdAt: Date.now(),
                      },
                      ...prev.items,
                    ],
                  }));
                  clearSelectedTags();
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  cursor: "pointer",
                  marginTop: 8,
                  width: "100%",
                }}
              >
                + Test item
              </button>

              <button
                onClick={clearAll}
                style={{
                  marginLeft: "auto",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  cursor: "pointer",
                  opacity: 0.9,
                }}
              >
                Borrar todo
              </button>
            </div>
          </div>

          {/* Tags */}
          <div
            style={{
              borderTop: "1px solid rgba(255,255,255,0.10)",
              paddingTop: 12,
              marginTop: 4,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>
                Tags
              </label>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                }}
              >
                <button
                  onClick={exportJson}
                  title="Exporta una copia técnica de tu moodboard (formato JSON)"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.12)",
                    cursor: "pointer",
                    fontSize: 12,
                    opacity: 0.9,
                  }}
                  type="button"
                >
                  Exportar proyecto
                </button>

                <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
                  Copia técnica (JSON)
                </div>
              </div>
            </div>

            {/* Input + botón + */}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Agregar tag (ej: Japandi)"
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
                onKeyDown={(e) => {
                  if ((e as any).isComposing) return;
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTagFromInput();
                  }
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (
                    text.includes(",") ||
                    text.includes("\n") ||
                    text.includes(";")
                  ) {
                    e.preventDefault();
                    setTagInput(text);
                    queueMicrotask(() => addTagFromInput());
                  }
                }}
              />
              <button
                onClick={addTagFromInput}
                disabled={!tagInput.trim()}
                title={
                  !tagInput.trim()
                    ? "Escribe un tag para agregar"
                    : "Agregar tag"
                }
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  cursor: !tagInput.trim() ? "not-allowed" : "pointer",
                  opacity: !tagInput.trim() ? 0.45 : 1,
                }}
                type="button"
              >
                +
              </button>
            </div>

            {/* Catálogo global (Filtrar por tags) */}
            {tags.length > 0 && (
              <>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>
                  Filtrar por tags:
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {tagsOrdered.map((t) => {
                    const n = normalizeTag(t);
                    const active = selectedTags.includes(t);
                    return (
                      <button
                        key={n}
                        onClick={() => onToggleTag(t)}
                        type="button"
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.12)",
                          cursor: "pointer",
                          fontSize: 12,
                          opacity: active ? 1 : 0.75,
                          background: active
                            ? "rgba(255,255,255,0.10)"
                            : "transparent",
                        }}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>

                {/* Chips seleccionados + limpiar */}
                {selectedTags.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {selectedTags.map((t) => (
                        <div
                          key={t}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.12)",
                            fontSize: 12,
                            opacity: 0.95,
                          }}
                          title="Tag seleccionado"
                        >
                          <span>{t}</span>
                          <button
                            type="button"
                            onClick={() => onToggleTag(t)}
                            aria-label={`Quitar tag ${t}`}
                            style={{
                              border: "1px solid rgba(255,255,255,0.12)",
                              background: "transparent",
                              borderRadius: 999,
                              width: 20,
                              height: 20,
                              lineHeight: "18px",
                              cursor: "pointer",
                              opacity: 0.85,
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={clearSelectedTags}
                      style={{
                        marginTop: 10,
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.12)",
                        cursor: "pointer",
                        fontSize: 12,
                        opacity: 0.85,
                      }}
                    >
                      Limpiar filtro de tags
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 12,
                opacity: 0.8,
                marginBottom: 6,
              }}
            >
              Buscar / filtrar
            </label>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Ej: madera, minimalista, japandi..."
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            />
          </div>

          <div style={{ fontSize: 12, opacity: 0.75 }}>
            <b>{items.length}</b> items guardados (persisten en tu navegador).
          </div>
        </div>
      </section>

      {/* Right: Summary + Grid */}
      <section
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14,
          padding: 16,
          background: "rgba(255,255,255,0.02)",
          minHeight: 420,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
            Tu Moodboard
          </h2>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Mostrando <b>{filtered.length}</b> / {items.length}
          </div>
        </div>

        {/* Style Summary v0 */}
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 14,
            padding: 12,
            background: "rgba(0,0,0,0.18)",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              Style Summary v0
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Mix: 🖼 {summary.contentMix.images} · 🔗{" "}
              {summary.contentMix.links} · 📝 {summary.contentMix.text}
            </div>
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              opacity: 0.85,
              lineHeight: 1.45,
            }}
          >
            {summary.blurb}
          </div>

          {summary.topTags.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Top tags</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                {summary.topTags.map((t) => (
                  <span
                    key={t.label}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.12)",
                      fontSize: 12,
                      opacity: 0.9,
                    }}
                  >
                    {t.label} <span style={{ opacity: 0.6 }}>· {t.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {summary.keywords.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Keywords</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                {summary.keywords.map((k) => (
                  <span
                    key={k.term}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.12)",
                      fontSize: 12,
                      opacity: 0.85,
                    }}
                  >
                    {k.term} <span style={{ opacity: 0.55 }}>· {k.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {summary.topDomains.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Sources</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                {summary.topDomains.map((d) => (
                  <span
                    key={d.domain}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.12)",
                      fontSize: 12,
                      opacity: 0.85,
                    }}
                  >
                    {d.domain}{" "}
                    <span style={{ opacity: 0.55 }}>· {d.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {(selectedTags.length > 0 || filter.trim()) && (
          <div
            style={{
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(0,0,0,0.18)",
              fontSize: 12,
              opacity: 0.9,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span style={{ opacity: 0.75 }}>Filtros activos:</span>

              {filter.trim() && (
                <span
                  style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  Texto: {filter.trim()}
                </span>
              )}

              {selectedTags.map((t) => (
                <span
                  key={t}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>

            <button
              type="button"
              onClick={clearSelectedTags}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                cursor: "pointer",
                fontSize: 12,
                opacity: 0.9,
                whiteSpace: "nowrap",
              }}
            >
              Limpiar
            </button>
          </div>
        )}

        {filtered.length === 0 ? (
          <div
            style={{
              opacity: 0.7,
              padding: 18,
              border: "1px dashed rgba(255,255,255,0.18)",
              borderRadius: 12,
            }}
          >
            No hay resultados con los filtros actuales.
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={clearSelectedTags}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Quitar filtros
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {filtered.map((it) => (
              <Card
                key={it.id}
                item={it}
                allTags={tags}
                onToggleTag={(label) => toggleTagOnItem(it.id, label)}
                onChange={(patch) => updateItem(it.id, patch)}
                onRemove={() => removeItem(it.id)}
                onOpen={() => setActiveItemId(it.id)}
              />
            ))}
          </div>
        )}
      </section>

      {activeItem && (
        <ItemDetailModal
          item={activeItem}
          allTags={tags}
          onClose={() => setActiveItemId(null)}
          onChange={(patch) => updateItem(activeItem.id, patch)}
          onToggleTag={(label) => toggleTagOnItem(activeItem.id, label)}
        />
      )}
    </div>
  );
}

function Card({
  item,
  allTags,
  onToggleTag,
  onChange,
  onRemove,
  onOpen,
}: {
  item: MoodboardItem;
  allTags: string[];
  onToggleTag: (label: string) => void;
  onChange: (patch: Partial<MoodboardItem>) => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const tags = (item.tags ?? []).map(normalizeTag).filter(Boolean);
  const previewTags = tags.slice(0, 3);
  const extraTags = tags.length - previewTags.length;

  return (
    <div
      onClick={onOpen}
      style={{
        cursor: "pointer",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 14,
        overflow: "hidden",
        background: "rgba(0,0,0,0.2)",
      }}
    >
      {/* Header */}
      <div
        style={{ padding: 10, display: "flex", alignItems: "center", gap: 8 }}
      >
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.12)",
            opacity: 0.85,
          }}
        >
          {item.type.toUpperCase()}
        </span>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.95 }}>
            {item.title || "Sin título"}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>
            Click para ver detalle
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Eliminar"
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            cursor: "pointer",
            opacity: 0.9,
          }}
        >
          ✕
        </button>
      </div>
      {/* Body */}
      <div style={{ padding: 10 }}>
        {item.type === "image" && item.imageDataUrl ? (
          <img
            src={item.imageDataUrl}
            alt={item.title ?? "image"}
            style={{
              width: "100%",
              height: 160,
              objectFit: "cover",
              borderRadius: 12,
            }}
          />
        ) : item.type === "link" && item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "block",
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              textDecoration: "none",
              wordBreak: "break-word",
            }}
          >
            {item.url}
          </a>
        ) : (
          <div style={{ opacity: 0.7, fontSize: 12 }}>—</div>
        )}

        {/* Nota snippet (2 líneas) */}
        {item.note?.trim() && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              opacity: 0.8,
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.note.trim()}
          </div>
        )}
      </div>
      {/* Tags */}
      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10 }}>
        {previewTags.length > 0 && (
          <div
            style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}
          >
            {previewTags.map((t) => (
              <span
                key={t}
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  fontSize: 12,
                  opacity: 0.9,
                }}
              >
                {t}
              </span>
            ))}

            {extraTags > 0 && (
              <span
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.12)",
                  fontSize: 12,
                  opacity: 0.6,
                }}
              >
                +{extraTags}
              </span>
            )}
          </div>
        )}

        {allTags.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 8,
            }}
          >
            {allTags.slice(0, 12).map((t) => {
              const nt = normalizeTag(t);
              const active = tags.includes(nt);

              return (
                <button
                  key={nt}
                  onClick={() => onToggleTag(t)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    cursor: "pointer",
                    fontSize: 12,
                    opacity: active ? 1 : 0.7,
                    background: active
                      ? "rgba(255,255,255,0.10)"
                      : "transparent",
                  }}
                  title={active ? "Quitar tag" : "Agregar tag"}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}

        <AddTagInline onAdd={(label) => onToggleTag(label)} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>
        {new Date(item.createdAt).toLocaleString()}
      </div>{" "}
      {/* último div interno */}
    </div>
  );
}

function collectAllTags(items: MoodboardItem[]) {
  const all: string[] = [];
  for (const it of items) {
    for (const t of it.tags ?? []) all.push(normalizeTag(t));
  }
  return uniq(all).sort((a, b) => a.localeCompare(b));
}

function AddTagInline({ onAdd }: { onAdd: (label: string) => void }) {
  const [v, setV] = useState("");

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Agregar tag…"
        style={{
          flex: 1,
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)",
          fontSize: 12,
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const parts = splitTags(v);
            if (parts.length === 0) return;
            parts.forEach(onAdd);
            setV("");
          }
        }}
      />
      <button
        onClick={() => {
          const parts = splitTags(v);
          if (parts.length === 0) return;
          parts.forEach(onAdd);
          setV("");
        }}
        style={{
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.12)",
          cursor: "pointer",
          fontSize: 12,
          opacity: 0.9,
        }}
      >
        +
      </button>
    </div>
  );
}

function ItemDetailModal({
  item,
  allTags,
  onClose,
  onChange,
  onToggleTag,
}: {
  item: MoodboardItem;
  allTags: string[];
  onClose: () => void;
  onChange: (patch: Partial<MoodboardItem>) => void;
  onToggleTag: (label: string) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function requestClose() {
    setMounted(false);
    setTimeout(onClose, 140);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      onClick={requestClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "grid",
        placeItems: "center",
        padding: 12,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        opacity: mounted ? 1 : 0,
        transition: "opacity 140ms ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(980px, calc(100vw - 24px))",
          maxHeight: "calc(100vh - 24px)",
          overflow: "auto",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(18,18,18,0.96)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          transform: mounted ? "scale(1)" : "scale(0.98)",
          opacity: mounted ? 1 : 0,
          transition: "transform 140ms ease, opacity 140ms ease",
        }}
      >
        {/* Header */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: 12,
            borderBottom: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(18,18,18,0.96)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, opacity: 0.95 }}>
            Detalle
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              onClick={requestClose}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                cursor: "pointer",
                opacity: 0.9,
              }}
            >
              Cerrar
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: 12 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 12, opacity: 0.75 }}>Título</label>
            <input
              value={item.title ?? ""}
              onChange={(e) => onChange({ title: e.target.value })}
              style={{
                width: "100%",
                padding: "10px 10px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                fontSize: 13,
              }}
            />

            {item.type === "image" && item.imageDataUrl ? (
              <img
                src={item.imageDataUrl}
                alt={item.title ?? "image"}
                style={{
                  width: "100%",
                  maxHeight: 420,
                  objectFit: "cover",
                  borderRadius: 12,
                }}
              />
            ) : null}

            {item.type === "link" && item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "block",
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  textDecoration: "none",
                  wordBreak: "break-word",
                }}
              >
                {item.url}
              </a>
            ) : null}

            <label style={{ fontSize: 12, opacity: 0.75 }}>Notas</label>
            <textarea
              value={item.note ?? ""}
              onChange={(e) => onChange({ note: e.target.value })}
              rows={6}
              style={{
                width: "100%",
                padding: "10px 10px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                fontSize: 13,
              }}
            />

            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>Tags</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {allTags.slice(0, 24).map((t) => (
                <button
                  key={t}
                  onClick={() => onToggleTag(t)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    cursor: "pointer",
                    fontSize: 12,
                    opacity: 0.9,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 10, fontSize: 11, opacity: 0.65 }}>
              {new Date(item.createdAt).toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader error"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
