import crypto from "crypto";
import fs from "fs/promises";

/**
 * Stable JSON stringify to ensure consistent hashing
 * - Sorts object keys recursively
 * - Preserves arrays order
 * - Guards against circular references
 */
export function stableStringify(obj: unknown): string {
  const seen = new WeakSet<object>();

  const replacer = (_key: string, value: any) => {
    if (!value || typeof value !== "object") return value;

    // Avoid crashes on circular structures
    if (seen.has(value)) return undefined;
    seen.add(value);

    // Keep arrays as-is (order matters)
    if (Array.isArray(value)) return value;

    // Sort keys for stable output
    const sorted: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = value[k];
    }
    return sorted;
  };

  return JSON.stringify(obj, replacer);
}

/**
 * SHA-256 hex digest from string or Buffer
 */
export function sha256Hex(input: string | Buffer): string {
  const hash = crypto.createHash("sha256");
  hash.update(input);
  return hash.digest("hex");
}

/**
 * SHA-256 hex digest of a file on disk
 * (used for export checksums)
 */
export async function sha256File(absPath: string): Promise<string> {
  const buf = await fs.readFile(absPath);
  return sha256Hex(buf);
}
