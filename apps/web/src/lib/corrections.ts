// The read model preserves the database's scientific values and stable identifiers.
export type ScientificValue =
  | null
  | boolean
  | number
  | string
  | ScientificValue[]
  | { [key: string]: ScientificValue };
export type ScientificData = Record<string, ScientificValue>;
export type CorrectionTarget = "fact" | "evidence" | "source";
export type CorrectionEvidence = {
  id: string;
  revision: number;
  data: ScientificData;
  source: { id: string; revision: number; data: ScientificData };
};
export type CorrectionFact = {
  id: string;
  revision: number;
  data: ScientificData;
  lock?: { locked?: boolean; reason?: string };
  correction_state?: ScientificValue;
  correction_restriction?: {
    code: "shared_case" | "locked" | "withdrawn" | "pending";
    message: string;
    next_action: string;
  };
  evidence: CorrectionEvidence[];
};
export type Correction = {
  id: string;
  target_type: CorrectionTarget;
  target_id: string;
  fact_id: string;
  action: "amend" | "withdraw";
  reason: string;
  status: "pending" | "accepted" | "rejected";
  proposed_by: string;
  proposed_by_name?: string;
  reviewed_by?: string;
  reviewed_by_name?: string;
  review_reason?: string;
  created_at: string;
  reviewed_at?: string;
  before: ScientificData;
  proposed: ScientificData;
  before_context?: ScientificData;
};
export type CorrectionVersion = {
  id: string;
  correction_id: string;
  entity_type: string;
  entity_id: string;
  revision: number;
  stage: string;
  data: ScientificData;
  actor: string;
  actor_name?: string;
  recorded_at: string;
  acceptance_kind: string;
};
export type CorrectionsSnapshot = {
  incident_id: string;
  incident_label?: string;
  revision: number;
  facts: CorrectionFact[];
  corrections: Correction[];
  history: ScientificData[];
  versions?: CorrectionVersion[];
  opportunities: { id: string; revision: number; data: ScientificData }[];
};
export const correctionFields = {
  fact: [
    "subject",
    "current_verified_value",
    "value_type",
    "date_precision",
    "quantitative_unit",
    "impact_basis",
    "review_notes",
    "open_factual_question",
  ],
  evidence: [
    "support_direction",
    "directness",
    "originality",
    "evidence_locator",
    "limitations",
    "evidence_role",
    "dependency_group_id",
    "dependency_provenance",
  ],
  source: [
    "title",
    "original_url",
    "canonical_url",
    "publisher_platform",
    "source_type",
    "publication_date",
    "retrieval_body_status",
    "content_preservation_status",
    "evidence_locator",
    "limitations",
    "social_fields",
  ],
} as const;
const names: Record<string, string> = {
  subject: "Factual proposition",
  current_verified_value: "Recorded value",
  value_type: "Value type",
  date_precision: "Date precision",
  quantitative_unit: "Unit",
  impact_basis: "Evidence basis",
  review_notes: "Review notes and limitations",
  open_factual_question: "Unresolved question",
  support_direction: "Evidence relationship",
  directness: "Directness",
  originality: "Originality",
  evidence_locator: "Passage references and excerpts",
  limitations: "Material limitations",
  evidence_role: "Evidence role",
  dependency_group_id: "Shared reporting group",
  dependency_provenance: "Reporting dependencies",
  title: "Source title",
  original_url: "Original URL or recorded identifier",
  canonical_url: "Canonical source URL",
  publisher_platform: "Publisher or account",
  source_type: "Source / media type",
  publication_date: "Publication date",
  retrieval_body_status: "Source access",
  content_preservation_status: "Preservation",
  social_fields: "Social source details",
  is_current: "Current use",
  correction_withdrawn: "Withdrawn",
  locator: "Passage reference",
  excerpt: "Excerpt",
  description: "Description",
  value: "Value",
  precision: "Precision",
};
const values: Record<string, string> = {
  SUPPORTS: "Supports",
  CONTRADICTS: "Challenges",
  LIMITS: "Qualifies",
  CONTEXT_ONLY: "Context",
  UNKNOWN: "Unknown",
  DAY: "Exact day",
  MONTH: "Month only",
  APPROXIMATE: "Approximate",
  RANGE: "Date range",
  DATE_RANGE: "Date range",
  BOOLEAN: "Yes / No / Unknown",
  TEXT_WHERE_REQUIRED: "Text",
  QUANTITATIVE: "Quantity",
  CATEGORICAL: "Category",
  DATE: "Date",
  EXACT_TARGET: "Facility itself affected (intent not established)",
  USABLE_BODY: "Complete source available",
  PARTIAL_USABLE_BODY: "Partial source available",
  INDEXED_ONLY: "Index excerpt only",
  INACCESSIBLE_NEUTRAL: "Source inaccessible",
  DUPLICATE_OR_DEPENDENT: "Repeated / dependent copy",
  NEEDS_REVIEW: "Needs renewed review",
};
export function fieldLabel(key: string) {
  return (
    names[key] || key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
  );
}
export function valueLabel(value: ScientificValue | undefined): string {
  if (value === undefined || value === null || value === "")
    return "Unknown / not recorded";
  if (value === true) return "Yes — explicitly recorded";
  if (value === false) return "No — explicitly recorded";
  if (Array.isArray(value))
    return value.length ? value.map(valueLabel).join("; ") : "None recorded";
  if (typeof value === "object")
    return Object.entries(value)
      .map(([k, v]) => `${fieldLabel(k)}: ${valueLabel(v)}`)
      .join("; ");
  return typeof value === "string" ? values[value] || value : String(value);
}
export function correctionStatus(value: ScientificValue | undefined): string {
  const labels: Record<string, string> = {
    review_required:
      "Needs renewed scientific review — prior approval does not apply.",
    not_reviewed: "Not yet scientifically reviewed",
    pending:
      "Correction awaiting independent review · current scientific review is stale",
    withdrawn: "Withdrawn from current use · historical record retained",
    current: "Current recorded version",
    missing_support: "Missing supporting evidence",
    conflicting_evidence: "Conflicting evidence",
    challenged_claim: "Challenged finding",
    claim_withdrawn: "Withdrawn claim",
    withdrawn_fact: "Withdrawn finding",
    withdrawn_relationship: "Evidence relationship withdrawn",
    citation_reassessment: "Citation needs reassessment",
    correction_rejected_review_required:
      "Rejected correction · scientific reassessment needed",
    fact_reassessment: "Finding needs reassessment",
    evidence_withdrawn: "Evidence relationship withdrawn",
  };
  return typeof value === "string"
    ? labels[value] || fieldLabel(value)
    : valueLabel(value);
}
export function changedFields(
  before: ScientificData,
  proposed: ScientificData,
  target: CorrectionTarget,
) {
  return correctionFields[target].filter(
    (key) =>
      JSON.stringify(before[key] ?? null) !==
      JSON.stringify(proposed[key] ?? null),
  );
}
export function sourceHref(source: ScientificData): string | undefined {
  for (const candidate of [source.original_url, source.canonical_url]) {
    if (typeof candidate !== "string") continue;
    try {
      const u = new URL(candidate);
      if (
        ["http:", "https:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
        !u.hostname.endsWith(".invalid")
      )
        return candidate;
    } catch {
      /* Recorded identifiers remain plain text. */
    }
  }
}
export function isWithdrawn(data: ScientificData) {
  return data.is_current === false || data.correction_withdrawn === true;
}
