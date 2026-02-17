"use client";

type RecommendedPin = {
  path: string;
  reason: string;
  score: number;
  tags?: string[];
};

export default function SuggestedPinsCard({
  items,
  onPinMany,
}: {
  items: RecommendedPin[];
  onPinMany: (paths: string[]) => void;
}) {
  const top = items ?? [];
  const n = top.length;

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Suggested Pins</div>
          <div className="text-xs text-neutral-500">
            Deterministic recommendations (v1)
          </div>
        </div>

        <button
          className="rounded-xl border px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          disabled={n === 0}
          onClick={() => onPinMany(top.map((x) => x.path))}
        >
          ✨ Pin Recommended ({n})
        </button>
      </div>

      {n === 0 ? (
        <div className="mt-3 text-sm text-neutral-500">
          No recommendations for this compare.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {top.slice(0, 10).map((it) => (
            <div key={it.path} className="rounded-xl bg-neutral-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-xs">{it.path}</div>
                <div className="text-xs text-neutral-500">score {it.score}</div>
              </div>
              <div className="mt-1 text-sm text-neutral-700">{it.reason}</div>
              {it.tags?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {it.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border bg-white px-2 py-0.5 text-xs text-neutral-600"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
