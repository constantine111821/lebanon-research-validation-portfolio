// Aggregate-only boundary. No event inputs, identifiers, text or identity fields.
import { z } from "zod";
export const ORIGINS = [
  "RESEARCH",
  "UNKNOWN",
  "IMPORT",
  "HISTORICAL_PRESERVATION",
  "SMOKE_OR_REHEARSAL",
  "SYSTEM_PROPAGATION",
] as const;
const TYPES = [
  "source_created",
  "fact_reviewed",
  "fact_review_reopened",
  "fact_created",
  "incident_created",
  "facility_created",
  "fact_source_linked",
  "task_state_changed",
  "facility_location_reviewed",
  "facility_location_evidence_added",
  "approval_invalidated",
  "approval_carried_forward",
  "disposition_requested",
  "request_decided",
  "dependency_invalidated",
  "disposition_decision",
  "facility_identity_resolved",
  "facility_identity_reopened",
] as const;
const n = z.number().int().nonnegative().safe();
const seconds = z.number().nonnegative().finite().nullable();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().datetime({ offset: true });
const knownHash = z.union([digest, z.literal("UNKNOWN")]);
const decisions = z.object({ APPROVE: n, DEFER: n, REOPEN: n }).strict();
const flow = z
  .object({
    incidents_touched: n,
    by_type: z
      .object(
        Object.fromEntries(
          TYPES.map((t) => [
            t,
            z.object({ episodes: n, entities: n }).strict(),
          ]),
        ) as Record<
          (typeof TYPES)[number],
          z.ZodObject<{ episodes: typeof n; entities: typeof n }>
        >,
      )
      .strict(),
    fact_decisions: decisions,
    incident_decisions: decisions,
    task_outcomes: z
      .object({
        RESOLVED: n,
        DEFERRED: n,
        UNABLE_TO_RESOLVE: n,
        BLOCKED: n,
        ACTIVE: n,
      })
      .strict(),
  })
  .strict();
const flows = z
  .object(
    Object.fromEntries(ORIGINS.map((o) => [o, flow])) as Record<
      (typeof ORIGINS)[number],
      typeof flow
    >,
  )
  .strict();
