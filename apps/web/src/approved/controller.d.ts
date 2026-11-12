import type { Snapshot } from "@rvw/domain";
export function mountWorkspace(
  container: HTMLElement,
  snapshot: Snapshot,
  initialView?: string,
  incidentId?: string | null,
  onAnalytics?: (action: "open" | "close" | "refresh") => void,
  onCorrectionQueue?: (target: HTMLElement | null) => void,
): () => void;
