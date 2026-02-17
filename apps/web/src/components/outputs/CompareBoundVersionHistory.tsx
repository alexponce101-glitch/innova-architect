"use client";

import { useRouter } from "next/navigation";
import OutputVersionHistory from "./OutputVersionHistory";

export default function CompareBoundVersionHistory(props: {
  outputId: string;
  depth: number;
}) {
  const { outputId, depth } = props;
  const router = useRouter();

  return (
    <OutputVersionHistory
      outputId={outputId}
      depth={depth}
      onCompare={(aId: string, bId: string) => {
        router.push(
          `/outputs/compare?a=${encodeURIComponent(aId)}&b=${encodeURIComponent(
            bId,
          )}&mode=semantic`,
        );
      }}
    />
  );
}
