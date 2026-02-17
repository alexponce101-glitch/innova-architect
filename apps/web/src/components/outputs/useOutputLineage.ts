"use client";

import { useCallback, useEffect, useState } from "react";

export function useOutputLineage(outputId: string, depth = 2) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIt = useCallback(async () => {
    if (!outputId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/outputs/${encodeURIComponent(outputId)}/lineage?depth=${depth}`,
        { method: "GET" },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP_${res.status}`);
      setData(json);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [outputId, depth]);

  useEffect(() => {
    fetchIt();
  }, [fetchIt]);

  return { data, loading, error, refresh: fetchIt };
}
