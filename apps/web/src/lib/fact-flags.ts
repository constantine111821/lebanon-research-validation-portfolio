import type { ScientificData } from "./corrections";

export type FactFlagResolution = {
  actor_id: string;
  actor_name: string;
  created_at: string;
  reason: string;
  resolution: "correction" | "withdrawal" | "research_follow_up" | "no_change";
  revision: 2;
};
export type FactFlag = {
  id: string;
  incident_id: string;
  fact_id: string;
  actor_id: string;
  actor_name: string;
  created_at: string;
  reason: string;
  suggestion: string | null;
  fact_revision: number;
  fact_snapshot: ScientificData;
  fact_snapshot_sha256: string;
  provenance: ScientificData;
  status: "pending" | "resolved";
  revision: 1 | 2;
  resolution: FactFlagResolution | null;
};
