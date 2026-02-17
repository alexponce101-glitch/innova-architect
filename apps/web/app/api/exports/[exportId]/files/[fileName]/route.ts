import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { exportDirAbs } from "../../../../../../src/server/export/paths";

export const runtime = "nodejs";

const ParamsZ = z.object({
  exportId: z.string().uuid(),
  fileName: z.string().min(1),
  // por compatibilidad si antes usaste [name]
  name: z.string().min(1).optional(),
});

async function unwrapParams(ctx: { params?: any }) {
  const p = ctx?.params;
  return p && typeof p.then === "function" ? await p : p;
}

/** Content-type por extensión */
function contentTypeFor(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".md":
      return "text/markdown; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

function safeDecodeURIComponent(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    // si viene mal-encoded, lo tratamos como literal
    return s;
  }
}

function isAbsoluteOrHasDrive(p: string) {
  // windows drive (C:\) o UNC (\\server\share)
  return (
    /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\") || path.isAbsolute(p)
  );
}

export async function GET(req: Request, ctx: { params?: any }) {
  try {
    const rawParams = await unwrapParams(ctx);

    // Next puede mandar fileName o name dependiendo del segment
    const parsed = ParamsZ.safeParse({
      exportId: rawParams?.exportId,
      fileName: rawParams?.fileName ?? rawParams?.name,
      name: rawParams?.name,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "BAD_PARAMS", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const exportId = parsed.data.exportId;

    // fileName viene URL-encoded a veces (espacios, #, etc.)
    const decodedFileName = safeDecodeURIComponent(parsed.data.fileName).trim();

    if (!decodedFileName) {
      return NextResponse.json(
        { error: "BAD_PARAMS", message: "Missing fileName." },
        { status: 400 },
      );
    }

    // Bloqueo extra: nada de rutas absolutas / drive letters / UNC
    if (isAbsoluteOrHasDrive(decodedFileName)) {
      return NextResponse.json(
        { error: "FORBIDDEN_PATH", message: "Invalid file path." },
        { status: 400 },
      );
    }

    const baseDir = exportDirAbs(exportId);
    const baseAbs = path.resolve(baseDir);

    // Normaliza separadores para evitar bypass con "\"
    const normalizedRel = decodedFileName.replace(/\\/g, "/");

    // Anti path traversal:
    // - normalizamos
    // - removemos prefijos ../ repetidos
    // - evitamos prefijo de separadores
    const safeRel = path
      .normalize(normalizedRel)
      .replace(/^(\.\.(\/|\\|$))+/, "")
      .replace(/^([/\\])+/, "");

    const absPath = path.resolve(baseDir, safeRel);

    if (!absPath.startsWith(baseAbs + path.sep) && absPath !== baseAbs) {
      return NextResponse.json(
        { error: "FORBIDDEN_PATH", message: "Invalid file path." },
        { status: 400 },
      );
    }

    // Lee el archivo
    let buf: Buffer;
    let stat: { mtimeMs: number; size: number };
    try {
      const s = await fs.stat(absPath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
      buf = await fs.readFile(absPath);
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        return NextResponse.json(
          { error: "NOT_FOUND", message: "File not found." },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: "READ_FAILED", message: String(e?.message ?? e) },
        { status: 500 },
      );
    }

    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;

    // 304 support
    const inm = req.headers.get("if-none-match");
    if (inm && inm === etag) {
      const h = new Headers();
      h.set("ETag", etag);
      h.set("Cache-Control", "private, max-age=0, must-revalidate");
      return new NextResponse(null, { status: 304, headers: h });
    }

    const headers = new Headers();
    headers.set("Content-Type", contentTypeFor(decodedFileName));
    headers.set(
      "Content-Disposition",
      `inline; filename="${path.basename(decodedFileName)}"`,
    );
    headers.set("ETag", etag);
    headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    headers.set("X-Content-Type-Options", "nosniff");

    return new NextResponse(new Uint8Array(buf), { status: 200, headers });
  } catch (e: any) {
    return NextResponse.json(
      { error: "UNHANDLED", message: String(e?.message ?? e) },
      { status: 500 },
    );
  }
}
