import test from "node:test";
import assert from "node:assert/strict";
import {
  reportingWeek,
  snapshot,
  verifySnapshot,
  sha256,
  normalize,
  sanitizeExtract,
  compareSnapshots,
} from "../../packages/domain/src/analytics.mjs";
const h = (n) => sha256(String(n));
export const input = () => ({
  state_as_of: "2026-10-09T04:00:00Z",
  events: [],
  states: [],
  cohort: {
    weekly_research: 0,
    weekly_unknown: 0,
    cumulative_research: 0,
    cumulative_unknown: 0,
    active_at_capture: 0,
    historical_denominator: "UNKNOWN",
  },
  bindings: [],
  corpus_import_digests: [],
  historical_source_states: {},
  mapping_authority: [],
  requests: [],
});
const event = (n, at, type = "fact_reviewed") => ({
  source_key: h(n),
  row_sha256: h("row" + n),
  event_key: h(n),
  event_type: type,
  entity_type: "CLAIM",
  entity_key: h("fact" + n),
  incident_key: h("incident"),
  operation_key: null,
  occurred_at: at,
  time_precision: at ? "INSTANT" : "MISSING",
  date_label: null,
  before_state: "UNKNOWN",
  after_state: "UNKNOWN",
  origin: "RESEARCH",
  assistance_basis: "UNKNOWN",
  actor_role: "researcher",
  versions: null,
  canonical: true,
  ledger_match: false,
  drift: false,
});
const options = {
  week: "2026-10-02",
  querySha256: h("query"),
  metricSha256: h("metric"),
};
test("Friday boundaries are local calendar boundaries across both DST transitions", () => {
  for (const [date, hours] of [
    ["2026-03-06", 167],
    ["2026-10-30", 169],
    ["2026-10-02", 168],
  ]) {
    const w = reportingWeek(date);
    assert.equal(
      (Date.parse(w.window_end_utc) - Date.parse(w.window_start_utc)) / 3600000,
      hours,
    );
  }
  assert.throws(() => reportingWeek("2026-10-01"));
  assert.throws(() => reportingWeek("2026-02-30"));
});
test("inclusive start/exclusive end; uncertain times remain cumulative and future excluded", () => {
  const r = input();
  r.events = [
    event(1, "2026-10-02T04:00:00Z"),
    event(2, "2026-10-09T04:00:00Z"),
    event(3, null),
    event(4, "2026-10-10T04:00:00Z"),
  ];
  const s = snapshot(r, options);
  assert.equal(
    s.document.aggregate.weekly.RESEARCH.by_type.fact_reviewed.episodes,
    1,
  );
  assert.equal(
    s.document.aggregate.cumulative.RESEARCH.by_type.fact_reviewed.episodes,
    3,
  );
  assert.equal(s.document.aggregate.coverage.missing_or_uncertain_time, 1);
  assert.equal(s.document.aggregate.coverage.future_events, 1);
  assert.equal(
    s.document.aggregate.current_stock.factual_review_coverage,
    null,
  );
});
test("semantic duplicates and supporting representations never inflate review/acceptance counts", () => {
  const r = input(),
    a = event(1, "2026-10-03T12:00:00Z");
  r.events = [
    a,
    { ...a, source_key: h("second"), row_sha256: h("secondrow") },
    { ...event(2, a.occurred_at), canonical: false },
  ];
  const s = snapshot(r, options);
  assert.equal(
    s.document.aggregate.weekly.RESEARCH.by_type.fact_reviewed.episodes,
    1,
  );
  assert.equal(s.document.aggregate.coverage.semantic_duplicates, 1);
  assert.equal(s.document.aggregate.coverage.supporting_records, 1);
  assert.throws(
    () => normalize([a, { ...a, after_state: "DEFER" }]),
    /AMBIGUOUS/,
  );
});
test("DEFER, REOPEN, task deferral, carry-forward and affected dependencies have separate measures", () => {
  const r = input();
  r.events = [
    {
      ...event(1, "2026-10-03T12:00:00Z", "disposition_decision"),
      entity_type: "INCIDENT",
      after_state: "DEFER",
    },
    {
      ...event(2, "2026-10-03T12:00:00Z", "task_state_changed"),
      entity_type: "GAP_TASK",
      after_state: "DEFERRED",
    },
    event(3, "2026-10-03T12:00:00Z", "approval_carried_forward"),
    event(4, "2026-10-03T12:00:00Z", "dependency_invalidated"),
  ];
  const s = snapshot(r, options).document.aggregate.weekly.RESEARCH;
  assert.equal(s.incident_decisions.DEFER, 1);
  assert.equal(s.incident_decisions.REOPEN, 0);
  assert.equal(s.task_outcomes.RESOLVED, 0);
  assert.equal(s.task_outcomes.DEFERRED, 1);
  assert.equal(s.by_type.dependency_invalidated.episodes, 1);
});
test("late data restates immutably, preserves actual stock as-of and reproducible hashes", () => {
  const r = input(),
    first = snapshot(r, options);
  assert.equal(first.content_sha256, snapshot(r, options).content_sha256);
  r.state_as_of = "2026-10-10T04:00:00Z";
  r.events.push(event(1, "2026-10-03T12:00:00Z"));
  const next = snapshot(r, { ...options, previous: first });
  assert(verifySnapshot(next));
  assert.equal(next.document.manifest.supersedes_sha256, first.content_sha256);
  assert.equal(next.document.manifest.report_revision, 2);
  assert.equal(next.document.aggregate.coverage.exact_friday_stock, false);
  assert.equal(next.document.manifest.boundary_lag_seconds, 86400);
  assert(verifySnapshot(first));
  const bad = structuredClone(next);
  bad.document.aggregate.current_stock.CLAIM = 9;
  assert.throws(() => verifySnapshot(bad), /INTEGRITY/);
});
test("unknown origin and assistance are never classified as research or unassisted", () => {
  const r = input();
  r.events = [
    { ...event(1, "2026-10-03T12:00:00Z"), origin: "UNKNOWN" },
    {
      ...event(2, "2026-10-03T12:00:00Z"),
      origin: "SMOKE_OR_REHEARSAL",
      ledger_match: true,
    },
  ];
  const s = snapshot(r, options);
  assert.equal(
    s.document.aggregate.weekly.RESEARCH.by_type.fact_reviewed.episodes,
    0,
  );
  assert.equal(
    s.document.aggregate.weekly.UNKNOWN.by_type.fact_reviewed.episodes,
    1,
  );
  assert.equal(s.document.aggregate.coverage.excluded_records, 1);
  assert.equal(s.document.manifest.study_dates, "UNKNOWN");
});
test("privacy rejects extra identities/content/invalid labels, no person-level cohort", () => {
  for (const key of [
    "email",
    "name",
    "auth_uuid",
    "private_draft",
    "reason",
    "source_url",
    "query",
    "ip",
    "user_agent",
    "token",
  ]) {
    const r = input();
    r[key] = "sensitive";
    assert.throws(() => sanitizeExtract(r));
  }
  const r = input();
  r.events = [
    {
      ...event(1, "2026-10-03T12:00:00Z"),
      actor: "10000000-0000-4000-8000-000000000001",
    },
  ];
  assert.throws(() => sanitizeExtract(r));
  r.events = [
    {
      ...event(1, "2026-10-03T12:00:00Z"),
      versions: {
        application_commit: "private secret",
        corpus_sha256: "UNKNOWN",
        methodology_sha256: "UNKNOWN",
        scope_sha256: "UNKNOWN",
      },
    },
  ];
  assert.throws(() => sanitizeExtract(r));
  r.events = [{ ...event(1, "2026-10-03T12:00:00Z"), drift: true }];
  assert.throws(() => sanitizeExtract(r), /EXCLUSION_DRIFT/);
});
test("request-to-decision uses exact request endpoints, pending/censoring and no invented milestone", () => {
  const r = input();
  r.requests = [
    {
      request_key: h(1),
      created_at: "2026-10-03T12:00:00Z",
      resolved_at: "2026-10-04T12:00:00Z",
      status: "APPROVED",
      requested_action: "APPROVE",
    },
    {
      request_key: h(2),
      created_at: "2026-10-04T12:00:00Z",
      resolved_at: null,
      status: "PENDING",
      requested_action: "APPROVE",
    },
  ];
  const s = snapshot(r, options);
  assert.equal(s.document.aggregate.request_to_decision.median_seconds, 86400);
  assert.equal(s.document.aggregate.request_to_decision.pending, 1);
  assert(
    s.document.aggregate.coverage.not_measured.includes(
      "researcher_completion",
    ),
  );
});
test("record-level stock movement reconciles; evidenced scope changes break comparison", () => {
  const r = input();
  r.bindings = [
    {
      effective_at: "2026-10-01T00:00:00Z",
      application_commit: "a".repeat(40),
      corpus_sha256: h("corpus"),
      methodology_sha256: "UNKNOWN",
      scope_sha256: h("scope1"),
      authority_sha256: h("authority"),
    },
  ];
  r.states = [
    { entity_type: "SOURCE", entity_key: h("old"), revision: 1, flags: {} },
  ];
  const first = snapshot(r, options);
  r.state_as_of = "2026-10-16T04:00:00Z";
  r.states = [
    { entity_type: "SOURCE", entity_key: h("new"), revision: 1, flags: {} },
  ];
  r.bindings.push({
    ...r.bindings[0],
    effective_at: "2026-10-10T00:00:00Z",
    scope_sha256: h("scope2"),
  });
  const second = snapshot(r, { ...options, week: "2026-10-09" }),
    c = compareSnapshots(first, second).comparison;
  assert.equal(c.scope_comparability, "COMPARISON_BREAK");
  assert.deepEqual(c.changes.SOURCE, {
    beginning: 1,
    ending: 1,
    ids_appearing: 1,
    ids_disappearing: 1,
    retained_state_transfers: 0,
    reconciled: true,
  });
  assert.equal(c.productivity_inference, false);
});
