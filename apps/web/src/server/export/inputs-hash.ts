import crypto from "crypto";

/**
 * Canonical JSON stringifier:
 * - Ordena keys de objetos para hash estable.
 * - Mantiene arrays en orden.
 */
export function stableStringify(v: unknown): string {
  return JSON.stringify(v, function (key, value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
    return sorted;
  });
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function computeExportInputsHash(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}
