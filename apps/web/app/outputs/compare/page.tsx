"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";

import {
  usePinnedCompare,
  makeRowId,
} from "../../../src/features/compare/pins/usePinned";
import type {
  DiffTone,
  Pin as ComparePin,
} from "../../../src/features/compare/pins/types";

import type { CompareMode, CompareResult, RecommendedPin } from "./types";

import { deriveSmartPresets } from "../../../src/server/ai-outputs/compare/presets/engine";
import { SmartPresetsPanel } from "../../../src/components/compare/SmartPresetsPanel";

import { computeHotspots, topZones } from "./hotspots";

import { deriveAutoPins } from "../../../src/server/ai-outputs/compare/autoPin";

import { pulseFocus } from "../../../src/lib/ui/pulseFocus";
import { flashNeutral } from "../../../src/lib/ui/flashNeutral";
import { flashAccent } from "../../../src/lib/ui/flashAccent";

import { deriveExplainableAutoPins } from "../../../src/server/ai-outputs/compare/explainableAutoPins";

import {
  buildUnifiedFromEngineOnly,
  groupByZone,
  type RecommendationItem,
} from "./recommendations/unified";

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function uniq<T>(xs: T[]) {
  return Array.from(new Set(xs));
}

/** Normalize dot/bracket paths into dot format */
function normalizePath(p: string) {
  return p
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\./, "")
    .trim();
}

// ✅ WOW #7: Pin Packs (localStorage)
type PinPack = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  compareSessionKey: string;

  // Guardamos tone como DiffTone-friendly
  pins: Array<{ path: string; tone: DiffTone }>;

  // opcional: nota humana
  note?: string;
};

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function isPrefixPath(prefix: string, full: string) {
  if (!prefix) return false;
  if (prefix === full) return true;
  return full.startsWith(prefix + ".");
}

function modeFromParam(v: string | null): CompareMode {
  if (v === "payload" || v === "output" || v === "semantic") return v;
  return "semantic";
}

function badgeForSemantic(
  c?: NonNullable<CompareResult["semantic"]>["classification"],
) {
  if (!c)
    return {
      label: "N/A",
      className: "bg-gray-100 text-gray-700 border-gray-200",
    };
  if (c === "UNCHANGED")
    return {
      label: "UNCHANGED",
      className: "bg-green-50 text-green-700 border-green-200",
    };
  if (c === "MINOR")
    return {
      label: "MINOR",
      className: "bg-yellow-50 text-yellow-800 border-yellow-200",
    };
  if (c === "MEANINGFUL")
    return {
      label: "MEANINGFUL",
      className: "bg-orange-50 text-orange-800 border-orange-200",
    };
  return {
    label: "MAJOR_SHIFT",
    className: "bg-red-50 text-red-700 border-red-200",
  };
}

async function postCompare(
  a: string,
  b: string,
  mode: CompareMode,
): Promise<CompareResult> {
  const res = await fetch("/api/outputs/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a, b, mode }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.message ?? "Compare failed";
    throw new Error(msg);
  }
  return json as CompareResult;
}

type OutputHeader = NonNullable<CompareResult["headers"]>["a"];

function HeaderCard({
  title,
  h,
  linkHref,
}: {
  title: string;
  h: OutputHeader;
  linkHref: string;
}) {
  return (
    <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="font-semibold">{title}</div>
        <a
          className="text-sm underline text-neutral-700 hover:text-neutral-900"
          href={linkHref}
        >
          Open
        </a>
      </div>

      <div className="text-sm text-neutral-700 space-y-1">
        <div>
          <span className="text-neutral-500">id:</span>{" "}
          <span className="font-mono">{h.id}</span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <div>
            <span className="text-neutral-500">version:</span>{" "}
            <span className="font-mono">{h.version}</span>
          </div>
          <div>
            <span className="text-neutral-500">kind:</span>{" "}
            <span className="font-mono">{h.kind}</span>
          </div>
          <div>
            <span className="text-neutral-500">model:</span>{" "}
            <span className="font-mono">{h.model ?? "—"}</span>
          </div>
          <div>
            <span className="text-neutral-500">provider:</span>{" "}
            <span className="font-mono">{h.provider ?? "—"}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <div>
            <span className="text-neutral-500">tokens:</span>{" "}
            <span className="font-mono">
              {h.tokensIn ?? "—"} / {h.tokensOut ?? "—"}
            </span>
          </div>
          <div>
            <span className="text-neutral-500">payloadHash:</span>{" "}
            <span className="font-mono">{h.payloadHash ?? "—"}</span>
          </div>
        </div>

        <div>
          <span className="text-neutral-500">created:</span>{" "}
          <span className="font-mono">
            {new Date(h.createdAt).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

type Tone = "changed" | "added" | "removed" | "none";
type PinTone = "changed" | "added" | "removed";

function toneMini(tone: PinTone) {
  return tone === "changed" ? "C" : tone === "added" ? "A" : "R";
}

function toneBadge(tone: Tone) {
  if (tone === "changed")
    return {
      label: "CHANGED",
      cls: "bg-yellow-50 border-yellow-200 text-yellow-900",
    };
  if (tone === "added")
    return {
      label: "ADDED",
      cls: "bg-green-50 border-green-200 text-green-900",
    };
  if (tone === "removed")
    return { label: "REMOVED", cls: "bg-red-50 border-red-200 text-red-900" };
  return null;
}

function toneRowBg(tone: Tone, isPrefixTint: boolean) {
  if (tone === "changed") return "bg-yellow-50/70";
  if (tone === "added") return "bg-green-50/70";
  if (tone === "removed") return "bg-red-50/70";
  return isPrefixTint ? "bg-neutral-50" : "";
}

type JType =
  | "null"
  | "array"
  | "object"
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "undefined"
  | "function";

function safeType(v: any): JType {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (
    t === "string" ||
    t === "number" ||
    t === "boolean" ||
    t === "bigint" ||
    t === "symbol" ||
    t === "undefined" ||
    t === "function"
  ) {
    return t;
  }
  return "object";
}

function isScalarType(t: JType) {
  return t !== "object" && t !== "array";
}

function tokenizeWords(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

type DiffOp = "equal" | "add" | "del";
type DiffToken = { op: DiffOp; t: string };

function diffTokens(aTokens: string[], bTokens: string[]): DiffToken[] {
  // LCS clásico (O(n*m)). Suficiente para headers/strings cortos.
  const n = aTokens.length;
  const m = bTokens.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const ai = aTokens[i]!;
      const bj = bTokens[j]!;
      dp[i]![j] =
        ai === bj
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    const ai = aTokens[i]!;
    const bj = bTokens[j]!;

    if (ai === bj) {
      out.push({ op: "equal", t: ai });
      i++;
      j++;
      continue;
    }

    if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ op: "del", t: ai });
      i++;
    } else {
      out.push({ op: "add", t: bj });
      j++;
    }
  }

  while (i < n) {
    out.push({ op: "del", t: aTokens[i]! });
    i++;
  }
  while (j < m) {
    out.push({ op: "add", t: bTokens[j]! });
    j++;
  }

  // Compacta runs iguales para menos DOM nodes
  const compact: DiffToken[] = [];
  for (const tok of out) {
    const last = compact[compact.length - 1];
    if (last && last.op === tok.op) last.t += tok.t;
    else compact.push({ ...tok });
  }

  return compact;
}

function truncateString(s: string, max = 44) {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

async function copyText(txt: string) {
  try {
    await navigator.clipboard.writeText(txt);
  } catch {
    // ignore
  }
}

function InlineStringDiff({
  a,
  b,
  maxChars = 320,
}: {
  a: string;
  b: string;
  maxChars?: number;
}) {
  const a0 = a.length > maxChars ? a.slice(0, maxChars) + "…" : a;
  const b0 = b.length > maxChars ? b.slice(0, maxChars) + "…" : b;

  const parts = diffTokens(tokenizeWords(a0), tokenizeWords(b0));
  const hasChange = parts.some((p) => p.op !== "equal");
  if (!hasChange) {
    return (
      <span className="font-mono text-emerald-700">{JSON.stringify(a0)}</span>
    );
  }

  return (
    <span className="font-mono text-emerald-700 break-words">
      {parts.map((p, idx) => {
        if (p.op === "equal") return <span key={idx}>{p.t}</span>;

        if (p.op === "add") {
          return (
            <span
              key={idx}
              className="bg-green-50 text-green-800 border border-green-200 rounded px-1"
            >
              {p.t}
            </span>
          );
        }

        return (
          <span
            key={idx}
            className="bg-red-50 text-red-800 border border-red-200 rounded px-1 line-through opacity-90"
          >
            {p.t}
          </span>
        );
      })}
    </span>
  );
}

function JsonScalar({ v }: { v: any }) {
  const t = safeType(v);
  let txt = "";
  if (t === "string") txt = JSON.stringify(v);
  else if (t === "number" || t === "boolean") txt = String(v);
  else if (t === "null") txt = "null";
  else txt = String(v);

  const cls =
    t === "string"
      ? "text-emerald-700"
      : t === "number"
        ? "text-blue-700"
        : t === "boolean"
          ? "text-purple-700"
          : t === "null"
            ? "text-neutral-500"
            : "text-neutral-700";

  return <span className={clsx("font-mono", cls)}>{txt}</span>;
}

function fmtDelta(n: number) {
  if (!Number.isFinite(n)) return "Δ —";
  const abs = Math.abs(n);
  const s =
    abs >= 1000
      ? n.toFixed(0)
      : abs >= 10
        ? n.toFixed(1)
        : abs >= 1
          ? n.toFixed(2)
          : n.toFixed(3);
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `Δ ${sign}${s}`;
}

function InlineValuePill({
  label,
  value,
  tone,
  title,
  onCopy,
}: {
  label: "A" | "B";
  value: React.ReactNode;
  tone: Tone;
  title?: string;
  onCopy?: () => void;
}) {
  const chipCls =
    tone === "changed"
      ? "bg-yellow-50 border-yellow-200"
      : tone === "added"
        ? "bg-green-50 border-green-200"
        : tone === "removed"
          ? "bg-red-50 border-red-200"
          : "bg-neutral-50 border-neutral-200";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border",
        chipCls,
      )}
      title={title}
    >
      <span className="text-[10px] text-neutral-500">{label}:</span>
      {value}
      {onCopy ? (
        <button
          className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-neutral-300 bg-white hover:bg-neutral-50"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCopy();
          }}
          title={`Copy ${label}`}
        >
          Copy
        </button>
      ) : null}
    </span>
  );
}

function InlineHeaderDiff({ a, b, tone }: { a: any; b: any; tone: Tone }) {
  if (tone === "none") return null;

  const ta = safeType(a);
  const tb = safeType(b);

  if (ta === "array" || tb === "array") {
    const la = Array.isArray(a) ? a.length : 0;
    const lb = Array.isArray(b) ? b.length : 0;
    const d = lb - la;

    const deltaChip =
      d === 0 ? null : (
        <span
          className={clsx(
            "ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
            d > 0
              ? "bg-green-50 border-green-200 text-green-900"
              : "bg-red-50 border-red-200 text-red-900",
          )}
        >
          {fmtDelta(d).replace("Δ", "Δlen")}
        </span>
      );

    return (
      <span className="ml-2 inline-flex items-center gap-2">
        <InlineValuePill
          label="A"
          tone={tone}
          value={
            <span className="font-mono text-xs text-neutral-700">len {la}</span>
          }
        />
        <span className="text-[10px] font-semibold text-neutral-500">→</span>
        <InlineValuePill
          label="B"
          tone={tone}
          value={
            <span className="font-mono text-xs text-neutral-700">len {lb}</span>
          }
        />
        {deltaChip}
      </span>
    );
  }

  if (ta === "object" || tb === "object") {
    const ka = a && typeof a === "object" ? Object.keys(a).length : 0;
    const kb = b && typeof b === "object" ? Object.keys(b).length : 0;
    const d = kb - ka;

    const deltaChip =
      d === 0 ? null : (
        <span
          className={clsx(
            "ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
            d > 0
              ? "bg-green-50 border-green-200 text-green-900"
              : "bg-red-50 border-red-200 text-red-900",
          )}
        >
          {fmtDelta(d).replace("Δ", "Δkeys")}
        </span>
      );

    return (
      <span className="ml-2 inline-flex items-center gap-2">
        <InlineValuePill
          label="A"
          tone={tone}
          value={
            <span className="font-mono text-xs text-neutral-700">
              keys {ka}
            </span>
          }
        />
        <span className="text-[10px] font-semibold text-neutral-500">→</span>
        <InlineValuePill
          label="B"
          tone={tone}
          value={
            <span className="font-mono text-xs text-neutral-700">
              keys {kb}
            </span>
          }
        />
        {deltaChip}
      </span>
    );
  }

  if (ta === "string" || tb === "string") {
    const sa = typeof a === "string" ? a : a == null ? "" : String(a);
    const sb = typeof b === "string" ? b : b == null ? "" : String(b);
    const aShow = truncateString(sa);
    const bShow = truncateString(sb);

    return (
      <span className="ml-2 inline-flex items-center gap-2">
        <InlineValuePill
          label="A"
          tone={tone}
          title={sa}
          value={
            <span className="font-mono text-xs text-emerald-700">
              {JSON.stringify(aShow)}
            </span>
          }
          onCopy={() => copyText(sa)}
        />
        <span className="text-[10px] font-semibold text-neutral-500">→</span>
        <InlineValuePill
          label="B"
          tone={tone}
          title={sb}
          value={
            <span className="font-mono text-xs text-emerald-700">
              {JSON.stringify(bShow)}
            </span>
          }
          onCopy={() => copyText(sb)}
        />
      </span>
    );
  }

  if (ta === "number" || tb === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    const d = nb - na;

    const deltaChip =
      Number.isFinite(d) && d !== 0 ? (
        <span
          className={clsx(
            "ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
            d > 0
              ? "bg-green-50 border-green-200 text-green-900"
              : "bg-red-50 border-red-200 text-red-900",
          )}
        >
          {fmtDelta(d)}
        </span>
      ) : null;

    return (
      <span className="ml-2 inline-flex items-center gap-2">
        <InlineValuePill label="A" tone={tone} value={<JsonScalar v={a} />} />
        <span className="text-[10px] font-semibold text-neutral-500">→</span>
        <InlineValuePill label="B" tone={tone} value={<JsonScalar v={b} />} />
        {deltaChip}
      </span>
    );
  }

  const isScalarA = isScalarType(ta);
  const isScalarB = isScalarType(tb);

  if (isScalarA && isScalarB) {
    const left =
      tone === "added" ? (
        <span className="font-mono text-neutral-400">—</span>
      ) : (
        <JsonScalar v={a} />
      );
    const right =
      tone === "removed" ? (
        <span className="font-mono text-neutral-400">—</span>
      ) : (
        <JsonScalar v={b} />
      );

    return (
      <span className="ml-2 inline-flex items-center gap-2">
        <InlineValuePill label="A" tone={tone} value={left} />
        <span className="text-[10px] font-semibold text-neutral-500">→</span>
        <InlineValuePill label="B" tone={tone} value={right} />
      </span>
    );
  }

  return null;
}

function PathChips({
  title,
  paths,
  tone,
  onPick,
  onTogglePin,
  isPinned,
}: {
  title: string;
  paths: string[];
  tone: "changed" | "added" | "removed";
  onPick: (path: string) => void;
  onTogglePin: (path: string) => void;
  isPinned: (path: string) => boolean;
}) {
  if (!paths.length) {
    return (
      <div className="text-sm text-neutral-600">
        <span className="font-semibold">{title}:</span> —
      </div>
    );
  }

  const cls =
    tone === "changed"
      ? "bg-yellow-50 border-yellow-200 text-yellow-900 hover:bg-yellow-100"
      : tone === "added"
        ? "bg-green-50 border-green-200 text-green-900 hover:bg-green-100"
        : "bg-red-50 border-red-200 text-red-900 hover:bg-red-100";

  return (
    <div className="space-y-2">
      <div className="text-sm text-neutral-700">
        <span className="font-semibold">{title}:</span>{" "}
        <span className="text-neutral-500">({paths.length})</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {paths.slice(0, 70).map((p) => {
          const pinnedOn = isPinned(p);
          return (
            <button
              key={p}
              className={clsx(
                "text-xs font-mono px-2 py-1 rounded-full border transition inline-flex items-center gap-2",
                cls,
              )}
              title={`Focus path: ${p}`}
              onClick={() => onPick(p)}
            >
              <span>{p}</span>
              <span
                className={clsx(
                  "text-[10px] px-1.5 py-0.5 rounded-full border bg-white/80 hover:bg-white",
                  "border-neutral-300 text-neutral-800",
                )}
                title={pinnedOn ? "Unpin" : "Pin"}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTogglePin(p);
                }}
              >
                {pinnedOn ? "📌" : "📍"}
              </span>
            </button>
          );
        })}
        {paths.length > 70 ? (
          <span className="text-xs text-neutral-500">
            +{paths.length - 70} more…
          </span>
        ) : null}
      </div>
    </div>
  );
}

