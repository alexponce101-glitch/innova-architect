// apps/web/src/server/lineage/fingerprint.ts
import crypto from "crypto";

export function stableStringify(value: unknown): string {
  // JSON estable: ordena keys recursivamente, elimina undefined
  const seen = new WeakSet();

  const normalize = (v: any): any => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== "object") return v;

    if (seen.has(v)) {
      // No esperamos ciclos en spec; si pasa, es bug.
      throw new Error("stableStringify: cyclic structure detected");
    }
    seen.add(v);

    if (Array.isArray(v)) {
      return v.map(normalize).filter((x) => x !== undefined);
    }

    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      const nv = normalize(v[k]);
      if (nv !== undefined) out[k] = nv;
    }
    return out;
  };

  return JSON.stringify(normalize(value));
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hashObjectStable(obj: unknown): string {
  return sha256(stableStringify(obj));
}
