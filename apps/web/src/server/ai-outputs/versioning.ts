// apps/web/src/server/ai-outputs/versioning.ts

export type BumpLevel = "patch" | "minor" | "major";

function parse(v: unknown): { maj: number; min: number; pat: number } {
  // ✅ Nil-safe default
  if (typeof v !== "string" || !v.trim()) return { maj: 1, min: 0, pat: 0 };

  const s = v.trim();
  const cleaned = s.startsWith("v") ? s.slice(1) : s;

  const parts = cleaned
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);

  const maj = Number.parseInt(parts[0] ?? "1", 10);
  const min = Number.parseInt(parts[1] ?? "0", 10);
  const pat = Number.parseInt(parts[2] ?? "0", 10);

  return {
    maj: Number.isFinite(maj) ? maj : 1,
    min: Number.isFinite(min) ? min : 0,
    pat: Number.isFinite(pat) ? pat : 0,
  };
}

function fmt(v: { maj: number; min: number; pat: number }) {
  return `${v.maj}.${v.min}.${v.pat}`;
}

export function bumpPatch(v: unknown) {
  const cur = parse(v);
  return fmt({ maj: cur.maj, min: cur.min, pat: cur.pat + 1 });
}

export function bumpMinor(v: unknown) {
  const cur = parse(v);
  return fmt({ maj: cur.maj, min: cur.min + 1, pat: 0 });
}

export function bumpMajor(v: unknown) {
  const cur = parse(v);
  return fmt({ maj: cur.maj + 1, min: 0, pat: 0 });
}

export function bump(v: unknown, level: BumpLevel) {
  if (level === "major") return bumpMajor(v);
  if (level === "minor") return bumpMinor(v);
  return bumpPatch(v);
}