function toSearchText(v: any) {
  try {
    if (v == null) return "";
    const t = safeType(v);
    if (t === "string") return String(v);
    if (t === "number" || t === "boolean" || t === "null") return String(v);
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function subtreeMatches(opts: {
  keyLabel: string;
  path: string;
  value: any;
  q: string;
  maxDepth: number;
  budgetRef: { n: number };
}): boolean {
  const { keyLabel, path, value, q, maxDepth, budgetRef } = opts;
  if (!q) return true;
  if (budgetRef.n <= 0) return true;

  budgetRef.n -= 1;

  const hay = `${keyLabel} ${path} ${toSearchText(value)}`.toLowerCase();
  if (hay.includes(q)) return true;

  if (maxDepth <= 0) return false;

  const t = safeType(value);
  if (t === "array") {
    const arr = value as any[];
    for (let i = 0; i < arr.length; i++) {
      if (budgetRef.n <= 0) return true;
      if (
        subtreeMatches({
          keyLabel: String(i),
          path: path ? `${path}.${i}` : String(i),
          value: arr[i],
          q,
          maxDepth: maxDepth - 1,
          budgetRef,
        })
      )
        return true;
    }
  } else if (t === "object") {
    const obj = value ?? {};
    for (const k of Object.keys(obj)) {
      if (budgetRef.n <= 0) return true;
      if (
        subtreeMatches({
          keyLabel: k,
          path: path ? `${path}.${k}` : k,
          value: (obj as any)[k],
          q,
          maxDepth: maxDepth - 1,
          budgetRef,
        })
      )
        return true;
    }
  }

  return false;
}

function ScalarValueWithInlineDiff(props: {
  side: "a" | "b";
  tone: Tone;
  value: any;
  otherValue: any;
}) {
  const { side, tone, value, otherValue } = props;

  const t = safeType(value);
  const tOther = safeType(otherValue);

  if (t === "string" || tOther === "string") {
    const aStr =
      typeof (side === "a" ? value : otherValue) === "string"
        ? side === "a"
          ? value
          : otherValue
        : (side === "a" ? value : otherValue) == null
          ? ""
          : String(side === "a" ? value : otherValue);

    const bStr =
      typeof (side === "b" ? value : otherValue) === "string"
        ? side === "b"
          ? value
          : otherValue
        : (side === "b" ? value : otherValue) == null
          ? ""
          : String(side === "b" ? value : otherValue);

    if (tone === "changed") {
      return (
        <span className="inline-flex items-center gap-2 min-w-0">
          <InlineStringDiff a={aStr} b={bStr} />
          <button
            className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50 shrink-0"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              copyText(side === "a" ? aStr : bStr);
            }}
            title="Copy string"
          >
            Copy
          </button>
        </span>
      );
    }

    if (tone === "added") {
      const s = side === "b" ? bStr : aStr;
      const show = truncateString(s, 140);
      return (
        <span className="inline-flex items-center gap-2 min-w-0">
          <span
            className="font-mono text-emerald-800 bg-green-50 border border-green-200 rounded px-1 break-words"
            title={s}
          >
            {JSON.stringify(show)}
          </span>
          <button
            className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50 shrink-0"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              copyText(s);
            }}
            title="Copy string"
          >
            Copy
          </button>
        </span>
      );
    }

    if (tone === "removed") {
      const s = side === "a" ? aStr : bStr;
      const show = truncateString(s, 140);
      return (
        <span className="inline-flex items-center gap-2 min-w-0">
          <span
            className="font-mono text-red-800 bg-red-50 border border-red-200 rounded px-1 break-words line-through opacity-90"
            title={s}
          >
            {JSON.stringify(show)}
          </span>
          <button
            className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50 shrink-0"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              copyText(s);
            }}
            title="Copy string"
          >
            Copy
          </button>
        </span>
      );
    }

    return <JsonScalar v={value} />;
  }

  return <JsonScalar v={value} />;
}

