import type { CorrectionFact, ScientificData } from "./corrections";

export type PackageSource = { id: string; revision: number; data: ScientificData };
export type PackageEvidenceInput = {
  relationship_id: string | null;
  source_id: string | null;
  expected_relationship_revision: number | null;
  expected_source_revision: number | null;
  action: "retain" | "change" | "remove" | "add";
  changes: ScientificData;
  reason: string;
  new_source?: ScientificData;
};
export type PackageEvidence = PackageEvidenceInput & {
  before: ScientificData | null;
  proposed: ScientificData | null;
  source: PackageSource | null;
};
export type PackageEligibility = { eligible: boolean; reasons: string[] };
type ApprovalEvidenceSnapshot = {
  id: string;
  revision: number;
  data: ScientificData & { citation_override?: ScientificData };
  source: PackageSource;
};
export type PackageDecision = "accept" | "accept_and_approve" | "return" | "reject";
export type FactCorrectionPackage = {
  id: string;
  incident_id: string;
  incident_label: string;
  fact_id: string;
  fact_revision: number;
  reason: string;
  status: "pending" | "accepted" | "returned" | "rejected";
  proposed_by: string;
  proposed_by_name: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  decision: PackageDecision | null;
  before: ScientificData;
  proposed: ScientificData;
  before_context: ScientificData;
  evidence: PackageEvidence[];
  same_fact_attestation: true;
  previous_correction_id: string | null;
  flag_id: string | null;
  flag_link_reason: string | null;
  approval_eligibility: PackageEligibility;
  scientific_approval: (ScientificData & { approval_basis?: ApprovalEvidenceSnapshot[] }) | null;
  history: ScientificData[];
};
export type FactCorrectionPackagesSnapshot = {
  incident_id: string;
  incident_label: string;
  revision: number;
  facts: CorrectionFact[];
  packages: FactCorrectionPackage[];
  source_catalog: PackageSource[];
  writes_enabled: boolean;
};
export type FactCorrectionPackageQueue = {
  packages: FactCorrectionPackage[];
  writes_enabled: boolean;
};
export type PackageProposalPayload = {
  fact_id: string;
  expected_fact_revision: number;
  changes: ScientificData;
  reason: string;
  same_fact_attestation: true;
  evidence: PackageEvidenceInput[];
  previous_correction_id?: string;
  flag_id?: string;
  flag_link_reason?: string;
};
export type PackageReviewPayload = {
  correction_id: string;
  decision: PackageDecision;
  reason: string;
  approval?: { attestation: true; review_basis: string; evidence_indices: number[] };
};
export type FactCorrectionPackageCommand = {
  operation_id: string;
  incident_id: string;
  expected_revision: number;
} & (
  | { kind: "propose_fact_correction_package"; payload: PackageProposalPayload }
  | { kind: "review_fact_correction_package"; payload: PackageReviewPayload }
);
