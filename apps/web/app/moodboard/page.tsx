import MoodboardClient from "../../components/moodboard/MoodboardClient";

export default function MoodboardPage() {
  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Moodboard</h1>
        <span style={{ opacity: 0.7 }}>
          v0 — referencias + notas + uploads locales
        </span>
      </div>

      <p style={{ marginTop: 8, opacity: 0.8, lineHeight: 1.5 }}>
        Sube imágenes y agrega links/notas. Por ahora se guarda en el navegador
        (local) para no perder tu trabajo.
      </p>

      <div style={{ marginTop: 20 }}>
        <MoodboardClient />
      </div>
    </main>
  );
}