function JsonDiffTree(props: {
  title: string;
  value: any;
  side: "a" | "b";
  changedPaths: string[];
  addedPaths: string[];
  removedPaths: string[];
  defaultExpandDepth?: number;

  focusPath?: string | null;
  focusToken?: number;
  expandOnlyChanged?: boolean;

  searchQuery?: string;

  getOtherValueAtPath?: (path: string) => any;
}) {
  const {
    title,
    value,
    side,
    changedPaths,
    addedPaths,
    removedPaths,
    defaultExpandDepth = 2,
    focusPath,
    focusToken,
    expandOnlyChanged,
    searchQuery,
    getOtherValueAtPath,
  } = props;

  const q = (searchQuery ?? "").trim().toLowerCase();

  const normChanged = React.useMemo(
    () => changedPaths.map(normalizePath).filter(Boolean),
    [changedPaths],
  );
  const normAdded = React.useMemo(
    () => addedPaths.map(normalizePath).filter(Boolean),
    [addedPaths],
  );
  const normRemoved = React.useMemo(
    () => removedPaths.map(normalizePath).filter(Boolean),
    [removedPaths],
  );

  const changedSet = React.useMemo(() => new Set(normChanged), [normChanged]);
  const addedSet = React.useMemo(() => new Set(normAdded), [normAdded]);
  const removedSet = React.useMemo(() => new Set(normRemoved), [normRemoved]);

  const allRelevant = React.useMemo(() => {
    const xs: string[] = [...normChanged];
    if (side === "b") xs.push(...normAdded);
    if (side === "a") xs.push(...normRemoved);
    return uniq(xs.filter(Boolean));
  }, [normChanged, normAdded, normRemoved, side]);

  function toneForPath(path: string): Tone {
    const p = normalizePath(path);
    if (side === "b" && addedSet.has(p)) return "added";
    if (side === "a" && removedSet.has(p)) return "removed";
    if (changedSet.has(p)) return "changed";
    return "none";
  }

  function prefixTint(path: string) {
    const p = normalizePath(path);
    const any = allRelevant.some((x) => isPrefixPath(p, x));
    return any && toneForPath(p) === "none";
  }

  function shouldAutoOpen(
    path: string,
    depth: number,
    nodeMatchesSearch: boolean,
  ) {
    if (q) {
      if (depth <= 1) return true;
      return nodeMatchesSearch;
    }
    if (!expandOnlyChanged) return depth < defaultExpandDepth;
    const p = normalizePath(path);
    if (depth <= 1) return true;
    return allRelevant.some((x) => isPrefixPath(p, x));
  }

  const elByPathRef = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const [pulsePath, setPulsePath] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!focusPath) return;
    const p = normalizePath(focusPath);
    const el = elByPathRef.current.get(p);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setPulsePath(p);
    const t = setTimeout(
      () => setPulsePath((cur) => (cur === p ? null : cur)),
      1200,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  function Node({
    k,
    v,
    path,
    depth,
  }: {
    k: string | number | null;
    v: any;
    path: string;
    depth: number;
  }) {
    const t = safeType(v);
    const tone = toneForPath(path);
    const tint = prefixTint(path);

    const isObj = t === "object";
    const isArr = t === "array";
    const isExpandable = isObj || isArr;

    const keyLabel =
      k === null ? "" : typeof k === "number" ? `[${k}]` : String(k);
    const normPath = normalizePath(path);
    const isPulse = pulsePath === normPath;

    const qStr = (q ?? "").trim();

    const matchesSearch = React.useMemo(() => {
      if (!qStr) return true;
      const budget = { n: 2500 };
      return subtreeMatches({
        keyLabel: keyLabel || "(root)",
        path: normPath,
        value: v,
        q: qStr,
        maxDepth: 6,
        budgetRef: budget,
      });
    }, [qStr, normPath, keyLabel, v]);

    const qActive = Boolean(qStr);
    const expandOnlyChangedActive = Boolean(expandOnlyChanged);

    const [open, setOpen] = React.useState(() =>
      shouldAutoOpen(path, depth, matchesSearch),
    );

    // Memo “stable” que ESLint sí acepta como dependencia
    const autoOpenArgs = React.useMemo(
      () => ({ path, depth, matchesSearch }),
      [path, depth, matchesSearch],
    );

    React.useEffect(() => {
      // si no está activo el filtro de auto-open, no tocamos el estado
      if (!expandOnlyChangedActive && !qActive) return;

      setOpen(
        shouldAutoOpen(
          autoOpenArgs.path,
          autoOpenArgs.depth,
          autoOpenArgs.matchesSearch,
        ),
      );
    }, [autoOpenArgs, expandOnlyChangedActive, qActive]);

    if (q && !matchesSearch) return null;

    const badge = toneBadge(tone);

    const otherVal =
      getOtherValueAtPath && normPath
        ? getOtherValueAtPath(normPath)
        : undefined;

    const inlineDiff = getOtherValueAtPath
      ? InlineHeaderDiff({
          a: side === "a" ? v : otherVal,
          b: side === "b" ? v : otherVal,
          tone,
        })
      : null;

    return (
      <div
        className={clsx(
          "rounded-md",
          toneRowBg(tone, tint),
          isPulse ? "ring-2 ring-neutral-900 ring-offset-2" : "",
        )}
        ref={(el) => {
          if (!el) return;
          if (!normPath) return;
          elByPathRef.current.set(normPath, el);
        }}
        data-path={normPath}
      >
        <div
          className={clsx(
            "flex items-start gap-2 px-2 py-1 rounded-md outline-none",
            "focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2",
          )}
          tabIndex={0}
          onKeyDown={(e) => {
            if (!isExpandable) return;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setOpen(false);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setOpen(true);
            } else if (e.key === "Enter") {
              e.preventDefault();
              setOpen((s) => !s);
            }
          }}
        >
          <button
            className={clsx(
              "w-5 h-5 rounded border text-xs flex items-center justify-center",
              isExpandable
                ? "border-neutral-300 hover:bg-white"
                : "border-transparent cursor-default",
            )}
            onClick={() => isExpandable && setOpen((s) => !s)}
            disabled={!isExpandable}
            title={isExpandable ? (open ? "Collapse" : "Expand") : ""}
          >
            {isExpandable ? (open ? "−" : "+") : ""}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-neutral-800">
                {keyLabel ? `${keyLabel}:` : ""}
              </span>

              {badge ? (
                <span
                  className={clsx(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                    badge.cls,
                  )}
                >
                  {badge.label}
                </span>
              ) : tint ? (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-neutral-50 border-neutral-200 text-neutral-600">
                  PATH_CHANGED
                </span>
              ) : null}

              {!isExpandable ? (
                <ScalarValueWithInlineDiff
                  side={side}
                  tone={tone}
                  value={v}
                  otherValue={otherVal}
                />
              ) : (
                <span className="text-xs text-neutral-500 font-mono">
                  {isArr
                    ? `Array(${(v as any[])?.length ?? 0})`
                    : `Object(${Object.keys(v ?? {}).length})`}
                </span>
              )}

              {inlineDiff}

              <span
                className="text-[10px] text-neutral-400 font-mono"
                title={normPath}
              >
                {normPath}
              </span>

              {isPulse ? (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-neutral-900 text-white border-neutral-900">
                  FOCUS
                </span>
              ) : null}

              {normPath ? (
                <div className="ml-auto flex gap-2">
                  <button
                    className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      copyText(normPath);
                    }}
                    title="Copy path"
                  >
                    Copy Path
                  </button>
                  <button
                    className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      copyText(JSON.stringify(v, null, 2));
                    }}
                    title="Copy value as JSON"
                  >
                    Copy Value
                  </button>
                </div>
              ) : null}
            </div>

            {isExpandable && open ? (
              <div className="pl-6 mt-1 space-y-1">
                {isArr
                  ? (v as any[]).map((item, idx) => (
                      <Node
                        key={idx}
                        k={idx}
                        v={item}
                        path={path ? `${path}.${idx}` : String(idx)}
                        depth={depth + 1}
                      />
                    ))
                  : Object.keys(v ?? {}).map((key) => (
                      <Node
                        key={key}
                        k={key}
                        v={(v as any)[key]}
                        path={path ? `${path}.${key}` : key}
                        depth={depth + 1}
                      />
                    ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="font-semibold">{title}</div>
        <div className="flex gap-2 flex-wrap">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-yellow-50 border-yellow-200 text-yellow-900">
            CHANGED
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-green-50 border-green-200 text-green-900">
            ADDED
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-red-50 border-red-200 text-red-900">
            REMOVED
          </span>
          {q ? (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-neutral-900 text-white border-neutral-900">
              SEARCH
            </span>
          ) : null}
        </div>
      </div>

      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-2 max-h-[560px] overflow-auto">
        <Node k={null} v={value} path={""} depth={0} />
      </div>
    </div>
  );
}

function PrettyJson({ value }: { value: any }) {
  return (
    <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words bg-neutral-50 border border-neutral-200 rounded-lg p-3 overflow-auto max-h-[360px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ValuePanel({
  label,
  tone,
  value,
  onCopy,
}: {
  label: string;
  tone: Tone;
  value: any;
  onCopy: () => void;
}) {
  const badge = toneBadge(tone);
  return (
    <div className="border border-neutral-200 rounded-xl p-3 bg-white shadow-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm">{label}</div>
        <div className="flex items-center gap-2">
          {badge ? (
            <span
              className={clsx(
                "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                badge.cls,
              )}
            >
              {badge.label}
            </span>
          ) : null}
          <button
            className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
            onClick={onCopy}
            title="Copy JSON"
          >
            Copy
          </button>
        </div>
      </div>
      <PrettyJson value={value} />
    </div>
  );
}

type HotspotGroup =
  | "CONTENT"
  | "METADATA"
  | "MODEL"
  | "TIMING"
  | "INPUT"
  | "OTHER";

function hotspotGroupForPath(path: string): HotspotGroup {
  const p = String(path || "").toLowerCase();

  // contenido principal (ajusta a tu schema real cuando lo tengas)
  if (
    p.startsWith("$.sections") ||
    p.startsWith("$.result") ||
    p.startsWith("$.interpreted") ||
    p.startsWith("$.summary") ||
    p.startsWith("$.content")
  )
    return "CONTENT";

  // metadata / auditoría / job info
  if (p.startsWith("$.metadata") || p.includes("job") || p.includes("hash"))
    return "METADATA";

  // modelo / provider
  if (p.includes("model") || p.includes("provider") || p.includes("tokens"))
    return "MODEL";

  // timestamps
  if (
    p.includes("createdat") ||
    p.includes("finishedat") ||
    p.includes("generatedat") ||
    p.includes("time")
  )
    return "TIMING";

  // inputs/payload-ish
  if (
    p.startsWith("$.payload") ||
    p.startsWith("$.inputs") ||
    p.startsWith("$.brief") ||
    p.startsWith("$.signals")
  )
    return "INPUT";

  return "OTHER";
}

function titleForGroup(g: HotspotGroup) {
  switch (g) {
    case "CONTENT":
      return "Contenido real";
    case "METADATA":
      return "Metadata/Auditoría";
    case "MODEL":
      return "Modelo/Proveedor";
    case "TIMING":
      return "Tiempos";
    case "INPUT":
      return "Inputs/Brief/Signals";
    default:
      return "Otros";
  }
}

export default function OutputsComparePage() {
  const sp = useSearchParams();
  const router = useRouter();

  const a = (sp.get("a") ?? "").trim();
  const b = (sp.get("b") ?? "").trim();
  const mode = modeFromParam(sp.get("mode"));

  const [activeTab, setActiveTab] = React.useState<"semantic" | "side" | "raw">(
    mode === "payload" || mode === "output" ? "side" : "semantic",
  );

  const [view, setView] = React.useState<"payload" | "output">(
    mode === "output" ? "output" : "payload",
  );
  const [onlyChanged, setOnlyChanged] = React.useState(false);
  const [expandOnlyChanged, setExpandOnlyChanged] = React.useState(false);
  const [search, setSearch] = React.useState("");

  // focus navigation
  const [focusPath, setFocusPath] = React.useState<string | null>(null);
  const [focusPulseTick, bumpFocusPulseTick] = React.useState(0);

  const [focusToken, setFocusToken] = React.useState(0);
  const [focusIndex, setFocusIndex] = React.useState(0);

  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [data, setData] = React.useState<CompareResult | null>(null);
  const [explain, setExplain] = React.useState<any | null>(null);

  // ✅ WOW #14.2: Unified zones collapsed state (persisted)
  const unifiedZonesStorageKey = React.useMemo(() => {
    // Scope por compare pair + mode/view (evita que se mezclen estados)
    return `ia.unifiedZonesCollapsed.v1:a=${a}|b=${b}|mode=${mode}|view=${view}`;
  }, [a, b, mode, view]);

  const [collapsedUnifiedZones, setCollapsedUnifiedZones] = React.useState<
    Record<string, boolean>
  >(() => {
    try {
      const raw = localStorage.getItem(unifiedZonesStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(
        unifiedZonesStorageKey,
        JSON.stringify(collapsedUnifiedZones),
      );
    } catch {
      // no-op
    }
  }, [collapsedUnifiedZones, unifiedZonesStorageKey]);

  const toggleUnifiedZone = React.useCallback((zone: string) => {
    const k = String(zone);
    setCollapsedUnifiedZones((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);

  const isZoneCollapsed = React.useCallback(
    (zone: string) => !!collapsedUnifiedZones[String(zone)],
    [collapsedUnifiedZones],
  );

  const collapseAllUnifiedZones = React.useCallback((zones: string[]) => {
    setCollapsedUnifiedZones((prev) => {
      const next = { ...prev };
      for (const z of zones) next[String(z)] = true;
      return next;
    });
  }, []);

  const expandAllUnifiedZones = React.useCallback((zones: string[]) => {
    setCollapsedUnifiedZones((prev) => {
      const next = { ...prev };
      for (const z of zones) next[String(z)] = false;
      return next;
    });
  }, []);

  // ✨ WOW #3 (flagship extra): micro-toast + guided focus tour

  const recTourRef = React.useRef<{ runId: number; timer?: number }>({
    runId: 0,
  });

  const [toast, setToast] = React.useState<string | null>(null);

  // ✅ WOW #6: Guided Tour (Recommended Pins Tour)
  const [tourOpen, setTourOpen] = React.useState(false);
  const [tourPaths, setTourPaths] = React.useState<string[]>([]);
  const [tourIndex, setTourIndex] = React.useState(0);

  // ✅ WOW #7: Pin Packs (state INSIDE component)
  const [packsOpen, setPacksOpen] = React.useState(false);
  const [pinPacks, setPinPacks] = React.useState<PinPack[]>([]);
  const [packName, setPackName] = React.useState("");

  // Scope ref: todo el panel donde vive JsonDiffTree
  const diffScopeRef = React.useRef<HTMLDivElement | null>(null);

  const [lastPinAction, setLastPinAction] = React.useState<
    "pin" | "unpin" | null
  >(null);

  const [lastAssistAction, setLastAssistAction] = React.useState<
    "auto-pin" | "recommended" | null
  >(null);

  // Pulse automático cuando cambia el focus lógico
  React.useEffect(() => {
    if (!focusPath) return;
    pulseFocus(diffScopeRef.current);
  }, [focusPath]);

  React.useEffect(() => {
    if (lastPinAction !== "unpin") return;
    flashNeutral(diffScopeRef.current);
    const t = window.setTimeout(() => setLastPinAction(null), 0);
    return () => window.clearTimeout(t);
  }, [lastPinAction]);

  React.useEffect(() => {
    if (!lastAssistAction) return;
    flashAccent(diffScopeRef.current);
    const t = window.setTimeout(() => setLastAssistAction(null), 0);
    return () => window.clearTimeout(t);
  }, [lastAssistAction]);

  function startTour(paths: string[]) {
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const p of paths) {
      const np = normalizePath(p);
      if (!np) continue;
      if (seen.has(np)) continue;
      seen.add(np);
      uniq.push(np);
    }
    if (!uniq.length) {
      showToast("No tour items");
      return;
    }

    setTourPaths(uniq);
    setTourIndex(0);
    setTourOpen(true);

    // focus first
    focusFromChip(uniq[0]!);
    showToast(`🧭 Tour started (1 / ${uniq.length})`);
  }

  function stopTour() {
    setTourOpen(false);
    showToast("🧭 Tour stopped");
  }

  function goTour(i: number) {
    if (!tourPaths.length) return;
    const next = Math.max(0, Math.min(i, tourPaths.length - 1));
    setTourIndex(next);
    focusFromChip(tourPaths[next]!);
    showToast(`🧭 Tour ${next + 1} / ${tourPaths.length}`);
  }

  function nextTour() {
    goTour(tourIndex + 1);
  }

  function prevTour() {
    goTour(tourIndex - 1);
  }

  React.useEffect(() => {
    if (!tourOpen) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") stopTour();
      if (e.key === "n" || e.key === "N") nextTour();
      if (e.key === "p" || e.key === "P") prevTour();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourOpen, tourIndex, tourPaths]);

  // pins import modal
  const [showImportPins, setShowImportPins] = React.useState(false);
  const [importText, setImportText] = React.useState("");
  const [importInfo, setImportInfo] = React.useState<string | null>(null);

  // ✅ Pins: scope por a/b/mode (sin mezclar compare sessions)
  const compareSessionKey = React.useMemo(() => {
    return `compare:v1:a=${a || "—"}:b=${b || "—"}:mode=${mode}`;
  }, [a, b, mode]);

  const packsStorageKey = React.useMemo(() => {
    return `innova:v1:pinPacks:${compareSessionKey}`;
  }, [compareSessionKey]);

  const pinned = usePinnedCompare({
    compareSessionKey,
    prevOutputId: a || "",
    nextOutputId: b || "",
  });

  // Load packs once per session key
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(packsStorageKey);
      if (!raw) {
        setPinPacks([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setPinPacks(parsed);
      else setPinPacks([]);
    } catch {
      setPinPacks([]);
    }
  }, [packsStorageKey]);

  // Save packs whenever they change
  React.useEffect(() => {
    try {
      localStorage.setItem(packsStorageKey, JSON.stringify(pinPacks));
    } catch {
      // ignore (private mode / quota)
    }
  }, [packsStorageKey, pinPacks]);

  const pinnedCount = pinned.count;

  function pushParams(
    next: Partial<{ a: string; b: string; mode: CompareMode }>,
  ) {
    const qs = new URLSearchParams(sp.toString());
    if (next.a != null) qs.set("a", next.a);
    if (next.b != null) qs.set("b", next.b);
    if (next.mode != null) qs.set("mode", next.mode);
    router.push(`/outputs/compare?${qs.toString()}`);
  }

  React.useEffect(() => {
    let alive = true;

    async function run() {
      setErr(null);
      setData(null);
      setExplain(null);

      if (!a || !b) {
        setErr(
          "Faltan parámetros: requiere ?a=<uuid>&b=<uuid> (opcional mode=payload|output|semantic).",
        );
        return;
      }

      setLoading(true);
      try {
        const out = await postCompare(a, b, mode);
        if (!alive) return;
        setData(out);

        // WOW #1: fetch explanation (determinístico)
        try {
          const er = await fetch("/api/outputs/compare/explain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ compare: out }),
          });
          const ej = await er.json().catch(() => null);
          if (!alive) return;
          if (er.ok) setExplain(ej);
          else setExplain(null);
        } catch {
          if (!alive) return;
          setExplain(null);
        }

        if (mode === "payload" || mode === "output") setActiveTab("side");
        else setActiveTab("semantic");
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Error desconocido.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [a, b, mode]);

  const semBadge = badgeForSemantic(data?.semantic?.classification);

  const aLink = data?.headers?.a?.id
    ? `/outputs/${encodeURIComponent(data.headers.a.id)}`
    : "#";
  const bLink = data?.headers?.b?.id
    ? `/outputs/${encodeURIComponent(data.headers.b.id)}`
    : "#";

  const aJsonBase =
    view === "payload"
      ? data?.snapshots?.aPayloadJson
      : data?.snapshots?.aOutputJson;
  const bJsonBase =
    view === "payload"
      ? data?.snapshots?.bPayloadJson
      : data?.snapshots?.bOutputJson;

  // ✅ Choose structural diff based on current view (payload vs output)
  // Fallbacks keep compatibility with older compare results.
  const structuralForView = React.useMemo(() => {
    if (!data) return null;

    if (view === "payload") {
      return (
        (data as any).structuralPayload ?? (data as any).structural ?? null
      );
    }
    // view === "output"
    return (data as any).structuralOutput ?? (data as any).structural ?? null;
  }, [data, view]);

  const changedPaths = React.useMemo(() => {
    return (structuralForView as any)?.json?.changedPaths ?? [];
  }, [structuralForView]);

  const addedPaths = React.useMemo(() => {
    return (structuralForView as any)?.json?.addedPaths ?? [];
  }, [structuralForView]);

  const removedPaths = React.useMemo(() => {
    return (structuralForView as any)?.json?.removedPaths ?? [];
  }, [structuralForView]);

  const hotspotRows = React.useMemo(() => {
    type Tone = "changed" | "added" | "removed";
    const rows: { path: string; tone: Tone; group: HotspotGroup }[] = [];

    const pushAll = (tone: Tone, arr?: string[]) => {
      for (const p of arr ?? []) {
        if (!p) continue;
        rows.push({ path: p, tone, group: hotspotGroupForPath(p) });
      }
    };

    pushAll("changed", changedPaths);
    pushAll("added", addedPaths);
    pushAll("removed", removedPaths);

    // de-dupe (tone:path)
    const seen = new Set<string>();
    const out: typeof rows = [];
    for (const r of rows) {
      const k = `${r.tone}:${r.path}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }

    return out;
  }, [changedPaths, addedPaths, removedPaths]);

  const hotspotsByGroup = React.useMemo(() => {
    type Tone = "changed" | "added" | "removed";

    const toneWeight: Record<Tone, number> = {
      changed: 3,
      added: 2,
      removed: 1,
    };

    // Paths que suelen ser “ruido” o menos prioritarios (los empujamos hacia abajo)
    const lowSignalPrefixes = [
      "metadata.generatedAt",
      "metadata.jobId",
      "metadata.hash",
      "metadata.duration",
      "metadata.latency",
      "metadata.trace",
      "metadata.requestId",
    ];

    function pathPriority(p: string) {
      // menor número = más arriba
      for (let i = 0; i < lowSignalPrefixes.length; i++) {
        const pref = lowSignalPrefixes[i]!; // existe por el bound del loop
        if (p.startsWith(pref)) return 100 + i;
      }
      // “contenido” típico arriba
      if (p.startsWith("sections")) return 0;
      if (p.startsWith("interpretedContext")) return 1;
      if (p.startsWith("summary")) return 2;
      if (p.startsWith("style")) return 3;
      return 10;
    }

    // Group weight (para ordenar grupos por impacto)
    const groupWeight: Record<HotspotGroup, number> = {
      CONTENT: 100,
      INPUT: 80,
      MODEL: 60,
      METADATA: 20,
      TIMING: 10,
      OTHER: 5,
    };

    const m: Record<string, typeof hotspotRows> = {};
    for (const r of hotspotRows) {
      const k = r.group;
      if (!m[k]) m[k] = [];
      m[k].push(r);
    }

    // sort rows inside each group
    for (const g of Object.keys(m)) {
      const arr = m[g];
      if (!arr) continue;

      arr.sort((a, b) => {
        const tw = toneWeight[b.tone] - toneWeight[a.tone]; // changed > added > removed
        if (tw !== 0) return tw;

        const pa = pathPriority(a.path);
        const pb = pathPriority(b.path);
        if (pa !== pb) return pa - pb;

        return a.path.localeCompare(b.path);
      });
    }

    // Build groups (only non-empty), with impact score
    const groups = (Object.keys(m) as HotspotGroup[])
      .filter((g) => (m[g]?.length ?? 0) > 0)
      .map((g) => {
        const rows = m[g] ?? [];
        const score =
          (groupWeight[g] ?? 0) * 1000 +
          rows.reduce((acc, r) => acc + (toneWeight[r.tone] ?? 0), 0);

        return { group: g, rows, score };
      });

    // Sort groups by score desc, tie-breaker by preferred order
    const preferred: HotspotGroup[] = [
      "CONTENT",
      "INPUT",
      "MODEL",
      "METADATA",
      "TIMING",
      "OTHER",
    ];
    const prefIndex = new Map(preferred.map((g, i) => [g, i]));

    groups.sort((a, b) => {
      const ds = b.score - a.score;
      if (ds !== 0) return ds;
      return (prefIndex.get(a.group) ?? 999) - (prefIndex.get(b.group) ?? 999);
    });

    // strip score for render (optional: si lo quieres mostrar, NO lo quites)
    return groups.map(({ group, rows }) => ({ group, rows }));
  }, [hotspotRows]);

  // ✅ Snapshot guards (para UX: si no hay outputJson, evitamos “botones fantasma”)
  const isMissingSnapshots = React.useMemo(() => {
    if (!data) return false;

    const snaps = data.snapshots;
    if (!snaps) return true;

    // si el usuario está viendo output pero no existe outputJson en A o B -> faltan snapshots para esa vista
    if (view === "output") {
      return (
        typeof snaps.aOutputJson === "undefined" ||
        typeof snaps.bOutputJson === "undefined"
      );
    }

    // payload view
    return false;
  }, [data, view]);

  const noStructuralDiffs = React.useMemo(() => {
    const j = (structuralForView as any)?.json;
    const n =
      (j?.changedCount ?? 0) + (j?.addedCount ?? 0) + (j?.removedCount ?? 0);

    return Boolean(data) && n === 0;
  }, [data, structuralForView]);

  const navDisabled = isMissingSnapshots || noStructuralDiffs;

  const outputSnapshotsMissing = React.useMemo(() => {
    if (!data) return false;
    const s = data.snapshots;
    if (!s) return true;
    return (
      typeof s.aOutputJson === "undefined" ||
      typeof s.bOutputJson === "undefined"
    );
  }, [data]);

  const payloadSnapshotsMissing = React.useMemo(() => {
    if (!data) return false;
    const s = data.snapshots;
    if (!s) return true;
    return (
      typeof s.aPayloadJson === "undefined" ||
      typeof s.bPayloadJson === "undefined"
    );
  }, [data]);

  // ✅ Can the UI show Output view safely?
  const canViewOutput = Boolean(data) && !outputSnapshotsMissing;

  // ✅ Auto-fallback: si el usuario eligió Output pero no hay snapshots de output,
  // nos cambiamos automáticamente a Payload para evitar UI vacía
  React.useEffect(() => {
    if (!data) return;
    if (view !== "output") return;
    if (!outputSnapshotsMissing) return;

    setView("payload");
  }, [data, view, outputSnapshotsMissing]);

  // Stable ordered list of diff paths
  const diffList = React.useMemo(() => {
    const items: Array<{ path: string; tone: PinTone }> = [];
    for (const p of changedPaths) items.push({ path: p, tone: "changed" });
    for (const p of addedPaths) items.push({ path: p, tone: "added" });
    for (const p of removedPaths) items.push({ path: p, tone: "removed" });

    const seen = new Set<string>();
    const out: typeof items = [];
    for (const it of items) {
      if (!it.path) continue;
      if (seen.has(it.path)) continue;
      seen.add(it.path);
      out.push(it);
    }
    return out;
  }, [changedPaths, addedPaths, removedPaths]);

  const allPaths = React.useMemo(
    () => uniq(diffList.map((d) => d.path)),
    [diffList],
  );

  // 🔥 WOW #10 — Auto-Pin Decision Engine (memoized)
  const cr = data;
  // si en algún momento fuera data.compareResult, cambias SOLO esta línea

  const recommended = React.useMemo(
    () =>
      cr
        ? deriveAutoPins(cr)
        : { category: "mixed", recommendedPins: [], reasons: ["No data yet"] },
    [cr],
  );

  const autoPins = React.useMemo(
    () => (cr ? deriveExplainableAutoPins(cr, compareSessionKey) : null),
    [cr, compareSessionKey],
  );

  const recommendedPinsRaw = recommended?.recommendedPins ?? [];
  const recommendedSeedRef = React.useRef<string[] | null>(null);

  const recommendedPins = React.useMemo(() => {
    // Helpers locales (no dependen del scope externo)
    const uniq = (xs: string[]) => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const x of xs) {
        const v = normalizePath(x);
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
      }
      return out;
    };

    const cacheIfFirstNonEmpty = (xs: string[]) => {
      if (xs.length > 0 && !recommendedSeedRef.current) {
        recommendedSeedRef.current = xs;
      }
      return xs;
    };

    // 1) Si el engine trae recomendaciones reales, úsalo.
    //    Además: si el seed actual era fallback, lo reemplazamos por el engine (más correcto).
    if (recommendedPinsRaw.length > 0) {
      const engine = uniq(recommendedPinsRaw);

      // Si no había seed, lo seteamos.
      if (!recommendedSeedRef.current) {
        recommendedSeedRef.current = engine;
        return engine;
      }

      // Si ya había seed, pero parece fallback (termina en .*) o está vacío, actualizamos al engine.
      const seed = recommendedSeedRef.current;
      const seedLooksFallback = seed.some((p) => p.endsWith(".*"));
      if (seed.length === 0 || seedLooksFallback) {
        recommendedSeedRef.current = engine;
        return engine;
      }

      // Si ya teníamos seed estable y NO era fallback, mantenemos seed (estabilidad visual),
      // pero si quieres priorizar engine siempre, cambia esto por: return engine;
      return engine;
    }

    // 2) Si ya tenemos seed cacheado, úsalo (estabilidad por sesión)
    if (recommendedSeedRef.current && recommendedSeedRef.current.length > 0) {
      return recommendedSeedRef.current;
    }

    // 3) Fallback v2: deriva recomendaciones desde paths reales del diff
    const paths = uniq([
      ...(changedPaths ?? []),
      ...(addedPaths ?? []),
      ...(removedPaths ?? []),
    ]);

    if (paths.length === 0) return [];

    const prefixes = new Set<string>();

    for (const p of paths) {
      if (!p || p === "<root>") {
        prefixes.add("<root>.*");
        continue;
      }

      // top-level
      const parts = p.split(".").filter(Boolean);
      if (parts.length === 0) {
        prefixes.add("<root>.*");
        continue;
      }

      const top = parts[0];
      prefixes.add(`${top}.*`);

      // segundo nivel (si existe) para mayor precisión sin explotar la lista
      if (parts.length >= 2) {
        prefixes.add(`${top}.${parts[1]}.*`);
      }
    }

    // Orden estable: root primero, luego alfabético
    const fallback = Array.from(prefixes).sort((a, b) => {
      if (a === "<root>.*") return -1;
      if (b === "<root>.*") return 1;
      return a.localeCompare(b);
    });

    // cachea el fallback (primer set no vacío) para que no "desaparezca"
    return cacheIfFirstNonEmpty(fallback);
  }, [recommendedPinsRaw, changedPaths, addedPaths, removedPaths]);

  const recommendedReason = recommended?.reasons?.[0];

  const unifiedRecs = React.useMemo(() => {
    const out = buildUnifiedFromEngineOnly({
      enginePins: [], // 👉 no tenemos RecommendedPin[] aquí
      uiAutoPins: {
        recommendedPins: recommendedPinsRaw ?? [],
        reasons: recommendedReason ? [recommendedReason] : undefined,
      },
    });

    // ✅ WOW #14.1: ranking real (engineScore > zoneShare > hotspotWeight)
    const items = Array.isArray(out?.items) ? [...out.items] : [];
    items.sort((a: any, b: any) => {
      const aEngine = typeof a.engineScore === "number" ? a.engineScore : 0;
      const bEngine = typeof b.engineScore === "number" ? b.engineScore : 0;
      if (bEngine !== aEngine) return bEngine - aEngine;

      const aZone = typeof a.zoneShare === "number" ? a.zoneShare : 0;
      const bZone = typeof b.zoneShare === "number" ? b.zoneShare : 0;
      if (bZone !== aZone) return bZone - aZone;

      const aHot = typeof a.hotspotWeight === "number" ? a.hotspotWeight : 0;
      const bHot = typeof b.hotspotWeight === "number" ? b.hotspotWeight : 0;
      if (bHot !== aHot) return bHot - aHot;

      const aid = String(a.id ?? "");
      const bid = String(b.id ?? "");
      if (aid && bid && aid !== bid) return aid.localeCompare(bid);

      const ap = String(a.pinPath ?? "");
      const bp = String(b.pinPath ?? "");
      return ap.localeCompare(bp);
    });

    return { ...out, items };
  }, [recommendedPinsRaw, recommendedReason]);

  const unifiedSignalsN = unifiedRecs?.items?.length ?? 0;

  const unifiedZonesN = React.useMemo(() => {
    const items = unifiedRecs?.items ?? [];
    if (!items.length) return 0;

    const zones = new Set<string>();
    for (const it of items as RecommendationItem[]) {
      zones.add(String(it.zone ?? "other"));
    }
    return zones.size;
  }, [unifiedRecs]);

  // ✅ Solo cuenta recomendaciones "nuevas" (unified) que aún no están pinned
  const recommendedNTotalUnified = unifiedRecs?.items?.length ?? 0;

  const recommendedNNew = React.useMemo(() => {
    const recs = unifiedRecs?.recommended ?? [];
    if (!recs.length) return 0;

    const existing = new Set<string>();
    for (const p of pinned.pins ?? []) {
      const pAny = p as any;
      const pPath =
        (typeof pAny.path === "string" && pAny.path) ||
        (typeof pAny.pointer === "string" && pAny.pointer) ||
        (typeof pAny.id === "string" && pAny.id) ||
        "";

      const pTone = String(pAny.tone ?? "changed");
      if (pPath) existing.add(`${normalizePath(pPath)}::${pTone}`);
    }

    let n = 0;

    for (const it of recs) {
      const rec = normalizePath(it.pinPath);

      if (rec.endsWith(".*")) {
        const root = rec.slice(0, -2);
        const pref = root === "<root>" ? "<root>" : `${root}.`;
        const prefNorm = normalizePath(pref);

        // cuenta como "nuevo" si existe al menos un diff bajo el prefijo
        // que aún no esté pinned como changed
        const hasNewUnderPrefix = diffList.some((x) => {
          const xp = normalizePath(x.path);
          return xp.startsWith(prefNorm) && !existing.has(`${xp}::changed`);
        });

        if (hasNewUnderPrefix) n += 1;
        continue;
      }

      const path = normalizePath(rec);
      const key = `${path}::changed`;
      if (!existing.has(key)) n += 1;
    }

    return n;
  }, [unifiedRecs, pinned.pins, diffList]);

  function applyRecommendedPins() {
    const recs = unifiedRecs?.recommended ?? [];

    if (!recs.length) {
      showToast?.("No recommendations");
      return;
    }

    // Build once (faster + fewer typescript headaches)
    const existing = new Set<string>();
    for (const p of pinned.pins ?? []) {
      const pAny = p as any;
      const pPath =
        (typeof pAny.path === "string" && pAny.path) ||
        (typeof pAny.pointer === "string" && pAny.pointer) ||
        (typeof pAny.id === "string" && pAny.id) ||
        "";

      const pTone = String(pAny.tone ?? "changed");
      if (pPath) existing.add(`${normalizePath(pPath)}::${pTone}`);
    }

    const countPins = () => pinned.pins?.length ?? 0;

    let applied = 0;

    for (const it of recs) {
      const rec = normalizePath(it.pinPath);

      // Prefix pin: "metadata.*" / "sections.*" / "<root>.*"
      if (rec.endsWith(".*")) {
        const root = rec.slice(0, -2); // remove ".*"
        const pref = root === "<root>" ? "<root>" : `${root}.`;

        const before = countPins();
        pinPrefix(pref); // ✅ reuse your existing pinPrefix
        const after = countPins();

        // Update applied count
        applied += Math.max(0, after - before);

        // refresh existing set after prefix operation (since pinPrefix can add multiple)
        for (const p of pinned.pins ?? []) {
          const pAny = p as any;
          const pPath =
            (typeof pAny.path === "string" && pAny.path) ||
            (typeof pAny.pointer === "string" && pAny.pointer) ||
            (typeof pAny.id === "string" && pAny.id) ||
            "";

          const pTone = String(pAny.tone ?? "changed");
          if (pPath) existing.add(`${normalizePath(pPath)}::${pTone}`);
        }

        continue;
      }

      // Exact path pin
      const path = normalizePath(rec);
      const key = `${path}::changed`;

      if (existing.has(key)) continue;

      pinned.togglePin({ path, tone: "changed" as any });
      existing.add(key);
      applied += 1;
    }

    // ✅ WOW #11.3 — secondary accent flash for assisted action
    if (applied > 0) setLastAssistAction("recommended");

    // UX message
    const msg =
      recommendedReason ||
      recommended?.reasons?.[0] ||
      `Pinned recommended (${recs.length})`;

    showToast?.(`✨ ${msg}${applied ? ` — +${applied}` : ""}`);
  }

  const onPinRecommended = applyRecommendedPins;

  const pinPrefix = React.useCallback(
    (prefix: string, tone: DiffTone = "changed") => {
      let pref = normalizePath(prefix);

      // ✅ Soporta el caso Hotspots: "<root>." vs diff: "<root>"
      pref = pref.replace(/\.$/, "");

      if (!pref) return 0;

      const existing = new Set<string>();
      for (const p of pinned.pins ?? []) {
        const pAny = p as any;
        const pPath =
          (typeof pAny.path === "string" && pAny.path) ||
          (typeof pAny.pointer === "string" && pAny.pointer) ||
          (typeof pAny.id === "string" && pAny.id) ||
          "";

        const pTone = String(pAny.tone ?? "changed");
        if (pPath) existing.add(`${normalizePath(pPath)}::${pTone}`);
      }

      const candidates = (diffList ?? [])
        .map((d: any) => ({
          path: normalizePath(String(d.path ?? "")),
          tone: (d.tone ?? tone) as DiffTone,
        }))
        .filter((d: any) => {
          if (!d.path) return false;

          // ✅ match exacto o por prefijo
          if (d.path === pref) return true;
          return d.path.startsWith(pref);
        });

      let added = 0;
      for (const c of candidates) {
        const key = `${c.path}::${c.tone}`;
        if (existing.has(key)) continue;
        pinned.togglePin({ path: c.path, tone: c.tone });
        existing.add(key);
        added++;
      }

      return added;
    },
    [pinned, diffList],
  );

  const hotspots = React.useMemo(
    () => computeHotspots(diffList as any[]),
    [diffList],
  );

  const zones = React.useMemo(() => topZones(hotspots), [hotspots]);

  const defaultPrefixForZone = (zone: string) => {
    switch (zone) {
      case "metadata":
        return "metadata.";
      case "content":
        return "content.";
      case "model":
        return "model.";
      case "input":
        return "input.";
      default:
        return "";
    }
  };

  function getAtPath(obj: any, path: string): any {
    if (obj == null) return undefined;
    const norm = normalizePath(path);
    if (!norm) return obj;
    const parts = norm.split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      const isIndex = /^[0-9]+$/.test(p);
      cur = (cur as any)[isIndex ? Number(p) : p];
    }
    return cur;
  }

  const pinnedItems = React.useMemo(() => {
    return pinned.pins
      .map((p) => {
        const path = normalizePath(String(p.pointer));
        const tone =
          (p.tone as any) === "added" ||
          (p.tone as any) === "removed" ||
          (p.tone as any) === "changed"
            ? (p.tone as PinTone)
            : ("changed" as const);
        return { path, tone };
      })
      .filter((x) => x.path);
  }, [pinned.pins]);

  const aJson = onlyChanged
    ? Object.fromEntries(allPaths.map((p) => [p, getAtPath(aJsonBase, p)]))
    : aJsonBase;
  const bJson = onlyChanged
    ? Object.fromEntries(allPaths.map((p) => [p, getAtPath(bJsonBase, p)]))
    : bJsonBase;

  React.useEffect(() => {
    if (search.trim()) {
      setOnlyChanged(false);
      setExpandOnlyChanged(false);
    }
  }, [search]);

  // Reset focus when list changes
  React.useEffect(() => {
    const first = diffList.at(0);
    if (!first) {
      setFocusIndex(0);
      setFocusPath(null);
      return;
    }
    setFocusIndex(0);
    setFocusPath(first.path);
    setFocusToken((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffList.length]);

  function focusToIndex(nextIdx: number) {
    if (!diffList.length) return;
    const n = diffList.length;
    const idx = ((nextIdx % n) + n) % n;
    const p = diffList[idx]?.path;
    if (!p) return;
    setFocusIndex(idx);
    setFocusPath(p);
    setFocusToken((t) => t + 1);
    setActiveTab("side");
  }

  function focusNext(dir: 1 | -1) {
    if (!diffList.length) return;
    focusToIndex(focusIndex + dir);
  }

  function focusFromChip(p: string, tone?: PinTone) {
    const np = normalizePath(p);

    // ✅ Intento #1: match exacto path + tone
    if (tone) {
      const idxExact = diffList.findIndex(
        (x) => x.path === np && x.tone === tone,
      );
      if (idxExact >= 0) return focusToIndex(idxExact);
    }

    // ✅ Intento robusto: probar variantes del path (raw / outputJson.* / payloadJson.*)
    const candidates = toTreePath(np);

    // string garantizado (TS-proof)
    let target: string = candidates[0] ?? "<root>";

    // Best-effort scroll: probamos cada candidato
    for (const c of candidates) {
      const idx = diffList.findIndex((x) => x.path === c);
      if (idx >= 0) {
        focusToIndex(idx);
        target = c;
        break;
      }
    }

    // SIEMPRE manda focus al tree (expand/scroll/highlight) + WOW pulse
    setActiveTab("side");
    focusAndPulse(target);
    setFocusToken((t) => t + 1);
  }

  // ✅ WOW #3: Suggested Pins helpers
  function bestToneForPath(path: string): PinTone {
    const np = normalizePath(path);

    // Prefer exact match in diffList (path+tone)
    const exact = diffList.find((x) => x.path === np);
    if (exact) return exact.tone;

    // Fallback: pick strongest tone if multiple exist (changed > added > removed)
    const any = diffList.filter((x) => x.path === np);
    if (any.length) {
      if (any.some((x) => x.tone === "changed")) return "changed";
      if (any.some((x) => x.tone === "added")) return "added";
      if (any.some((x) => x.tone === "removed")) return "removed";
    }

    // Default (keeps pins consistent even if path isn't in structural list)
    return "changed";
  }

  function ensurePinned(path: string, tone: PinTone) {
    const rowId = makeRowId(normalizePath(path), tone as DiffTone);
    if (pinned.isPinned(rowId)) return false; // already pinned
    pinned.togglePin({ path: normalizePath(path), tone: tone as DiffTone });
    return true; // newly pinned
  }

  function num(v: unknown, fallback = 0) {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  }

  // ✨ WOW #3: micro-toast helper (auto-hide)
  const toastTimerRef = React.useRef<number | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 1400);
  }

  // ✅ Pins: helpers

  // 🔁 Adapter: pin-path → tree-path candidates
  function toTreePath(p: string) {
    const np = normalizePath(p);

    // Intentamos distintas variantes porque el JsonDiffTree
    // puede vivir bajo diferentes roots lógicos
    const candidates = [np, `outputJson.${np}`, `payloadJson.${np}`];

    return candidates;
  }

  function isPinnedPath(path: string, tone: PinTone) {
    const rowId = makeRowId(normalizePath(path), tone as DiffTone);
    return pinned.isPinned(rowId);
  }

  function togglePinFor(path: string, tone: PinTone) {
    const np = normalizePath(path);
    const wasPinned = isPinnedPath(np, tone);

    pinned.togglePin({ path: np, tone: tone as DiffTone });

    // Si estaba pinned y ahora lo quitaste → unpin flash neutral
    setLastPinAction(wasPinned ? "unpin" : "pin");
  }

  function focusFromPinned(pin: ComparePin) {
    setActiveTab("side");

    const pointer = pin.pointer;
    if (!pointer) return;

    const candidates = toTreePath(pointer);

    // 1) intenta scroll index por cada candidato
    let found: string | null = null;

    for (const c of candidates) {
      const idx = diffList.findIndex((x) => x.path === c);
      if (idx >= 0) {
        focusToIndex(idx);
        found = c;
        break;
      }
    }

    // 2) si no encontró, usa el primero; si no hay candidatos, cae a "<root>"
    const target: string = found ?? candidates[0] ?? "<root>";

    // UX pulse + focus lógico
    focusAndPulse(target);

    // fuerza reacción del JsonDiffTree
    setFocusToken((t) => t + 1);
  }

  function revealAndFocusPinned(pin: ComparePin) {
    setSearch("");
    setOnlyChanged(false);
    setExpandOnlyChanged(false);

    // espera un tick para que se limpien filtros antes del focus
    window.setTimeout(() => {
      focusFromPinned(pin);
    }, 10);
  }

  function focusAndPulse(path: string) {
    const np = normalizePath(path);
    setFocusPath(np);
    bumpFocusPulseTick((t) => t + 1);
  }

  function revealAll() {
    setSearch("");
    setOnlyChanged(false);
    setExpandOnlyChanged(false);

    // también resetea pin filters si quieres “limpieza total”
    setPinFilter("all");
    setPinSearch("");
  }

  // Hotkeys: n (next), p (prev)
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const tag = (el?.tagName ?? "").toLowerCase();
      const isTyping =
        tag === "input" || tag === "textarea" || (el as any)?.isContentEditable;
      if (isTyping) return;

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        focusNext(1);
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        focusNext(-1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIndex, diffList.length]);

  const focused = diffList[focusIndex];
  const inspectorPath = normalizePath(focusPath ?? focused?.path ?? "");
  const inspectorTone: Tone = focused?.tone ?? "none";

  const inspectorA = inspectorPath
    ? getAtPath(aJsonBase, inspectorPath)
    : undefined;
  const inspectorB = inspectorPath
    ? getAtPath(bJsonBase, inspectorPath)
    : undefined;

  const semSummary =
    data?.semantic?.summary ??
    (mode === "payload"
      ? "Diff estructural de payload."
      : mode === "output"
        ? "Diff estructural de output."
        : "—");

  const inspectorToneAsDiffTone: DiffTone | null =
    inspectorTone === "changed" ||
    inspectorTone === "added" ||
    inspectorTone === "removed"
      ? (inspectorTone as DiffTone)
      : null;

  const inspectorPinnedOn =
    !!inspectorPath && !!inspectorToneAsDiffTone
      ? pinned.isPinned(makeRowId(inspectorPath, inspectorToneAsDiffTone))
      : false;

  // ✅ Pinned WOW: filter + search + grouping
  const [pinFilter, setPinFilter] = React.useState<"all" | PinTone>("all");
  const [pinSearch, setPinSearch] = React.useState("");

  const pinsSorted = React.useMemo(() => {
    // newest first
    return [...pinned.pins].sort(
      (x, y) => (y.updatedAtMs ?? 0) - (x.updatedAtMs ?? 0),
    );
  }, [pinned.pins]);

  const pinCounts = React.useMemo(() => {
    const c = { changed: 0, added: 0, removed: 0 };
    for (const p of pinned.pins) {
      if (p.tone === "changed") c.changed++;
      else if (p.tone === "added") c.added++;
      else if (p.tone === "removed") c.removed++;
    }
    return c;
  }, [pinned.pins]);

  const filteredPinnedItems = React.useMemo(() => {
    const q = pinSearch.trim().toLowerCase();
    return pinnedItems.filter((it) => {
      if (pinFilter !== "all" && it.tone !== pinFilter) return false;
      if (!q) return true;
      return it.path.toLowerCase().includes(q);
    });
  }, [pinnedItems, pinFilter, pinSearch]);

  const groupedPinned = React.useMemo(() => {
    const g: Record<PinTone, Array<{ path: string; tone: PinTone }>> = {
      changed: [],
      added: [],
      removed: [],
    };
    for (const it of filteredPinnedItems) g[it.tone].push(it);
    return g;
  }, [filteredPinnedItems]);

  const topChips = React.useMemo(() => {
    // Keep chips snappy (DOM friendly)
    const max = 90;
    return filteredPinnedItems.slice(0, max);
  }, [filteredPinnedItems]);

  const hasPins = pinnedCount > 0;

  // ✅ WOW #3: Suggested Pins (from engine)
  const suggestedPins = React.useMemo(() => {
    const rec = (data?.meta?.recommendedPins ?? []) as RecommendedPin[];

    return [...rec].sort((x, y) => (y.score ?? 0) - (x.score ?? 0));
  }, [data]);

  const suggestedPathsSet = React.useMemo(() => {
    return new Set((suggestedPins ?? []).map((r) => normalizePath(r.path)));
  }, [suggestedPins]);

  const presets = React.useMemo(() => {
    if (!data) return [];

    return deriveSmartPresets({
      suggestedPins: (suggestedPins ?? []).map((r) => ({
        path: r.path,
        // no asumimos why/confidence si tu tipo no los tiene
        kind: hotspotGroupForPath(r.path) === "CONTENT" ? "content" : "other",
      })),
    });
  }, [data, suggestedPins]);

  const suggestedActionable = React.useMemo(() => {
    // Count items that would actually create a new pin (not already pinned)
    let n = 0;
    for (const r of suggestedPins) {
      const tone = bestToneForPath(r.path);
      const rowId = makeRowId(normalizePath(r.path), tone as DiffTone);
      if (!pinned.isPinned(rowId)) n++;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedPins, pinned.pins, diffList]);

  function saveCurrentPinsAsPack() {
    const name = packName.trim() || `Pack ${new Date().toLocaleString()}`;

    const normalizeTone = (t: any): DiffTone =>
      t === "added" || t === "removed" || t === "changed" ? t : "changed";

    // 1) recolecta pins actuales
    const items = (pinned.pins ?? [])
      .map((p: any) => ({
        path: String(p.path ?? p.pointer ?? "").trim(),
        tone: normalizeTone(p.tone),
      }))
      .filter((x) => x.path);

    // 2) dedupe por (path + tone) para no guardar basura
    const seen = new Set<string>();
    const uniq: Array<{ path: string; tone: DiffTone }> = [];
    for (const it of items) {
      const np = normalizePath(it.path);
      if (!np) continue;
      const k = `${np}|${it.tone}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push({ path: np, tone: it.tone });
    }

    if (!uniq.length) {
      showToast("No pins to save");
      return;
    }

    const now = new Date().toISOString();

    const pack: PinPack = {
      id: uid(),
      name,
      createdAt: now,
      updatedAt: now,
      compareSessionKey,
      pins: uniq,
    };

    // ✅ solo estado: el auto-save useEffect se encarga del storage
    setPinPacks((prev) => [pack, ...(prev ?? [])]);
    setPackName("");
    showToast(`💾 Saved pack: ${pack.name}`);
  }

  function applyPack(pack: PinPack) {
    // Only apply packs for this session key
    if (pack.compareSessionKey !== compareSessionKey) {
      showToast("Pack belongs to a different compare session");
      return;
    }

    let added = 0;

    for (const it of pack.pins) {
      const np = normalizePath(it.path);
      if (!np) continue;

      const toneRaw = String(it.tone ?? "changed");
      const tone =
        toneRaw === "added" || toneRaw === "removed" || toneRaw === "changed"
          ? (toneRaw as "changed" | "added" | "removed")
          : "changed";

      const rowId = makeRowId(np, tone as DiffTone);
      if (pinned.isPinned(rowId)) continue;

      pinned.togglePin({ path: np, tone: tone as DiffTone });
      added++;
    }

    // 🕒 Update pack.updatedAt when applied (and rely on auto-save)
    const now = new Date().toISOString();
    setPinPacks((prev) =>
      (prev ?? []).map((p) =>
        p.id === pack.id ? { ...p, updatedAt: now } : p,
      ),
    );

    showToast(
      added > 0 ? `📦 Applied pack (+${added})` : "📦 Pack already applied",
    );
  }

  function deletePack(id: string) {
    setPinPacks((prev) => {
      const next = (prev ?? []).filter((p) => p.id !== id);
      return next;
    });
    showToast("🗑️ Pack deleted");
  }

  function applyPreset(
    preset: { id?: string; label?: string; pins: string[]; tourId?: string },
    opts: { startTour: boolean },
  ) {
    if (!preset.pins?.length) return;

    // Stop any previous tour (reuse the same tour control you already have)
    recTourRef.current.runId += 1;
    const myRun = recTourRef.current.runId;
    if (recTourRef.current.timer) window.clearTimeout(recTourRef.current.timer);

    // Reveal UI first (same behavior as pinRecommendedAll)
    revealAll();

    let pinnedNew = 0;
    const pinnedNow: string[] = [];

    for (const raw of preset.pins) {
      const np = normalizePath(raw);
      if (!np) continue;

      // Reuse your existing constraints (avoid ghost pins)
      const needsOutputSnap =
        np === "snapshots.aOutputJson" || np === "snapshots.bOutputJson";
      const needsPayloadSnap =
        np === "snapshots.aPayloadJson" || np === "snapshots.bPayloadJson";
      if (needsOutputSnap && !canViewOutput) continue;
      if (needsPayloadSnap && payloadSnapshotsMissing) continue;

      const tone = bestToneForPath(np);
      const did = ensurePinned(np, tone);
      if (did) pinnedNew++;

      pinnedNow.push(np);
    }

    // Toast
    showToast(
      pinnedNew > 0
        ? `🧠 Applied preset “${preset.label}” (+${pinnedNew})`
        : `🧠 Preset “${preset.label}” already applied`,
    );

    // Optional guided tour
    if (opts.startTour && pinnedNow.length) {
      // If top pin needs output, switch view for tour
      const top0 = pinnedNow[0]!;
      const topNeedsOutput =
        top0 === "snapshots.aOutputJson" || top0 === "snapshots.bOutputJson";
      if (topNeedsOutput && canViewOutput) setView("output");

      setActiveTab("side");

      // Tour: focus top 3 unique targets
      const tourTargets = Array.from(new Set(pinnedNow)).slice(0, 3);
      if (!tourTargets.length) return;

      const step = (idx: number) => {
        if (recTourRef.current.runId !== myRun) return;
        const p = tourTargets[idx];
        if (!p) return;

        focusFromChip(p);

        if (idx >= tourTargets.length - 1) return;
        recTourRef.current.timer = window.setTimeout(() => step(idx + 1), 950);
      };

      recTourRef.current.timer = window.setTimeout(() => step(0), 250);
    }
  }

  function pinRecommendedAll() {
    if (!suggestedPins.length) return;

    // Stop any previous tour
    recTourRef.current.runId += 1;
    const myRun = recTourRef.current.runId;
    if (recTourRef.current.timer) window.clearTimeout(recTourRef.current.timer);

    // Reveal UI first
    revealAll();

    let pinnedNew = 0;
    const pinnedNow: string[] = [];

    for (const r of suggestedPins) {
      const np = normalizePath(r.path);

      // Disable pins that require missing snapshots (avoid “ghost pins”)
      const needsOutputSnap =
        np === "snapshots.aOutputJson" || np === "snapshots.bOutputJson";
      const needsPayloadSnap =
        np === "snapshots.aPayloadJson" || np === "snapshots.bPayloadJson";
      if (needsOutputSnap && !canViewOutput) continue;
      if (needsPayloadSnap && payloadSnapshotsMissing) continue;

      const tone = bestToneForPath(np);
      const did = ensurePinned(np, tone);
      if (did) pinnedNew++;

      // Keep list for tour (even if already pinned, it’s still a good spotlight)
      pinnedNow.push(np);
    }

    // ✨ Micro-toast (auto clear)
    if (pinnedNew > 0) {
      showToast(`✨ Pinned ${pinnedNew} recommended`);
    } else {
      showToast("✨ No new recommended pins");
    }

    // ✅ WOW #6: Start guided tour from what we pinned/selected
    if (pinnedNow.length) {
      startTour(pinnedNow);
    }

    // 🎯 Auto-focus tour: enfoca el primer recomendado (si existe)
    if (pinnedNow.length) {
      const first = pinnedNow[0]!;
      // Focus + pulse
      window.setTimeout(() => focusFromChip(first), 50);
    }

    // Tour: focus top 3 unique actionable targets
    const tourTargets = Array.from(new Set(pinnedNow)).slice(0, 3);

    // If nothing, bail
    if (!tourTargets.length) return;

    // If top recommendation is output snapshot and we can view output, switch view to output for tour
    const top0 = suggestedPins[0]?.path
      ? normalizePath(suggestedPins[0].path)
      : "";
    const topNeedsOutput =
      top0 === "snapshots.aOutputJson" || top0 === "snapshots.bOutputJson";

    if (topNeedsOutput && canViewOutput) {
      setView("output");
    }

    // Make sure we’re in a view that can show focus nicely
    setActiveTab("side");

    const step = (idx: number) => {
      if (recTourRef.current.runId !== myRun) return;
      const p = tourTargets[idx];
      if (!p) return;

      // Prefer focusing the chip/path (this triggers scroll+ring via focusToken)
      focusFromChip(p);

      if (idx >= tourTargets.length - 1) return;

      recTourRef.current.timer = window.setTimeout(() => step(idx + 1), 950);
    };

    // Start after a small delay so state settles after pinning/reveal
    recTourRef.current.timer = window.setTimeout(() => step(0), 250);
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Compare Outputs</div>

          <div className="text-sm text-neutral-600">
            <div>
              A: <span className="font-mono">{a || "—"}</span>{" "}
              <span className="mx-2">|</span>
              B: <span className="font-mono">{b || "—"}</span>{" "}
              <span className="mx-2">|</span>
              Mode: <span className="font-mono">{mode}</span>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {(["payload", "output", "semantic"] as const).map((m) => (
                <button
                  key={m}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg border text-sm",
                    mode === m
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : "bg-white border-neutral-300 hover:bg-neutral-50",
                  )}
                  onClick={() => pushParams({ mode: m })}
                  title={`Switch compare mode to ${m}`}
                >
                  Mode: {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap justify-end">
          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
            onClick={() => router.back()}
          >
            Back
          </button>

          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
            onClick={() => {
              if (!a || !b) return;
              pushParams({ a: b, b: a });
            }}
            disabled={!a || !b}
            title="Swap A/B"
          >
            Swap
          </button>

          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
            onClick={async () => {
              if (!data) return;
              await copyText(JSON.stringify(data, null, 2));
            }}
            disabled={!data}
            title={!data ? "No data yet" : "Copy JSON"}
          >
            Copy JSON
          </button>

          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
            onClick={() => pinned.exportJson()}
            disabled={pinnedCount === 0}
            title={pinnedCount === 0 ? "No pins yet" : "Export pins JSON"}
          >
            Export Pins JSON
          </button>

          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
            onClick={() => pinned.exportCsv()}
            disabled={pinnedCount === 0}
            title={pinnedCount === 0 ? "No pins yet" : "Export pins CSV"}
          >
            Export Pins CSV
          </button>
        </div>
      </div>

      <div className="border border-neutral-200 rounded-xl p-4 bg-white space-y-3 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={clsx(
              "text-xs font-semibold px-2 py-1 rounded-full border",
              semBadge.className,
            )}
          >
            {semBadge.label}
          </span>

          {data?.shortCircuit?.reusedBecause ? (
            <span className="text-xs font-semibold px-2 py-1 rounded-full border bg-blue-50 text-blue-700 border-blue-200">
              REUSED: PAYLOAD_HASH_MATCH
            </span>
          ) : null}

          {data?.meta ? (
            <span className="text-xs text-neutral-500">
              engine {data.meta.engineVersion} •{" "}
              {new Date(data.meta.createdAt).toLocaleString()}
            </span>
          ) : null}

          <span className="ml-auto text-xs font-semibold px-2 py-1 rounded-full border bg-neutral-50 border-neutral-200 text-neutral-700">
            Pins: <span className="font-mono">{pinnedCount}</span>
          </span>
        </div>

        {loading ? (
          <div className="text-sm text-neutral-600">Comparing…</div>
        ) : err ? (
          <div className="text-sm text-red-600">{err}</div>
        ) : data ? (
          <div className="text-sm text-neutral-700">
            {semSummary}
            {data.semantic?.score != null ? (
              <span className="ml-2 text-neutral-500">
                (score: {Math.round(data.semantic.score * 1000) / 1000})
              </span>
            ) : null}
          </div>
        ) : (
          <div className="text-sm text-neutral-500">Listo para comparar.</div>
        )}
      </div>

      {isMissingSnapshots ? (
        <div className="text-sm text-amber-700 border border-amber-200 bg-amber-50 rounded-xl p-3">
          Este compare no devolvió <span className="font-mono">snapshots</span>{" "}
          (payload/output). Prueba cambiar el <b>Mode</b> o revisa que el
          endpoint incluya <span className="font-mono">snapshots</span>.
        </div>
      ) : null}

      {!isMissingSnapshots && noStructuralDiffs ? (
        <div className="text-sm text-neutral-600 border border-neutral-200 bg-neutral-50 rounded-xl p-3">
          No hay diffs estructurales. Por eso <b>Prev</b> / <b>Next</b> /{" "}
          <b>Pin</b> se deshabilitan.
        </div>
      ) : null}

      {noStructuralDiffs ? (
        <div className="text-sm text-neutral-600 border border-neutral-200 bg-neutral-50 rounded-xl p-3">
          No hay diffs estructurales (Changed / Added / Removed = 0). Por eso{" "}
          <b>Prev</b>, <b>Next</b> y <b>Pin</b> están deshabilitados.
        </div>
      ) : null}

      {data?.headers ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <HeaderCard title="Output A" h={data.headers.a} linkHref={aLink} />
          <HeaderCard title="Output B" h={data.headers.b} linkHref={bLink} />
        </div>
      ) : null}

      <div className="flex gap-2 flex-wrap items-center">
        <button
          className={clsx(
            "px-3 py-1.5 rounded-lg border text-sm",
            activeTab === "semantic"
              ? "bg-neutral-900 text-white border-neutral-900"
              : "bg-white border-neutral-300 hover:bg-neutral-50",
          )}
          onClick={() => setActiveTab("semantic")}
          disabled={mode !== "semantic"}
          title={
            mode !== "semantic"
              ? "Semantic tab solo disponible en mode=semantic"
              : "Semantic"
          }
        >
          Semantic
        </button>

        <button
          className={clsx(
            "px-3 py-1.5 rounded-lg border text-sm",
            activeTab === "side"
              ? "bg-neutral-900 text-white border-neutral-900"
              : "bg-white border-neutral-300 hover:bg-neutral-50",
          )}
          onClick={() => setActiveTab("side")}
        >
          Side-by-side
        </button>

        <button
          className={clsx(
            "px-3 py-1.5 rounded-lg border text-sm",
            activeTab === "raw"
              ? "bg-neutral-900 text-white border-neutral-900"
              : "bg-white border-neutral-300 hover:bg-neutral-50",
          )}
          onClick={() => setActiveTab("raw")}
        >
          Raw
        </button>

        <div className="ml-auto flex gap-2 flex-wrap items-center">
          <div className="text-xs text-neutral-600">
            Changes: <span className="font-mono">{diffList.length}</span>
            {diffList.length ? (
              <span className="ml-2">
                • <span className="font-mono">{focusIndex + 1}</span>/
                <span className="font-mono">{diffList.length}</span>
              </span>
            ) : null}
          </div>

          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
            onClick={() => focusNext(-1)}
            disabled={navDisabled || diffList.length === 0}
            title="Prev change (hotkey: P)"
          >
            Prev
          </button>
          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
            onClick={() => focusNext(1)}
            disabled={navDisabled || diffList.length === 0}
            title="Next change (hotkey: N)"
          >
            Next
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className={clsx(
            "px-3 py-1.5 rounded-lg border text-sm",
            inspectorPinnedOn
              ? "bg-neutral-900 text-white border-neutral-900"
              : "bg-white border-neutral-300 hover:bg-neutral-50",
          )}
          onClick={() => {
            if (!inspectorPath) return;
            if (!inspectorToneAsDiffTone) return;
            pinned.togglePin({
              path: inspectorPath,
              tone: inspectorToneAsDiffTone,
            });
          }}
          disabled={navDisabled || !inspectorPath || !inspectorToneAsDiffTone}
          title={
            !inspectorPath
              ? "No focused path"
              : !inspectorToneAsDiffTone
                ? "No tone for this path"
                : inspectorPinnedOn
                  ? "Unpin"
                  : "Pin"
          }
        >
          {inspectorPinnedOn ? "Pinned" : "Pin"}
        </button>

        <div className="text-xs text-neutral-500">
          (pins are stored as <span className="font-mono">path + tone</span>)
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="flex items-center gap-2">
          <input
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm w-[300px] bg-white"
            placeholder="Search key / path / value…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
            onClick={() => setSearch("")}
            disabled={!search}
          >
            Clear
          </button>
        </div>

        <div className="ml-auto flex gap-2 flex-wrap items-center">
          <div className="flex gap-2">
            <button
              className={clsx(
                "px-3 py-1.5 rounded-lg border text-sm",
                view === "payload"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white border-neutral-300 hover:bg-neutral-50",
              )}
              onClick={() => setView("payload")}
            >
              Payload
            </button>

            <button
              className={clsx(
                "px-3 py-1.5 rounded-lg border text-sm",
                view === "output"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white border-neutral-300 hover:bg-neutral-50",
                !canViewOutput &&
                  "opacity-40 cursor-not-allowed hover:bg-white",
              )}
              onClick={() => {
                if (!canViewOutput) return;
                setView("output");
              }}
              disabled={!canViewOutput}
              title={
                !canViewOutput
                  ? "Este compare no incluye snapshots de outputJson. Cambia Mode o revisa el endpoint."
                  : "Ver outputJson"
              }
            >
              Output
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-700 select-none">
            <input
              type="checkbox"
              className="accent-neutral-900"
              checked={onlyChanged}
              onChange={(e) => setOnlyChanged(e.target.checked)}
              disabled={!data || Boolean(search.trim())}
              title={search.trim() ? "Disable search to use only-changed" : ""}
            />
            Only changed
          </label>

          <label className="flex items-center gap-2 text-sm text-neutral-700 select-none">
            <input
              type="checkbox"
              className="accent-neutral-900"
              checked={expandOnlyChanged}
              onChange={(e) => setExpandOnlyChanged(e.target.checked)}
              disabled={!data || Boolean(search.trim())}
              title={search.trim() ? "Search already auto-expands matches" : ""}
            />
            Expand only changed
          </label>

          <button
            className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
            onClick={() => {
              setImportInfo(null);
              setImportText("");
              setShowImportPins(true);
            }}
            title="Import pins JSON"
          >
            Import
          </button>

          {pinnedCount ? (
            <button
              className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
              onClick={() => pinned.clearAll()}
              title="Clear all pins"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {/* 🚀 WOW #4: Change Zones + Presets */}
      {data?.meta?.zones?.length ? (
        <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm space-y-3">
          {(() => {
            const top = data?.meta?.zones?.[0];
            if (!top) return null;

            const rec =
              top.zone === "MODEL"
                ? {
                    label: "⚙️ Pin Settings",
                    hint: "Recommended: generation settings changed.",
                    action: "settings" as const,
                  }
                : top.zone === "METADATA"
                  ? {
                      label: "🧾 Pin Metadata",
                      hint: "Recommended: headers/metadata changed.",
                      action: "metadata" as const,
                    }
                  : {
                      label: "🔥 Pin Hotspots (3)",
                      hint: "Recommended: content/structure changed; review hotspots.",
                      action: "hotspots" as const,
                    };

            return (
              <div className="border border-neutral-200 rounded-lg p-3 bg-neutral-50 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs font-semibold">
                    ✨ Recommended preset
                  </div>
                  <div className="text-xs text-neutral-600">{rec.hint}</div>
                </div>

                <button
                  className="text-sm px-3 py-1.5 rounded-lg border border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
                  onClick={() => {
                    if (rec.action === "settings") {
                      const paths = [
                        "headers.a.model",
                        "headers.b.model",
                        "headers.a.provider",
                        "headers.b.provider",
                        "headers.a.version",
                        "headers.b.version",
                      ];
                      let n = 0;
                      for (const p of paths) {
                        const np = normalizePath(p);
                        const tone = bestToneForPath(np);
                        const rowId = makeRowId(np, tone as any);
                        if (!pinned.isPinned(rowId)) {
                          ensurePinned(np, tone);
                          n++;
                        }
                      }
                      showToast(
                        n
                          ? `✨ Pinned settings (${n})`
                          : "No new settings pins",
                      );
                      focusFromChip(normalizePath(paths[0]!));
                      return;
                    }

                    if (rec.action === "metadata") {
                      const np = "headers";
                      const tone = bestToneForPath(np);
                      const rowId = makeRowId(np, tone as any);
                      if (!pinned.isPinned(rowId)) ensurePinned(np, tone);
                      showToast("✨ Pinned metadata");
                      focusFromChip(np);
                      return;
                    }

                    const paths =
                      data?.structural?.json?.changedPaths?.slice(0, 3) ??
                      data?.structural?.changed?.slice(0, 3) ??
                      [];
                    let n = 0;
                    for (const p of paths) {
                      const np = normalizePath(p);
                      const tone = bestToneForPath(np);
                      const rowId = makeRowId(np, tone as any);
                      if (!pinned.isPinned(rowId)) {
                        ensurePinned(np, tone);
                        n++;
                      }
                    }
                    showToast(
                      n ? `✨ Pinned hotspots (${n})` : "No new hotspot pins",
                    );
                    if (paths[0]) focusFromChip(normalizePath(paths[0]));
                  }}
                  title="Apply recommended preset"
                >
                  {rec.label}
                </button>
              </div>
            );
          })()}

          {/* ✅ WOW #5: Why + Confidence */}
          {data?.meta ? (
            <div className="border border-neutral-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs font-semibold">
                  🧠 Why these suggestions
                </div>

                {(() => {
                  const c =
                    typeof data.meta.confidence === "number"
                      ? data.meta.confidence
                      : null;

                  const tone =
                    c == null
                      ? "neutral"
                      : c >= 80
                        ? "good"
                        : c >= 55
                          ? "mid"
                          : "low";

                  const cls =
                    tone === "good"
                      ? "bg-green-50 border-green-200 text-green-900"
                      : tone === "mid"
                        ? "bg-yellow-50 border-yellow-200 text-yellow-900"
                        : tone === "low"
                          ? "bg-red-50 border-red-200 text-red-900"
                          : "bg-white border-neutral-300 text-neutral-700";

                  const label =
                    c == null
                      ? "—"
                      : c >= 80
                        ? "HIGH"
                        : c >= 55
                          ? "MED"
                          : "LOW";

                  return (
                    <span
                      className={clsx(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                        cls,
                      )}
                      title="Deterministic confidence score (0–100)"
                    >
                      confidence: <span className="font-mono">{c ?? "—"}</span>{" "}
                      <span className="ml-1">{label}</span>
                    </span>
                  );
                })()}
              </div>

              {Array.isArray(data.meta.why) && data.meta.why.length ? (
                <ul className="mt-2 space-y-1 text-xs text-neutral-700 list-disc pl-5">
                  {data.meta.why.slice(0, 4).map((w, i) => (
                    <li key={i} className="break-words">
                      {w}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-xs text-neutral-500">
                  No explanation available.
                </div>
              )}
            </div>
          ) : null}

          {/* 🧭 Zones list */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-semibold">🧭 Change Zones</div>
              <div className="text-xs text-neutral-500">
                Diagnóstico determinístico: dónde se concentraron los cambios.
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="text-xs px-2 py-1 rounded-lg border border-neutral-900 bg-white hover:bg-neutral-50"
                onClick={() => {
                  const paths = [
                    "headers.a.model",
                    "headers.b.model",
                    "headers.a.provider",
                    "headers.b.provider",
                    "headers.a.version",
                    "headers.b.version",
                  ];
                  let n = 0;
                  for (const p of paths) {
                    const np = normalizePath(p);
                    const tone = bestToneForPath(np);
                    const rowId = makeRowId(np, tone as any);
                    if (!pinned.isPinned(rowId)) {
                      ensurePinned(np, tone);
                      n++;
                    }
                  }
                  showToast(
                    n ? `✨ Pinned settings (${n})` : "No new settings pins",
                  );
                  if (paths.length) focusFromChip(normalizePath(paths[0]!));
                }}
                title="Pin generation settings (model/provider/version)"
              >
                ⚙️ Pin Settings
              </button>

              <button
                className="text-xs px-2 py-1 rounded-lg border border-neutral-900 bg-white hover:bg-neutral-50"
                onClick={() => {
                  const np = "headers";
                  const tone = bestToneForPath(np);
                  const rowId = makeRowId(np, tone as any);
                  if (!pinned.isPinned(rowId)) ensurePinned(np, tone);
                  showToast("✨ Pinned metadata");
                  focusFromChip(np);
                }}
                title="Pin headers/metadata"
              >
                🧾 Pin Metadata
              </button>

              <button
                className="text-xs px-2 py-1 rounded-lg border border-neutral-900 bg-white hover:bg-neutral-50"
                onClick={() => {
                  const paths =
                    data?.structural?.json?.changedPaths?.slice(0, 3) ??
                    data?.structural?.changed?.slice(0, 3) ??
                    [];
                  let n = 0;
                  for (const p of paths) {
                    const np = normalizePath(p);
                    const tone = bestToneForPath(np);
                    const rowId = makeRowId(np, tone as any);
                    if (!pinned.isPinned(rowId)) {
                      ensurePinned(np, tone);
                      n++;
                    }
                  }
                  showToast(
                    n ? `✨ Pinned hotspots (${n})` : "No new hotspot pins",
                  );
                  if (paths[0]) focusFromChip(normalizePath(paths[0]));
                }}
                title="Pin top 3 hotspot paths (from changedPaths)"
              >
                🔥 Pin Hotspots (3)
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {data.meta.zones.slice(0, 4).map((z) => (
              <button
                key={z.zone}
                className="text-xs px-2 py-1 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
                onClick={() => {
                  const ex = z.examples?.[0];
                  if (ex) focusFromChip(normalizePath(ex));
                  showToast(`🧭 ${z.zone}: ${z.reason}`);
                }}
                title={z.reason}
              >
                <span className="font-semibold">{z.zone}</span>{" "}
                <span className="font-mono text-[10px] text-neutral-500">
                  ({z.score})
                </span>
              </button>
            ))}
          </div>

          <div className="text-xs text-neutral-700">
            <span className="font-semibold">Top:</span>{" "}
            {data.meta.zones[0]?.reason}
          </div>

          {data.meta.zones[0]?.examples?.length ? (
            <div className="text-xs text-neutral-500">
              examples:{" "}
              <span className="font-mono">
                {data.meta.zones[0].examples!.slice(0, 3).join(" · ")}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ✅ WOW #8 + WOW #3 wrapper */}
      <div className="space-y-3">
        {data && presets.length ? (
          <SmartPresetsPanel presets={presets} onApplyPreset={applyPreset} />
        ) : null}
        {/* ✅ WOW #14: Unified Recommendation Engine */}
        {data ? (
          <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-semibold">✨ Suggested Pins</div>

                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-700">
                    Signals: {unifiedRecs?.items?.length ?? 0}
                  </span>

                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-700">
                    Zones:{" "}
                    {
                      new Set(
                        (unifiedRecs?.items ?? []).map(
                          (it) => it.zone ?? "other",
                        ),
                      ).size
                    }
                  </span>
                </div>

                <div className="text-xs text-neutral-500">
                  Recomendaciones unificadas (heuristics + hotspots),
                  explicables, no-ML.
                </div>
              </div>

              {(unifiedRecs?.items?.length ?? 0) > 0 ? (
                <button
                  className={clsx(
                    "px-3 py-1.5 rounded-lg border text-sm flex items-center gap-2",
                    recommendedNNew > 0
                      ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
                      : "border-neutral-300 bg-white text-neutral-500",
                  )}
                  onClick={applyRecommendedPins}
                  disabled={recommendedNNew === 0}
                  title={
                    recommendedNNew === 0
                      ? "No new recommended pins (try unpinning something recommended)"
                      : (recommendedReason ?? "Pin all recommended")
                  }
                >
                  <span>✨ Pin Recommended ({recommendedNTotalUnified})</span>
                  <span className="text-[11px] opacity-80">
                    (new {recommendedNNew})
                  </span>
                </button>
              ) : (
                <button
                  className="px-3 py-1.5 rounded-lg border text-sm flex items-center gap-2 border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed"
                  disabled
                  title="No unified suggestions in this compare yet."
                >
                  <span>✨ Pin Recommended (0)</span>
                  <span className="text-[11px] opacity-80">(new 0)</span>
                </button>
              )}
            </div>

            {(unifiedRecs?.items?.length ?? 0) > 0 ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-xs text-neutral-500">
                  Zone density:
                  <span className="ml-2 font-mono">
                    {
                      Object.values(collapsedUnifiedZones).filter(Boolean)
                        .length
                    }{" "}
                    collapsed
                  </span>
                </div>

                {(() => {
                  const items = unifiedRecs?.items ?? [];
                  const zones = Array.from(
                    new Set(items.map((it) => String(it.zone ?? "other"))),
                  );
                  const collapsedCount = zones.filter((z) =>
                    isZoneCollapsed(z),
                  ).length;
                  const allCollapsed =
                    zones.length > 0 && collapsedCount === zones.length;

                  return (
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded-md border border-neutral-200 hover:bg-neutral-50"
                      onClick={() => {
                        if (allCollapsed) expandAllUnifiedZones(zones);
                        else collapseAllUnifiedZones(zones);
                      }}
                      title={
                        allCollapsed ? "Expand all zones" : "Collapse all zones"
                      }
                    >
                      {allCollapsed ? "Expand all" : "Collapse all"}
                    </button>
                  );
                })()}
              </div>
            ) : null}

            {(unifiedRecs?.items?.length ?? 0) > 0 ? (
              (() => {
                const items = unifiedRecs.items as RecommendationItem[];
                const byZone = groupByZone(items);

                const zoneOrder: RecommendationItem["zone"][] = [
                  "content",
                  "output",
                  "input",
                  "model",
                  "metadata",
                  "other",
                ];

                const isUnderPrefix = (prefix: string, path: string) => {
                  if (!prefix) return false;
                  if (path === prefix) return true;
                  return (
                    path.startsWith(prefix + ".") ||
                    path.startsWith(prefix + "[")
                  );
                };

                const smartPrefixForPin = (path: string) => {
                  const lastDot = path.lastIndexOf(".");
                  if (lastDot > 0) return path.slice(0, lastDot);
                  const lastBracket = path.lastIndexOf("]");
                  if (lastBracket > 0) return path.slice(0, lastBracket + 1);
                  return null;
                };

                const renderRecItem = (it: RecommendationItem) => {
                  const p = normalizePath(it.pinPath);
                  if (!p) return null;

                  const tone = bestToneForPath(p);
                  const pinnedNow = isPinnedPath(p, tone);

                  const depth = (p.match(/[.[\]]/g) ?? []).length;
                  const smartPrefix = smartPrefixForPin(p);
                  const willSmartPinPrefix = !!smartPrefix && depth >= 2;

                  const prefixPinned =
                    !!smartPrefix &&
                    (pinned?.pins ?? []).some((pp: any) => {
                      const rawPath = String(
                        pp?.path ?? pp?.pinPath ?? pp?.p ?? "",
                      );
                      const ppPath = normalizePath(rawPath);
                      if (!ppPath) return false;
                      return isUnderPrefix(smartPrefix, ppPath);
                    });

                  const tooltip = [
                    it.why?.title ?? "",
                    ...(it.why?.details ?? []),
                    `Tone: ${tone}${pinnedNow ? " • PINNED" : ""}${prefixPinned ? " • PREFIX PINNED" : ""}`,
                    willSmartPinPrefix
                      ? `Shift+Click: pin prefix → ${smartPrefix}`
                      : "Shift+Click: toggle pin",
                    "Click: focus • Alt+Click: copy",
                  ]
                    .filter(Boolean)
                    .slice(0, 5)
                    .join("\n");

                  const doCopy = async () => {
                    try {
                      await navigator.clipboard.writeText(p);
                      showToast?.(`Copied: ${p}`);
                    } catch {}
                  };

                  return (
                    <button
                      key={it.id}
                      type="button"
                      className={clsx(
                        "px-2.5 py-1.5 rounded-lg border text-xs bg-white flex items-center gap-2",
                        "hover:bg-neutral-50 active:scale-[0.99] transition",
                        pinnedNow
                          ? "border-neutral-900 shadow-sm"
                          : prefixPinned
                            ? "border-neutral-500"
                            : "border-neutral-200",
                      )}
                      title={tooltip}
                      onClick={(e) => {
                        if (e.altKey) {
                          void doCopy();
                          return;
                        }

                        setFocusPath(p);

                        if (e.shiftKey) {
                          if (willSmartPinPrefix && smartPrefix) {
                            setFocusPath(smartPrefix);
                            pinPrefix(
                              smartPrefix.endsWith(".")
                                ? smartPrefix
                                : smartPrefix + ".",
                            );
                          } else {
                            togglePinFor(p, tone);
                          }
                        }
                      }}
                      onDoubleClick={() => void doCopy()}
                    >
                      <span className="font-mono">{p}</span>

                      <span
                        className={clsx(
                          "text-[10px] px-1.5 py-0.5 rounded border",
                          it.kind === "engine"
                            ? "border-neutral-900 text-neutral-900"
                            : it.kind === "heuristic"
                              ? "border-blue-400 text-blue-700"
                              : "border-amber-400 text-amber-700",
                        )}
                      >
                        {it.kind}
                      </span>

                      {willSmartPinPrefix ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-300 text-neutral-700">
                          prefix
                        </span>
                      ) : null}

                      {pinnedNow ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-900 text-neutral-900">
                          pinned
                        </span>
                      ) : null}

                      {!pinnedNow && prefixPinned ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-500 text-neutral-700">
                          pinned+
                        </span>
                      ) : null}
                    </button>
                  );
                };

                return (
                  <div className="space-y-3">
                    {zoneOrder.map((z) => {
                      const zoneItems = byZone.get(z) ?? [];
                      if (!zoneItems.length) return null;

                      if (zoneItems.length === 1) {
                        return (
                          <div key={z} className="flex flex-wrap gap-2">
                            {renderRecItem(zoneItems[0]!)}
                          </div>
                        );
                      }

                      const collapsed = !!collapsedUnifiedZones[String(z)];

                      return (
                        <section
                          key={z}
                          className="rounded-xl border p-3 bg-neutral-50/40"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="text-[11px] font-semibold uppercase tracking-wide opacity-70 hover:opacity-100"
                              onClick={() => toggleUnifiedZone(String(z))}
                              title={
                                collapsed ? "Expand zone" : "Collapse zone"
                              }
                            >
                              {z}
                            </button>

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-700">
                                {zoneItems.length}
                              </span>

                              <button
                                type="button"
                                className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-700 hover:bg-white"
                                onClick={() => toggleUnifiedZone(String(z))}
                              >
                                {collapsed ? "Expand" : "Collapse"}
                              </button>
                            </div>
                          </div>

                          {!collapsed ? (
                            <div className="flex flex-wrap gap-2">
                              {zoneItems.map((it) => renderRecItem(it))}
                            </div>
                          ) : (
                            <div className="text-xs text-neutral-500">
                              Hidden ({zoneItems.length}) — click zone name to
                              expand.
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                );
              })()
            ) : (
              <div className="text-xs text-neutral-600">
                <div className="font-medium">
                  No unified suggestions for this compare.
                </div>
                <div className="text-neutral-500">
                  Tip: prueba cambiar el Mode (payload/output) o usa un par A/B
                  con cambios reales para ver chips accionables.
                </div>
              </div>
            )}
          </div>
        ) : null}
        {/* ✅ WOW #14: Hotspots (premium, single source UI) */}
        {(unifiedRecs?.items?.length ?? 0) > 0 ? null : zones.length ===
          0 ? null : (
          <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-semibold">✨ Suggested Pins</div>

                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-700">
                    Signals: {unifiedRecs?.items?.length ?? 0}
                  </span>

                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-700">
                    Zones:{" "}
                    {
                      new Set(
                        (unifiedRecs?.items ?? []).map(
                          (it) => it.zone ?? "other",
                        ),
                      ).size
                    }
                  </span>
                </div>

                <div className="text-xs text-neutral-500">
                  Recomendaciones unificadas (heuristics + hotspots),
                  explicables, no-ML.
                </div>
              </div>

              {(unifiedRecs?.items?.length ?? 0) > 0 ? (
                <button
                  className={clsx(
                    "px-3 py-1.5 rounded-lg border text-sm flex items-center gap-2",
                    recommendedNNew > 0
                      ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
                      : "border-neutral-300 bg-white text-neutral-500",
                  )}
                  onClick={applyRecommendedPins}
                  disabled={recommendedNNew === 0}
                  title={
                    recommendedNNew === 0
                      ? "No new recommended pins (try unpinning something recommended)"
                      : (recommendedReason ?? "Pin all recommended")
                  }
                >
                  <span>✨ Pin Recommended ({recommendedNTotalUnified})</span>
                  <span className="text-[11px] opacity-80">
                    (new {recommendedNNew})
                  </span>
                </button>
              ) : (
                <button
                  className="px-3 py-1.5 rounded-lg border text-sm flex items-center gap-2 border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed"
                  disabled
                  title="No unified suggestions in this compare yet."
                >
                  <span>✨ Pin Recommended (0)</span>
                  <span className="text-[11px] opacity-80">(new 0)</span>
                </button>
              )}
            </div>

            {/* Zone chips */}
            <div className="flex flex-wrap gap-2">
              {zones.map((z) => {
                const prefix = defaultPrefixForZone(z.zone);
                const canAct = !!prefix;
                return (
                  <div key={z.zone} className="flex items-center gap-2">
                    <button
                      type="button"
                      className={clsx(
                        "px-3 py-1.5 rounded-full border text-xs",
                        canAct
                          ? "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50"
                          : "border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed",
                      )}
                      onClick={() => canAct && setFocusPath(prefix)}
                      disabled={!canAct}
                      title={canAct ? `Focus: ${prefix}` : "No default prefix"}
                    >
                      {z.zone} · {z.count}
                    </button>

                    <button
                      type="button"
                      className={clsx(
                        "px-3 py-1.5 rounded-full border text-xs",
                        canAct
                          ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
                          : "border-neutral-200 bg-neutral-50 text-neutral-400 cursor-not-allowed",
                      )}
                      onClick={() => canAct && pinPrefix(prefix)}
                      disabled={!canAct}
                      title={canAct ? `Pin: ${prefix}` : "No default prefix"}
                    >
                      Pin
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Top hotspots */}
            <div className="flex flex-wrap gap-2 pt-2">
              {hotspots.slice(0, 10).map((h) => (
                <div
                  key={`${h.zone}::${h.pathPrefix}`}
                  className="flex items-center gap-2"
                >
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-full border border-neutral-300 bg-white text-xs hover:bg-neutral-50"
                    onClick={() => setFocusPath(h.pathPrefix)}
                    title={`Focus: ${h.pathPrefix}`}
                  >
                    {h.pathPrefix} · {h.count}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-full border border-neutral-900 bg-neutral-900 text-white text-xs hover:bg-neutral-800"
                    onClick={() => pinPrefix(h.pathPrefix)}
                    title={`Pin: ${h.pathPrefix}`}
                  >
                    Pin
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {tourOpen && tourPaths.length ? (
          <div className="border border-neutral-200 rounded-lg p-3 bg-neutral-50 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-xs font-semibold">🧭 Guided Tour</div>
              <div className="text-xs text-neutral-600">
                item <span className="font-mono">{tourIndex + 1}</span> /{" "}
                <span className="font-mono">{tourPaths.length}</span> —{" "}
                <span className="font-mono break-words">
                  {tourPaths[tourIndex]}
                </span>
              </div>
              <div className="text-[10px] text-neutral-500 mt-1">
                Hotkeys: <span className="font-mono">N</span>/
                <span className="font-mono">P</span> ·{" "}
                <span className="font-mono">Esc</span> to stop
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
                onClick={prevTour}
                disabled={tourIndex === 0}
                title="Prev (P)"
              >
                Prev
              </button>
              <button
                className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
                onClick={nextTour}
                disabled={tourIndex >= tourPaths.length - 1}
                title="Next (N)"
              >
                Next
              </button>
              <button
                className="text-xs px-2 py-1 rounded-lg border border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
                onClick={stopTour}
                title="Stop (Esc)"
              >
                Stop
              </button>
            </div>
          </div>
        ) : null}
        {/* ✅ ÚNICO grid correcto (sin duplicados / sin bloque corrupto) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {suggestedPins.slice(0, 10).map((r) => {
            const np = normalizePath(r.path);
            const tone = bestToneForPath(np);

            const rowId = makeRowId(np, tone as DiffTone);
            const already = pinned.isPinned(rowId);

            const needsOutputSnap =
              np === "snapshots.aOutputJson" || np === "snapshots.bOutputJson";
            const needsPayloadSnap =
              np === "snapshots.aPayloadJson" ||
              np === "snapshots.bPayloadJson";

            const disabled =
              (needsOutputSnap && !canViewOutput) ||
              (needsPayloadSnap && payloadSnapshotsMissing);

            return (
              <div
                key={np}
                data-path={np}
                className="border border-neutral-200 rounded-lg p-3 bg-neutral-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-neutral-900 break-words">
                      {np}
                    </div>
                    <div className="mt-1 text-xs text-neutral-700">
                      {r.reason}
                    </div>

                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-white border-neutral-300 text-neutral-700">
                        score: <span className="font-mono">{r.score}</span>
                      </span>

                      <span
                        className={clsx(
                          "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                          tone === "changed"
                            ? "bg-yellow-50 border-yellow-200 text-yellow-900"
                            : tone === "added"
                              ? "bg-green-50 border-green-200 text-green-900"
                              : "bg-red-50 border-red-200 text-red-900",
                        )}
                        title="Tone chosen for pin"
                      >
                        tone: {tone.toUpperCase()}
                      </span>

                      {already ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-neutral-900 text-white border-neutral-900">
                          ALREADY PINNED
                        </span>
                      ) : null}

                      {disabled ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-200">
                          SNAPSHOT MISSING
                        </span>
                      ) : null}

                      {Array.isArray(r.tags) && r.tags.length ? (
                        <span className="text-[10px] text-neutral-500">
                          tags:{" "}
                          <span className="font-mono">{r.tags.join(", ")}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex gap-2 shrink-0">
                    <button
                      className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
                      onClick={() => focusFromChip(np)}
                      title="Focus"
                    >
                      Focus
                    </button>

                    <button
                      className={clsx(
                        "text-xs px-2 py-1 rounded-lg border",
                        already
                          ? "border-neutral-300 bg-white text-neutral-400 cursor-not-allowed"
                          : "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800",
                      )}
                      onClick={() => {
                        if (disabled) return;
                        if (already) return;
                        ensurePinned(np, tone);
                        showToast(`📌 Pinned: ${np}`);
                      }}
                      disabled={already || disabled}
                      title={
                        already
                          ? "Already pinned"
                          : disabled
                            ? "Missing snapshots for this recommendation"
                            : "Pin"
                      }
                    >
                      📌 Pin
                    </button>

                    <button
                      className={clsx(
                        "text-xs px-2 py-1 rounded-lg border",
                        disabled || already
                          ? "border-neutral-300 bg-white text-neutral-400 cursor-not-allowed"
                          : "border-neutral-900 bg-white text-neutral-900 hover:bg-neutral-50",
                      )}
                      onClick={() => {
                        if (disabled) return;
                        if (already) {
                          focusFromChip(np);
                          return;
                        }
                        ensurePinned(np, tone);
                        focusFromChip(np);
                      }}
                      disabled={disabled}
                      title={
                        disabled
                          ? "Missing snapshots for this recommendation"
                          : already
                            ? "Already pinned • Focus"
                            : "Pin and focus"
                      }
                    >
                      📌 Pin + Focus
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {suggestedPins.length > 10 ? (
          <div className="text-xs text-neutral-500">
            Showing 10 /{" "}
            <span className="font-mono">{suggestedPins.length}</span>
          </div>
        ) : null}
        /* ✅ END: Suggested Pins wrapper (space-y-3) */
      </div>

      {/* ✅ Micro-toast (WOW polish) */}
      {toast ? (
        <div className="fixed bottom-4 right-4 z-50">
          <div className="px-3 py-2 rounded-xl border border-neutral-200 bg-white shadow-lg text-sm text-neutral-900">
            {toast}
          </div>
        </div>
      ) : null}

      {/* ✅ Pinned Panel (WOW) */}
      <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="font-semibold">
            Pinned ({pinnedCount})
            <span className="ml-2 text-xs text-neutral-500 font-normal">
              scoped to this compare session
            </span>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
              onClick={() => pinned.exportJson()}
              disabled={pinnedCount === 0}
            >
              Export JSON
            </button>
            <button
              className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
              onClick={() => pinned.exportCsv()}
              disabled={pinnedCount === 0}
            >
              Export CSV
            </button>
            <button
              className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
              onClick={() => setPacksOpen((v) => !v)}
              title="Pin packs"
            >
              📦 Packs
            </button>

            <button
              className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
              onClick={() => {
                if (pinnedCount === 0) return;
                if (confirm("Clear all pins for this compare session?"))
                  pinned.clearAll();
              }}
              disabled={pinnedCount === 0}
              title="Clear all pins"
            >
              Clear
            </button>
          </div>
        </div>

        {packsOpen ? (
          <div className="border border-neutral-200 rounded-xl p-3 bg-white shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold">📦 Pin Packs</div>
                <div className="text-xs text-neutral-500">
                  Saved presets scoped to this compare session.
                </div>
              </div>

              <button
                className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
                onClick={() => setPacksOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <input
                className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white w-64"
                placeholder="Pack name (optional)"
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
              />
              <button
                className="text-xs px-2 py-1 rounded-lg border border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
                onClick={saveCurrentPinsAsPack}
                disabled={pinnedCount === 0}
                title={
                  pinnedCount === 0
                    ? "No pins to save"
                    : "Save current pins as pack"
                }
              >
                💾 Save current pins
              </button>
            </div>

            <div className="space-y-2">
              {(() => {
                const list = pinPacks
                  .filter((p) => p.compareSessionKey === compareSessionKey)
                  .sort((a, b) =>
                    (b.updatedAt || b.createdAt).localeCompare(
                      a.updatedAt || a.createdAt,
                    ),
                  )
                  .slice(0, 12);

                if (!list.length) {
                  return (
                    <div className="text-xs text-neutral-500">
                      No packs saved for this session yet.
                    </div>
                  );
                }

                return (
                  <>
                    {list.map((p) => (
                      <div
                        key={p.id}
                        className="border border-neutral-200 rounded-lg p-2 bg-neutral-50 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">
                            {p.name}
                          </div>
                          <div className="text-[10px] text-neutral-500">
                            pins:{" "}
                            <span className="font-mono">{p.pins.length}</span>
                          </div>
                        </div>

                        <div className="flex gap-2 shrink-0">
                          <button
                            className="text-xs px-2 py-1 rounded-lg border border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800"
                            onClick={() => applyPack(p)}
                            title="Apply pack"
                          >
                            Apply
                          </button>

                          <button
                            className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
                            onClick={() => deletePack(p.id)}
                            title="Delete pack"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}

        {/* WOW controls */}
        <div className="flex flex-wrap items-center gap-2 border border-neutral-200 rounded-xl p-3 bg-neutral-50">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-neutral-600">Filter:</span>

            <button
              className={clsx(
                "text-xs px-2 py-1 rounded-full border",
                pinFilter === "all"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white border-neutral-300 hover:bg-neutral-50",
              )}
              onClick={() => setPinFilter("all")}
            >
              All <span className="font-mono ml-1">{pinnedCount}</span>
            </button>

            <button
              className={clsx(
                "text-xs px-2 py-1 rounded-full border",
                pinFilter === "changed"
                  ? "bg-yellow-100 border-yellow-300 text-yellow-900"
                  : "bg-white border-neutral-300 hover:bg-neutral-50",
              )}
              onClick={() => setPinFilter("changed")}
              disabled={!hasPins}
              title="Show only CHANGED pins"
            >
              Changed{" "}
              <span className="font-mono ml-1">{pinCounts.changed}</span>
            </button>

            <button
              className={clsx(
                "text-xs px-2 py-1 rounded-full border",
                pinFilter === "added"
                  ? "bg-green-100 border-green-300 text-green-900"
                  : "bg-white border-neutral-300 hover:bg-neutral-50",
              )}
              onClick={() => setPinFilter("added")}
              disabled={!hasPins}
              title="Show only ADDED pins"
            >
              Added <span className="font-mono ml-1">{pinCounts.added}</span>
            </button>

            <button
              className={clsx(
                "text-xs px-2 py-1 rounded-full border",
                pinFilter === "removed"
                  ? "bg-red-100 border-red-300 text-red-900"
                  : "bg-white border-neutral-300 hover:bg-neutral-50",
              )}
              onClick={() => setPinFilter("removed")}
              disabled={!hasPins}
              title="Show only REMOVED pins"
            >
              Removed{" "}
              <span className="font-mono ml-1">{pinCounts.removed}</span>
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <input
              className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm w-[320px] bg-white"
              placeholder="Search pinned paths…"
              value={pinSearch}
              onChange={(e) => setPinSearch(e.target.value)}
              disabled={!hasPins}
            />
            <button
              className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
              onClick={() => setPinSearch("")}
              disabled={!pinSearch}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Compact grouped chips */}
        {hasPins ? (
          <div className="border border-neutral-200 rounded-xl p-3 bg-white shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm">Quick Focus Chips</div>
              <div className="text-xs text-neutral-500">
                Click a chip to focus (scroll + highlight) • showing{" "}
                <span className="font-mono">
                  {Math.min(topChips.length, 90)}
                </span>{" "}
                /{" "}
                <span className="font-mono">{filteredPinnedItems.length}</span>
              </div>
            </div>

            {filteredPinnedItems.length === 0 ? (
              <div className="text-sm text-neutral-500">
                No pins match filter/search.
              </div>
            ) : (
              <div className="space-y-3">
                {(["changed", "added", "removed"] as const).map((tone) => {
                  const group = groupedPinned[tone];
                  if (!group.length) return null;

                  const hdrCls =
                    tone === "changed"
                      ? "bg-yellow-50 border-yellow-200 text-yellow-900"
                      : tone === "added"
                        ? "bg-green-50 border-green-200 text-green-900"
                        : "bg-red-50 border-red-200 text-red-900";

                  const chipCls =
                    tone === "changed"
                      ? "bg-yellow-50 border-yellow-200 text-yellow-900 hover:bg-yellow-100"
                      : tone === "added"
                        ? "bg-green-50 border-green-200 text-green-900 hover:bg-green-100"
                        : "bg-red-50 border-red-200 text-red-900 hover:bg-red-100";

                  // limit DOM for each group
                  const visible = group.slice(0, 30);

                  return (
                    <div key={tone} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={clsx(
                            "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                            hdrCls,
                          )}
                        >
                          {tone.toUpperCase()}
                        </span>
                        <span className="text-xs text-neutral-500">
                          <span className="font-mono">{group.length}</span>
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {visible.map((it) => {
                          const np = normalizePath(it.path);

                          return (
                            <button
                              key={`${it.tone}:${np}`}
                              type="button"
                              data-path={np}
                              className={clsx(
                                "text-xs font-mono px-2 py-1 rounded-full border transition inline-flex items-center gap-2",
                                chipCls,
                              )}
                              title={`Focus: ${it.tone.toUpperCase()} • ${it.path}`}
                              onClick={() => {
                                focusFromChip(np, it.tone);
                                // WOW #11 — flash del row correspondiente (si existe en el diff)
                                pinned.flashByPath?.(np);
                              }}
                            >
                              <span
                                className={clsx(
                                  "text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-white/80",
                                  "border-neutral-300 text-neutral-800",
                                )}
                                title={it.tone.toUpperCase()}
                              >
                                {toneMini(it.tone)}
                              </span>
                              <span>{it.path}</span>
                            </button>
                          );
                        })}

                        {group.length > visible.length ? (
                          <span className="text-xs text-neutral-500">
                            +{group.length - visible.length} more…
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {pinnedCount === 0 ? (
          <div className="text-sm text-neutral-500">
            No pins yet. Pin paths from chips or the Change Inspector.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {pinsSorted.map((p) => {
              const np = normalizePath(p.pointer);
              const visibleInDiff = diffList.some(
                (x) => x.path === np && x.tone === p.tone,
              );
              const hiddenByFilters =
                Boolean(search.trim()) || onlyChanged || expandOnlyChanged;

              const tb = toneBadge(p.tone as any);

              return (
                <div
                  key={p.rowId}
                  data-path={np}
                  className="border border-neutral-200 rounded-lg p-3 bg-neutral-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-neutral-800 break-words">
                        {np}
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        {tb ? (
                          <span
                            className={clsx(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                              tb.cls,
                            )}
                          >
                            {tb.label}
                          </span>
                        ) : null}

                        {!visibleInDiff ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-white border-neutral-300 text-neutral-700">
                            ORPHANED
                          </span>
                        ) : hiddenByFilters ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-white border-neutral-300 text-neutral-700">
                            FILTERED
                          </span>
                        ) : null}

                        <span className="text-[10px] text-neutral-500">
                          {new Date(p.updatedAtMs).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <button
                        className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
                        onClick={() => focusFromPinned(p)}
                        title="Focus"
                      >
                        Go to
                      </button>

                      <button
                        className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
                        onClick={() => revealAndFocusPinned(p)}
                        title="Clear filters & focus"
                      >
                        Reveal
                      </button>

                      <button
                        className="text-xs px-2 py-1 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
                        onClick={() => pinned.unpin(p.rowId)}
                        title="Unpin"
                      >
                        Unpin
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {data ? (
        <div className="space-y-4">
          {activeTab === "semantic" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {explain ? (
                <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-neutral-900">
                        🧠 AI Insight — ¿Qué cambió realmente?
                      </div>
                      <div className="mt-1 text-sm text-neutral-700">
                        {explain.summary}
                      </div>
                    </div>

                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs text-neutral-700">
                      confidence: {String(explain.confidence ?? "—")}
                    </span>
                  </div>

                  {Array.isArray(explain.bullets) && explain.bullets.length ? (
                    <ul className="mt-3 list-disc pl-5 text-sm text-neutral-700 space-y-1">
                      {explain.bullets.map((b: string, i: number) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {hotspotsByGroup.length ? (
                <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-neutral-900">
                        🔥 Hotspots — ¿Dónde están los cambios?
                      </div>
                      <div className="mt-1 text-sm text-neutral-700">
                        Click en un chip para enfocar el inspector. Pin para
                        guardarlo.
                      </div>
                    </div>

                    <div className="text-xs text-neutral-600">
                      Total:{" "}
                      <span className="font-mono">{hotspotRows.length}</span>
                    </div>
                  </div>

                  <div className="mt-3 space-y-3">
                    {hotspotsByGroup.map(({ group, rows = [] }) => (
                      <div
                        key={group}
                        className="rounded-xl border border-neutral-200 bg-neutral-50 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-neutral-900">
                            {titleForGroup(group)}
                          </div>
                          <div className="text-xs text-neutral-600">
                            <span className="font-mono">{rows.length}</span>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          {rows.slice(0, 12).map((r) => (
                            <div
                              key={`${r.tone}:${r.path}`}
                              className="flex items-center gap-1"
                            >
                              <button
                                className="rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-xs hover:bg-neutral-100"
                                title="Focus"
                                onClick={() => focusFromChip(r.path, r.tone)}
                              >
                                {r.path}
                              </button>

                              <button
                                className="rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-xs hover:bg-neutral-100"
                                title="Pin"
                                onClick={() => togglePinFor(r.path, r.tone)}
                              >
                                📌
                              </button>
                            </div>
                          ))}

                          {rows.length > 12 ? (
                            <span className="text-xs text-neutral-600">
                              +{rows.length - 12} más…
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm">
                <div className="font-semibold mb-2">Semantic Result</div>
                <div className="text-sm text-neutral-700 space-y-2">
                  <div>
                    <span className="text-neutral-500">Classification:</span>{" "}
                    <span className="font-mono">
                      {data.semantic?.classification ?? "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500">Score:</span>{" "}
                    <span className="font-mono">
                      {data.semantic?.score ?? "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500">Method:</span>{" "}
                    <span className="font-mono">
                      {data.semantic?.method ?? "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-neutral-500">Summary:</span>{" "}
                    {data.semantic?.summary ?? "—"}
                  </div>
                </div>
              </div>

              <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm space-y-4">
                <div className="font-semibold">
                  Diff Signals (click to focus)
                </div>

                <PathChips
                  title="Changed paths"
                  paths={changedPaths}
                  tone="changed"
                  onPick={(p) => focusFromChip(p, "changed")}
                  onTogglePin={(p) => togglePinFor(p, "changed")}
                  isPinned={(p) => isPinnedPath(p, "changed")}
                />

                <PathChips
                  title="Added paths"
                  paths={addedPaths}
                  tone="added"
                  onPick={(p) => focusFromChip(p, "added")}
                  onTogglePin={(p) => togglePinFor(p, "added")}
                  isPinned={(p) => isPinnedPath(p, "added")}
                />

                <PathChips
                  title="Removed paths"
                  paths={removedPaths}
                  tone="removed"
                  onPick={(p) => focusFromChip(p, "removed")}
                  onTogglePin={(p) => togglePinFor(p, "removed")}
                  isPinned={(p) => isPinnedPath(p, "removed")}
                />
              </div>
            </div>
          ) : null}

          {activeTab === "side" ? (
            <div
              ref={diffScopeRef}
              data-pin-scope="diff"
              className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4"
            >
              <JsonDiffTree
                title={`A — ${view === "payload" ? "payloadJson" : "outputJson"}${onlyChanged ? " (only changed)" : ""}`}
                value={aJson ?? null}
                side="a"
                changedPaths={changedPaths}
                addedPaths={addedPaths}
                removedPaths={removedPaths}
                defaultExpandDepth={onlyChanged ? 1 : 2}
                expandOnlyChanged={expandOnlyChanged}
                searchQuery={search}
                getOtherValueAtPath={(p) => getAtPath(bJsonBase, p)}
                focusPath={focusPath}
                focusToken={focusToken}
              />

              <JsonDiffTree
                title={`B — ${view === "payload" ? "payloadJson" : "outputJson"}${onlyChanged ? " (only changed)" : ""}`}
                value={bJson ?? null}
                side="b"
                changedPaths={changedPaths}
                addedPaths={addedPaths}
                removedPaths={removedPaths}
                defaultExpandDepth={onlyChanged ? 1 : 2}
                expandOnlyChanged={expandOnlyChanged}
                searchQuery={search}
                getOtherValueAtPath={(p) => getAtPath(aJsonBase, p)}
                focusPath={focusPath}
                focusToken={focusToken}
              />

              {/* Change Inspector */}
              <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">Change Inspector</div>
                    <div className="text-xs text-neutral-500">
                      Focused path • hotkeys{" "}
                      <span className="font-mono">N</span>/
                      <span className="font-mono">P</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <a
                      className="text-xs px-2 py-1 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
                      href={aLink}
                      title="Open Output A"
                    >
                      Open A
                    </a>
                    <a
                      className="text-xs px-2 py-1 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
                      href={bLink}
                      title="Open Output B"
                    >
                      Open B
                    </a>
                  </div>
                </div>

                <div className="border border-neutral-200 rounded-lg p-3 bg-neutral-50 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-neutral-600">Path</div>
                    <div className="flex items-center gap-2">
                      {toneBadge(inspectorTone) ? (
                        <span
                          className={clsx(
                            "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                            toneBadge(inspectorTone)!.cls,
                          )}
                        >
                          {toneBadge(inspectorTone)!.label}
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-neutral-50 border-neutral-200 text-neutral-600">
                          NONE
                        </span>
                      )}

                      <button
                        className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-300 bg-white hover:bg-neutral-50"
                        onClick={() => copyText(inspectorPath || "")}
                        disabled={!inspectorPath}
                        title="Copy path"
                      >
                        Copy Path
                      </button>

                      <button
                        className={clsx(
                          "text-[10px] px-2 py-0.5 rounded-full border bg-white hover:bg-neutral-50",
                          inspectorPinnedOn
                            ? "border-neutral-900 text-neutral-900"
                            : "border-neutral-300 text-neutral-700",
                        )}
                        onClick={() => {
                          if (!inspectorPath) return;
                          if (!inspectorToneAsDiffTone) return;
                          pinned.togglePin({
                            path: inspectorPath,
                            tone: inspectorToneAsDiffTone,
                          });
                        }}
                        disabled={
                          navDisabled ||
                          !inspectorPath ||
                          !inspectorToneAsDiffTone
                        }
                        title={
                          inspectorPinnedOn
                            ? "Unpin this path+tone"
                            : "Pin this path+tone"
                        }
                      >
                        {inspectorPinnedOn ? "📌 Pinned" : "📍 Pin"}
                      </button>
                    </div>
                  </div>

                  <div className="font-mono text-xs text-neutral-800 break-words">
                    {inspectorPath || "—"}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <ValuePanel
                    label="A value"
                    tone={inspectorTone === "added" ? "none" : inspectorTone}
                    value={inspectorPath ? inspectorA : null}
                    onCopy={() => copyText(JSON.stringify(inspectorA, null, 2))}
                  />
                  <ValuePanel
                    label="B value"
                    tone={inspectorTone === "removed" ? "none" : inspectorTone}
                    value={inspectorPath ? inspectorB : null}
                    onCopy={() => copyText(JSON.stringify(inspectorB, null, 2))}
                  />
                </div>

                <div className="text-xs text-neutral-500">
                  Tip: si el path es largo, usa{" "}
                  <span className="font-mono">Copy Path</span> y pégalo en
                  search.
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "raw" ? (
            <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm">
              <div className="font-semibold mb-2">Raw CompareResult</div>
              <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words bg-neutral-50 border border-neutral-200 rounded-lg p-3 overflow-auto max-h-[520px]">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          ) : null}

          {activeTab === "side" ? (
            <div className="text-xs text-neutral-500">
              Tip: Hotkeys <span className="font-mono">N</span>/
              <span className="font-mono">P</span> = next/prev change. Use{" "}
              <span className="font-mono">←</span>/
              <span className="font-mono">→</span> or{" "}
              <span className="font-mono">Enter</span> to collapse/expand.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-neutral-500">
          {loading ? "Loading…" : "No data yet."}
        </div>
      )}

      {showImportPins ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-neutral-200 shadow-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">Import Pins</div>
                <div className="text-xs text-neutral-500">
                  Paste JSON exported from pins snapshot (schema v1).
                </div>
              </div>
              <button
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
                onClick={() => setShowImportPins(false)}
              >
                Close
              </button>
            </div>

            <textarea
              className="w-full h-[260px] text-xs font-mono p-3 rounded-xl border border-neutral-300 bg-neutral-50"
              placeholder='Paste JSON here... {"schema":"innova.compare.pins.snapshot.v1", ...}'
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />

            {importInfo ? (
              <div className="text-xs text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg p-2">
                {importInfo}
              </div>
            ) : null}

            {pinned.lastImportError ? (
              <div className="text-xs text-red-700 border border-red-200 bg-red-50 rounded-lg p-2 whitespace-pre-wrap">
                {pinned.lastImportError}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                className="px-3 py-1.5 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
                onClick={() => {
                  setImportText("");
                  setImportInfo(null);
                }}
                disabled={!importText}
              >
                Clear
              </button>

              <button
                className="px-3 py-1.5 rounded-lg border border-neutral-900 bg-neutral-900 text-white text-sm hover:bg-neutral-800"
                onClick={() => {
                  try {
                    const res = pinned.importPinsJsonText(importText);
                    setImportInfo(
                      `Imported ${res.imported} pins • Total now ${res.total}.`,
                    );
                  } catch {
                    setImportInfo(null);
                  }
                }}
                disabled={!importText.trim()}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
