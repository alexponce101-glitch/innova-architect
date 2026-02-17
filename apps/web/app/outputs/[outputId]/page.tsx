import CompareBoundVersionHistory from "./CompareBoundVersionHistory";
import ExportPanelClient from "./ExportPanelClient";

async function unwrapParams(ctx: { params?: any }) {
  const p = ctx?.params;
  return p && typeof p.then === "function" ? await p : p;
}

export default async function OutputDetailPage(ctx: {
  params?: { outputId?: string } | Promise<{ outputId?: string }>;
}) {
  const params = await unwrapParams(ctx);
  const outputId = String(params?.outputId ?? "").trim();

  if (!outputId) {
    return <div className="p-6 text-red-600">Missing outputId param.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xl font-semibold">Output</div>
          <div className="text-sm text-neutral-600">
            id: <span className="font-mono">{outputId}</span>
          </div>
        </div>

        <ExportPanelClient outputId={outputId} />
      </div>

      <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm">
        <div className="text-lg font-semibold mb-3">Output Version History</div>
        <CompareBoundVersionHistory outputId={outputId} depth={3} />
      </div>
    </div>
  );
}
