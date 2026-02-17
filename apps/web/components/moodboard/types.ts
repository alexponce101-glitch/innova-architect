export type MoodboardItemType = "image" | "link" | "text";

export type MoodboardItem = {
  id: string;
  type: MoodboardItemType;
  createdAt: number;

  title?: string;
  note?: string;

  // link
  url?: string;

  // image (local-only)
  imageFileName?: string;
  imageDataUrl?: string;

  // v1: tags (store as labels for now; backend later can map to ids)
  tags?: string[];
};

export type MoodboardStateV1 = {
  version: 1;
  items: MoodboardItem[];
  // v1: global tag registry (labels)
  tags: string[];
  ui: {
    selectedTags?: string[];
    filterText?: string; // ✅ NUEVO: persistir búsqueda
    view?: "grid";
    sort?: "newest";
  };
};
