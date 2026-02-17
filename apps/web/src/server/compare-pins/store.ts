import fs from "fs/promises";
import path from "path";

const ROOT = path.join(process.cwd(), ".data", "compare-pins");

function safeKey(k: string) {
  // evita caracteres raros en nombre de archivo
  return k.replace(/[^a-zA-Z0-9._=-]/g, "_");
}

function filePath(compareKey: string) {
  return path.join(ROOT, `${safeKey(compareKey)}.json`);
}

export async function loadComparePins(compareKey: string) {
  try {
    const p = filePath(compareKey);
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveComparePins(compareKey: string, snapshot: unknown) {
  await fs.mkdir(ROOT, { recursive: true });
  const p = filePath(compareKey);
  await fs.writeFile(p, JSON.stringify(snapshot, null, 2), "utf8");
}