export const snapshotSchema = z
  .object({
    status: z.literal("AVAILABLE"),
    content_sha256: digest,
    manifest: z
      .object({
        schema_version: z.literal(1),
        normalization_version: z.literal(1),
        metric_definition_sha256: digest,
        query_sha256: digest,
        extractor_commit: z.union([
          z.string().regex(/^[0-9a-f]{40}$/),
          z.literal("UNKNOWN"),
        ]),
        extractor_sha256: digest,
        week_start_local: date,
        week_end_local: date,
        timezone: z.literal("America/New_York"),
        window_start_utc: instant,
        window_end_utc: instant,
        captured_at_utc: instant,
        state_as_of_utc: instant,
        boundary_lag_seconds: z.number().finite(),
        status: z.enum(["PARTIAL", "RESTATED"]),
        report_revision: n.min(1),
        supersedes_sha256: digest.nullable(),
        bindings: z
          .object({
            application_commit: z.union([
              z.string().regex(/^[0-9a-f]{40}$/),
              z.literal("UNKNOWN"),
            ]),
            corpus_sha256: knownHash,
            methodology_sha256: knownHash,
            scope_sha256: knownHash,
            authority_sha256: digest.optional(),
            effective_at: instant.optional(),
          })
          .strict(),
        coverage: z.literal("PARTIAL_EXISTING_HISTORY_AND_ACTUAL_CAPTURE"),
        policy: z.literal("OWNER_AMENDMENT_008"),
        study_dates: z.literal("UNKNOWN"),
        methodology_scope_retroactive_assignment: z.literal(false),
      })
      .strict(),
    aggregate: z
      .object({
        weekly: flows,
        cumulative: flows,
        current_stock: z
          .object({
            INCIDENT: n,
            CLAIM: n,
            FACILITY: n,
            SOURCE: n,
            CLAIM_SOURCE: n,
            GAP_TASK: n,
            UNKNOWN: n,
            eligible_incidents: n,
            complete_incidents: n,
            deferred_incidents: n,
            needs_reapproval: n,
            current_facts: n,
            active_pending_acceptance: n,
            valid_reviewed_facts: n,
            waived_facts: n,
            unknown_values: n,
            conflicting_facts: n,
            eligibility_rate: z.number().min(0).max(1).nullable(),
            factual_review_coverage: z.number().min(0).max(1).nullable(),
          })
          .strict(),
        cohort: z
          .object({
            weekly_research: n,
            weekly_unknown: n,
            cumulative_research: n,
            cumulative_unknown: n,
            active_at_capture: n,
            historical_denominator: z.literal("UNKNOWN"),
            weekly_denominator: n.nullable(),
            adoption_rate: z.null(),
          })
          .strict(),
        request_to_decision: z
          .object({
            n,
            median_seconds: seconds,
            min_seconds: seconds,
            max_seconds: seconds,
            pending: n,
            declined: n,
            stale: n,
            invalid_duration: n,
          })
          .strict(),
        historical_source_states: z
          .object({
            RESEARCH_COMPLETED: n.optional(),
            IDENTITY_BLOCKED: n.optional(),
            DEFERRED: n.optional(),
            UNKNOWN: n.optional(),
            COMPLETED: n.optional(),
          })
          .strict(),
        mapping_authority: z.array(
          z
            .object({
              target_type: z.enum(["FACILITY", "INCIDENT", "CLAIM"]),
              authority: z.enum([
                "APPROVED_EXISTING",
                "PROPOSED",
                "OWNER_APPROVED",
                "UNKNOWN",
              ]),
              n,
            })
            .strict(),
        ),
        corpus_import_digests: z.array(digest),
        coverage: z
          .object({
            supporting_records: n,
            semantic_duplicates: n,
            missing_or_uncertain_time: n,
            future_events: n,
            excluded_records: n,
            exact_friday_stock: z.boolean(),
            source_creation_historical_coverage: z.literal("PARTIAL"),
            historical_roster: z.literal("UNKNOWN"),
            historical_origin: z.literal("PARTIAL_UNKNOWN"),
            assistance: z.literal("UNKNOWN"),
            scope_comparison: z.literal("UNKNOWN"),
            backlog_change: z.null(),
            net_growth: z.null(),
            not_measured: z.array(
              z.enum([
                "views",
                "logins",
                "sessions",
                "labor_time",
                "researcher_completion",
                "AI_causal_gain",
                "learning",
              ]),
            ),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type AnalyticsSnapshot = z.infer<typeof snapshotSchema>;
export type SnapshotRead = AnalyticsSnapshot | { status: "NOT_CAPTURED" };
export type AnalyticsSeries = {
  reporting_week: string;
  read_at_utc: string;
  window_end_week: string;
  current: SnapshotRead;
  latest: SnapshotRead;
  weeks: { week: string; snapshot: SnapshotRead }[];
};
export function shiftWeek(week: string, offset: number) {
  const d = new Date(week + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(week) ||
    !Number.isFinite(d.getTime()) ||
    d.toISOString().slice(0, 10) !== week ||
    d.getUTCDay() !== 5 ||
    !Number.isInteger(offset)
  )
    throw Error("INVALID_REPORTING_WEEK");
  d.setUTCDate(d.getUTCDate() + offset * 7);
  return d.toISOString().slice(0, 10);
}
export function currentReportingWeek(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (key: string) => p.find((v) => v.type === key)!.value;
  const day = new Date(
    `${value("year")}-${value("month")}-${value("day")}T12:00:00Z`,
  );
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 2) % 7));
  return day.toISOString().slice(0, 10);
}
export function reportingWindow(week: string) {
  const boundary = (day: string) => {
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(day + "T12:00:00Z"))
      .find((p) => p.type === "timeZoneName")!
      .value.replace("GMT", "");
    return new Date(day + "T00:00:00" + offset).toISOString();
  };
  return {
    start: boundary(shiftWeek(week, 0)),
    end: boundary(shiftWeek(week, 1)),
  };
}
export function readSnapshot(
  raw: unknown,
  expectedWeek?: string,
): SnapshotRead {
  if (
    raw &&
    typeof raw === "object" &&
    Object.keys(raw).length === 1 &&
    "status" in raw &&
    raw.status === "NOT_CAPTURED"
  )
    return { status: "NOT_CAPTURED" };
  const v = snapshotSchema.parse(raw),
    m = v.manifest,
    s = v.aggregate.current_stock;
  const window = reportingWindow(m.week_start_local);
  if (
    m.window_start_utc !== window.start ||
    m.window_end_utc !== window.end ||
    m.boundary_lag_seconds !==
      (Date.parse(m.state_as_of_utc) - Date.parse(m.window_end_utc)) / 1000 ||
    shiftWeek(m.week_start_local, 1) !== m.week_end_local ||
    (expectedWeek && expectedWeek !== m.week_start_local) ||
    m.state_as_of_utc !== m.captured_at_utc ||
    Date.parse(m.window_end_utc) <= Date.parse(m.window_start_utc) ||
    (m.report_revision === 1 &&
      (m.status !== "PARTIAL" || m.supersedes_sha256 !== null)) ||
    (m.report_revision > 1 &&
      (m.status !== "RESTATED" || m.supersedes_sha256 === null)) ||
    s.valid_reviewed_facts > s.current_facts ||
    s.eligible_incidents > s.INCIDENT ||
    s.factual_review_coverage !==
      (s.current_facts ? s.valid_reviewed_facts / s.current_facts : null) ||
    s.eligibility_rate !==
      (s.INCIDENT ? s.eligible_incidents / s.INCIDENT : null)
  )
    throw Error("ANALYTICS_CONTRACT_FAILURE");
  return v;
}
export function comparisonNote(a: AnalyticsSnapshot, b: AnalyticsSnapshot) {
  const x = a.manifest,
    y = b.manifest;
  if (
    x.metric_definition_sha256 !== y.metric_definition_sha256 ||
    x.policy !== y.policy
  )
    return "COMPARISON_BREAK";
  const keys = ["corpus_sha256", "methodology_sha256", "scope_sha256"] as const;
  if (
    keys.some(
      (k) =>
        x.bindings[k] !== "UNKNOWN" &&
        y.bindings[k] !== "UNKNOWN" &&
        x.bindings[k] !== y.bindings[k],
    )
  )
    return "COMPARISON_BREAK";
  return keys.some(
    (k) => x.bindings[k] === "UNKNOWN" || y.bindings[k] === "UNKNOWN",
  )
    ? "UNKNOWN_COMPARABILITY"
    : "SAME_BINDINGS";
}
