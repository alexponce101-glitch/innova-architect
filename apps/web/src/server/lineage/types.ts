// apps/web/src/server/lineage/types.ts

export type LineageEdgeType =
  | "DERIVED_FROM" // refine/edit/transform (cambió contenido)
  | "REEXPORT_OF" // mismo contenido, distinto packaging/format
  | "USES_AS_INPUT"
  | "MERGED_FROM";

export type LineageEdge = {
  id: string;
  fromId: string; // child
  toId: string; // parent/source
  type: LineageEdgeType;
  reason?: string;
  meta?: {
    createdAt: string;
    actor?: "SYSTEM" | "USER" | "API";
    route?: string;
  };
};

export type OutputKind =
  | "BRIEF"
  | "STYLE_PROFILE"
  | "PROMPT"
  | "EXPORT"
  | "REFINE";

export type OutputSpec = {
  moodboardId: string;
  kind: OutputKind;

  // versión de tu motor/pipeline (lo que afecta resultado)
  engineVersion: string;

  // configuración determinística que afecta contenido
  params: Record<string, unknown>;

  // inputs determinísticos
  inputs: {
    parentOutputIds?: string[];
    styleProfileId?: string;
    briefId?: string;
    assetsHash?: string;
  };

  // packaging: solo debe afectar exportFingerprint (no contentFingerprint)
  packaging?: {
    format: "json" | "pdf" | "zip";
    templateId?: string;
    locale?: string;
  };
};

export type OutputDigest = {
  schemaVersion: "1";
  contentHash: string; // contentFingerprint
  structuralHash?: string; // opcional: hash del shape
  textPreview?: string; // opcional: 200-500 chars
  stats?: {
    keys?: number;
    bytes?: number;
  };
};
