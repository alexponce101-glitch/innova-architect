"use client";

import OutputVersionHistory from "../../../src/components/outputs/OutputVersionHistory";
import { useRouter } from "next/navigation";

export default function CompareBoundVersionHistory(props: {
  outputId: string;
  depth: number;
}) {
  const router = useRouter();

  return (
    <OutputVersionHistory
      outputId={props.outputId}
      depth={props.depth}
      onCompare={(aId: string, bId: string) => {
        const qs = new URLSearchParams({
          a: aId,
          b: bId,
          mode: "semantic",
        });
        router.push(`/outputs/compare?${qs.toString()}`);
      }}
    />
  );
}
