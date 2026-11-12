// Server/operator-only analytics. Never import into the client workspace bundle.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const extractorSha256 = sha256(readFileSync(new URL(import.meta.url)));
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",") +
    "}"
  );
}
const fail = () => {
  throw Error("ANALYTICS_PRIVACY_OR_CONTRACT_FAILURE");
};
const exact = (v, keys) => {
  if (
    !v ||
    Array.isArray(v) ||
    typeof v !== "object" ||
    Object.keys(v).some((k) => !keys.includes(k)) ||
    keys.some((k) => !(k in v))
  )
    fail();
};
const hash = (v) => {
  if (!/^[0-9a-f]{64}$/.test(v)) fail();
  return v;
};
const count = (v) => {
  if (!Number.isSafeInteger(v) || v < 0) fail();
  return v;
};
const instant = (v) => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    fail();
  return new Date(v).toISOString();
};
const enums = (v, allowed) => {
  if (!allowed.includes(v)) fail();
  return v;
};
const kinds = [
  "INCIDENT",
  "CLAIM",
  "FACILITY",
  "SOURCE",
  "CLAIM_SOURCE",
  "GAP_TASK",
  "FACT",
  "UNKNOWN",
];
const origins = [
  "UNKNOWN",
  "RESEARCH",
  "IMPORT",
  "HISTORICAL_PRESERVATION",
  "SMOKE_OR_REHEARSAL",
  "SYSTEM_PROPAGATION",
];
const types = [
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
  "supporting_record",
  "disposition_requested",
  "request_decided",
  "dependency_invalidated",
  "disposition_decision",
  "facility_identity_resolved",
  "facility_identity_reopened",
];
const states = [
  "UNKNOWN",
  "ACTIVE",
  "APPROVED",
  "DEFERRED",
  "APPROVE",
  "DEFER",
  "REOPEN",
  "DECLINE_REQUEST",
  "REQUEST_APPROVE",
  "REQUEST_DEFER",
  "NOT_ASSESSED",
  "RESOLVED",
  "UNABLE_TO_RESOLVE",
  "BLOCKED",
  "PENDING",
  "DECLINED",
  "STALE",
  "REVIEWED",
  "NOT_REVIEWED",
  "REOPENED",
  "SUPPORTED",
  "UNSUPPORTED",
  "CONFLICTING",
  "NEEDS_REAPPROVAL",
  "NOT_APPROVED",
  "preserved_unassessed",
  "needs_lab_validation",
  "in_progress",
  "research_lead",
  "review_complete",
  "supervisor_override",
  "reopened",
  "same",
  "different",
  "unsure",
  "PHYSICAL_IDENTITY",
  "FACILITY_TYPE",
  "INFORMATIONAL",
  "attack",
  "context",
  "unresolved",
];
const versionKeys = [
  "application_commit",
  "corpus_sha256",
  "methodology_sha256",
  "scope_sha256",
];
const unknownVersions = () =>
  Object.fromEntries(versionKeys.map((k) => [k, "UNKNOWN"]));
function versions(v) {
  if (v === null) return unknownVersions();
  exact(v, versionKeys);
  for (const k of versionKeys)
    if (
      v[k] !== "UNKNOWN" &&
      !(k === "application_commit" ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/).test(
        v[k],
      )
    )
      fail();
  return { ...v };
}
export function reportingWeek(localFriday) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localFriday)) fail();
  const day = new Date(localFriday + "T12:00:00Z");
  if (day.toISOString().slice(0, 10) !== localFriday || day.getUTCDay() !== 5)
    fail();
  const end = new Date(day);
  end.setUTCDate(end.getUTCDate() + 7);
  const boundary = (d) => {
    const date = d.toISOString().slice(0, 10);
    const zone = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(date + "T12:00:00Z"))
      .find((p) => p.type === "timeZoneName")
      .value.replace("GMT", "");
    return new Date(date + "T00:00:00" + zone).toISOString();
  };
  return {
    week_start_local: localFriday,
    week_end_local: end.toISOString().slice(0, 10),
    timezone: "America/New_York",
    window_start_utc: boundary(day),
    window_end_utc: boundary(end),
  };
}
export function sanitizeExtract(raw) {
  exact(raw, [
    "state_as_of",
    "events",
    "states",
    "cohort",
    "bindings",
    "corpus_import_digests",
    "historical_source_states",
    "mapping_authority",
    "requests",
  ]);
  const eventKeys = [
    "source_key",
    "row_sha256",
    "event_key",
    "event_type",
    "entity_type",
    "entity_key",
    "incident_key",
    "operation_key",
    "occurred_at",
    "time_precision",
    "date_label",
    "before_state",
    "after_state",
    "origin",
    "assistance_basis",
    "actor_role",
    "versions",
    "canonical",
    "ledger_match",
    "drift",
  ];
  const events = raw.events
    .map((e) => {
      exact(e, eventKeys);
      for (const k of ["source_key", "row_sha256", "event_key"]) hash(e[k]);
      for (const k of ["entity_key", "incident_key", "operation_key"])
        if (e[k] !== null) hash(e[k]);
      enums(e.event_type, types);
      enums(e.entity_type, kinds);
      enums(e.origin, origins);
      enums(e.actor_role, ["researcher", "supervisor", "UNKNOWN"]);
      enums(e.assistance_basis, ["UNKNOWN"]);
      enums(e.time_precision, ["INSTANT", "DATE_ONLY", "MISSING", "INVALID"]);
      if (e.date_label !== null && !/^\d{4}-\d{2}-\d{2}$/.test(e.date_label))
        fail();
      for (const k of ["canonical", "ledger_match", "drift"])
        if (typeof e[k] !== "boolean") fail();
      if (e.drift) throw Error("ANALYTICS_EXCLUSION_DRIFT");
      return {
        ...e,
        before_state: states.includes(e.before_state)
          ? e.before_state
          : "UNKNOWN",
        after_state: states.includes(e.after_state) ? e.after_state : "UNKNOWN",
        occurred_at: e.occurred_at === null ? null : instant(e.occurred_at),
        versions: versions(e.versions),
      };
    })
    .sort((a, b) => a.source_key.localeCompare(b.source_key));
  const entityStates = raw.states
    .map((s) => {
      exact(s, ["entity_type", "entity_key", "revision", "flags"]);
      enums(s.entity_type, kinds);
      hash(s.entity_key);
      count(s.revision);
      const flagKeys = {
        INCIDENT: [
          "workflow",
          "disposition",
          "eligible",
          "complete",
          "phase2",
          "classification",
        ],
        CLAIM: [
          "review",
          "valid_review",
          "eligible",
          "disposition",
          "validation",
          "requirement",
          "current",
          "value_unknown",
        ],
        GAP_TASK: ["state"],
      };
      exact(s.flags, flagKeys[s.entity_type] || []);
      for (const [k, v] of Object.entries(s.flags))
        if (
          [
            "eligible",
            "complete",
            "valid_review",
            "current",
            "value_unknown",
          ].includes(k)
        ) {
          if (typeof v !== "boolean") fail();
        } else enums(v, states);
      return s;
    })
    .sort((a, b) => a.entity_key.localeCompare(b.entity_key));
  exact(raw.cohort, [
    "weekly_research",
    "weekly_unknown",
    "cumulative_research",
    "cumulative_unknown",
    "active_at_capture",
    "historical_denominator",
  ]);
  for (const k of Object.keys(raw.cohort).filter(
    (k) => k !== "historical_denominator",
  ))
    count(raw.cohort[k]);
  enums(raw.cohort.historical_denominator, ["UNKNOWN"]);
  const bindings = raw.bindings
    .map((b) => {
      exact(b, ["effective_at", ...versionKeys, "authority_sha256"]);
      hash(b.authority_sha256);
      return {
        ...versions(Object.fromEntries(versionKeys.map((k) => [k, b[k]]))),
        authority_sha256: b.authority_sha256,
        effective_at: instant(b.effective_at),
      };
    })
    .sort((a, b) => a.effective_at.localeCompare(b.effective_at));
  const corpus = raw.corpus_import_digests.map(hash).sort();
  for (const [k, v] of Object.entries(raw.historical_source_states)) {
    enums(k, [
      "RESEARCH_COMPLETED",
      "IDENTITY_BLOCKED",
      "DEFERRED",
      "UNKNOWN",
      "COMPLETED",
    ]);
    count(v);
  }
  const mapping = raw.mapping_authority
    .map((m) => {
      exact(m, ["target_type", "authority", "n"]);
      enums(m.target_type, ["FACILITY", "INCIDENT", "CLAIM"]);
      enums(m.authority, [
        "APPROVED_EXISTING",
        "PROPOSED",
        "OWNER_APPROVED",
        "UNKNOWN",
      ]);
      count(m.n);
      return m;
    })
    .sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const requests = raw.requests
    .map((r) => {
      exact(r, [
        "request_key",
        "created_at",
        "resolved_at",
        "status",
        "requested_action",
      ]);
      hash(r.request_key);
      enums(r.status, [
        "PENDING",
        "APPROVED",
        "DEFERRED",
        "DECLINED",
        "STALE",
        "RESOLVED",
      ]);
      enums(r.requested_action, ["APPROVE", "DEFER"]);
      return {
        ...r,
        created_at: instant(r.created_at),
        resolved_at: r.resolved_at === null ? null : instant(r.resolved_at),
      };
    })
    .sort((a, b) => a.request_key.localeCompare(b.request_key));
  return {
    state_as_of: instant(raw.state_as_of),
    events,
    states: entityStates,
    cohort: { ...raw.cohort },
    bindings,
    corpus_import_digests: corpus,
    historical_source_states: { ...raw.historical_source_states },
    mapping_authority: mapping,
    requests,
  };
}
export function normalize(events) {
  const groups = new Map();
  let supporting = 0,
    duplicates = 0;
  for (const e of events) {
    if (!e.canonical || e.event_type === "supporting_record") {
      supporting++;
      continue;
    }
    const prior = groups.get(e.event_key);
    if (prior) {
      if (
        canonical({
          ...prior,
          source_key: null,
          row_sha256: null,
          ledger_match: null,
        }) !==
        canonical({
          ...e,
          source_key: null,
          row_sha256: null,
          ledger_match: null,
        })
      )
        throw Error("AMBIGUOUS_SEMANTIC_DUPLICATE");
      duplicates++;
    } else groups.set(e.event_key, e);
  }
  return {
    events: [...groups.values()].sort((a, b) =>
      a.event_key.localeCompare(b.event_key),
    ),
    supporting,
    duplicates,
  };
}
const unique = (values) => new Set(values.filter(Boolean)).size;
function flows(events) {
  const out = {};
  for (const origin of origins) {
    const ev = events.filter((e) => e.origin === origin);
    out[origin] = {
      incidents_touched: unique(
        ev
          .filter(
            (e) =>
              ![
                "dependency_invalidated",
                "approval_invalidated",
                "approval_carried_forward",
              ].includes(e.event_type),
          )
          .map((e) => e.incident_key),
      ),
      by_type: {},
    };
    for (const type of types.filter((t) => t !== "supporting_record")) {
      const t = ev.filter((e) => e.event_type === type);
      out[origin].by_type[type] = {
        episodes: t.length,
        entities: unique(t.map((e) => e.entity_key)),
      };
    }
    for (const kind of ["FACT", "INCIDENT"])
      out[origin][kind.toLowerCase() + "_decisions"] = Object.fromEntries(
        ["APPROVE", "DEFER", "REOPEN"].map((action) => [
          action,
          ev.filter(
            (e) =>
              e.event_type === "disposition_decision" &&
              e.entity_type === kind &&
              e.after_state === action,
          ).length,
        ]),
      );
    out[origin].task_outcomes = Object.fromEntries(
      ["RESOLVED", "DEFERRED", "UNABLE_TO_RESOLVE", "BLOCKED", "ACTIVE"].map(
        (s) => [
          s,
          ev.filter(
            (e) => e.event_type === "task_state_changed" && e.after_state === s,
          ).length,
        ],
      ),
    );
  }
  return out;
}
function stock(states) {
  const result = {};
  for (const type of kinds.filter((k) => k !== "FACT"))
    result[type] = states.filter((s) => s.entity_type === type).length;
  const incidents = states.filter((s) => s.entity_type === "INCIDENT"),
    facts = states.filter((s) => s.entity_type === "CLAIM" && s.flags.current);
  result.eligible_incidents = incidents.filter((s) => s.flags.eligible).length;
  result.complete_incidents = incidents.filter((s) => s.flags.complete).length;
  result.deferred_incidents = incidents.filter(
    (s) => s.flags.disposition === "DEFERRED",
  ).length;
  result.needs_reapproval = incidents.filter(
    (s) => s.flags.phase2 === "NEEDS_REAPPROVAL",
  ).length;
  result.current_facts = facts.length;
  result.active_pending_acceptance = incidents.filter(
    (s) => s.flags.disposition === "ACTIVE" && !s.flags.eligible,
  ).length;
  result.valid_reviewed_facts = facts.filter(
    (s) => s.flags.valid_review,
  ).length;
  result.waived_facts = facts.filter(
    (s) => s.flags.disposition === "DEFERRED",
  ).length;
  result.unknown_values = facts.filter((s) => s.flags.value_unknown).length;
  result.conflicting_facts = facts.filter(
    (s) => s.flags.validation === "CONFLICTING",
  ).length;
  result.eligibility_rate = result.INCIDENT
    ? result.eligible_incidents / result.INCIDENT
    : null;
  result.factual_review_coverage = result.current_facts
    ? result.valid_reviewed_facts / result.current_facts
    : null;
  return result;
}
export function snapshot(
  raw,
  {
    week,
    extractorCommit = "UNKNOWN",
    querySha256,
    metricSha256,
    previous = null,
  },
) {
  const input = sanitizeExtract(raw),
    window = reportingWeek(week),
    asOf = input.state_as_of;
  if (extractorCommit !== "UNKNOWN" && !/^[0-9a-f]{40}$/.test(extractorCommit))
    fail();
  hash(querySha256);
  hash(metricSha256);
  const n = normalize(input.events),
    events = n.events.filter((e) => !e.occurred_at || e.occurred_at <= asOf),
    weekly = events.filter(
      (e) =>
        e.occurred_at &&
        e.occurred_at >= window.window_start_utc &&
        e.occurred_at < window.window_end_utc,
    );
  if (previous) {
    verifySnapshot(previous);
    if (previous.document.manifest.week_start_local !== week) fail();
  }
  const version =
    input.bindings.filter((b) => b.effective_at <= asOf).at(-1) ||
    unknownVersions();
  const cohort = {
    ...input.cohort,
    weekly_denominator:
      asOf === window.window_end_utc ? input.cohort.active_at_capture : null,
    adoption_rate: null,
  };
  const resolved = input.requests.filter(
    (r) =>
      r.requested_action === "APPROVE" &&
      r.resolved_at &&
      r.resolved_at >= window.window_start_utc &&
      r.resolved_at < window.window_end_utc &&
      r.resolved_at <= asOf,
  );
  const durations = resolved
    .filter((r) => r.resolved_at >= r.created_at)
    .map((r) => (Date.parse(r.resolved_at) - Date.parse(r.created_at)) / 1000)
    .sort((a, b) => a - b);
  const manifest = {
    schema_version: 1,
    normalization_version: 1,
    metric_definition_sha256: metricSha256,
    query_sha256: querySha256,
    extractor_commit: extractorCommit,
    extractor_sha256: extractorSha256,
    ...window,
    captured_at_utc: asOf,
    state_as_of_utc: asOf,
    boundary_lag_seconds:
      (Date.parse(asOf) - Date.parse(window.window_end_utc)) / 1000,
    status: previous ? "RESTATED" : "PARTIAL",
    report_revision: previous
      ? previous.document.manifest.report_revision + 1
      : 1,
    supersedes_sha256: previous?.content_sha256 || null,
    bindings: version,
    coverage: "PARTIAL_EXISTING_HISTORY_AND_ACTUAL_CAPTURE",
    policy: "OWNER_AMENDMENT_008",
    study_dates: "UNKNOWN",
    methodology_scope_retroactive_assignment: false,
  };
  const aggregate = {
    weekly: flows(weekly),
    cumulative: flows(events),
    current_stock: stock(input.states),
    cohort,
    request_to_decision: {
      n: durations.length,
      median_seconds: durations.length
        ? (durations[Math.floor((durations.length - 1) / 2)] +
            durations[Math.ceil((durations.length - 1) / 2)]) /
          2
        : null,
      min_seconds: durations[0] ?? null,
      max_seconds: durations.at(-1) ?? null,
      pending: input.requests.filter(
        (r) => r.requested_action === "APPROVE" && r.status === "PENDING",
      ).length,
      declined: resolved.filter((r) => r.status === "DECLINED").length,
      stale: input.requests.filter((r) => r.status === "STALE").length,
      invalid_duration: resolved.length - durations.length,
    },
    historical_source_states: input.historical_source_states,
    mapping_authority: input.mapping_authority,
    corpus_import_digests: input.corpus_import_digests,
    coverage: {
      supporting_records: n.supporting,
      semantic_duplicates: n.duplicates,
      missing_or_uncertain_time: events.filter((e) => !e.occurred_at).length,
      future_events: n.events.filter((e) => e.occurred_at > asOf).length,
      excluded_records: input.events.filter((e) => e.ledger_match).length,
      exact_friday_stock: asOf === window.window_end_utc,
      source_creation_historical_coverage: "PARTIAL",
      historical_roster: "UNKNOWN",
      historical_origin: "PARTIAL_UNKNOWN",
      assistance: "UNKNOWN",
      scope_comparison: "UNKNOWN",
      backlog_change: null,
      net_growth: null,
      not_measured: [
        "views",
        "logins",
        "sessions",
        "labor_time",
        "researcher_completion",
        "AI_causal_gain",
        "learning",
      ],
    },
  };
  const document = { manifest, aggregate, inputs: input };
  const canonical_text = canonical(document);
  return { content_sha256: sha256(canonical_text), canonical_text, document };
}
export function verifySnapshot(value) {
  exact(value, ["content_sha256", "canonical_text", "document"]);
  hash(value.content_sha256);
  if (
    sha256(value.canonical_text) !== value.content_sha256 ||
    canonical(value.document) !== value.canonical_text
  )
    throw Error("SNAPSHOT_INTEGRITY_FAILURE");
  exact(value.document, ["manifest", "aggregate", "inputs"]);
  sanitizeExtract(value.document.inputs);
  const m = value.document.manifest;
  const rebuilt = snapshot(value.document.inputs, {
    week: m.week_start_local,
    extractorCommit: m.extractor_commit,
    querySha256: m.query_sha256,
    metricSha256: m.metric_definition_sha256,
  });
  const expected = {
    ...rebuilt.document,
    manifest: {
      ...rebuilt.document.manifest,
      status: m.status,
      report_revision: m.report_revision,
      supersedes_sha256: m.supersedes_sha256,
    },
  };
  if (canonical(expected) !== value.canonical_text)
    throw Error("SNAPSHOT_RECOMPUTATION_FAILURE");
  if (
    m.report_revision === 1
      ? m.status !== "PARTIAL" || m.supersedes_sha256 !== null
      : !Number.isSafeInteger(m.report_revision) ||
        m.report_revision < 2 ||
        m.status !== "RESTATED" ||
        !/^[0-9a-f]{64}$/.test(m.supersedes_sha256)
  )
    fail();
  return true;
}
export function compareSnapshots(before, after) {
  verifySnapshot(before);
  verifySnapshot(after);
  const a = before.document,
    b = after.document;
  if (a.manifest.state_as_of_utc >= b.manifest.state_as_of_utc)
    throw Error("COMPARISON_REQUIRES_ORDERED_ACTUAL_CAPTURES");
  const scopeA = a.manifest.bindings.scope_sha256,
    scopeB = b.manifest.bindings.scope_sha256;
  const comparable =
    scopeA === "UNKNOWN" || scopeB === "UNKNOWN"
      ? "UNKNOWN"
      : scopeA === scopeB
        ? "SAME_SCOPE"
        : "COMPARISON_BREAK";
  const kinds = [
    ...new Set(
      [...a.inputs.states, ...b.inputs.states].map((s) => s.entity_type),
    ),
  ].sort();
  const changes = Object.fromEntries(
    kinds.map((k) => {
      const old = a.inputs.states.filter((s) => s.entity_type === k),
        next = b.inputs.states.filter((s) => s.entity_type === k),
        oldIDs = new Set(old.map((s) => s.entity_key)),
        newIDs = new Set(next.map((s) => s.entity_key));
      const entered = next.filter((s) => !oldIDs.has(s.entity_key)).length,
        exited = old.filter((s) => !newIDs.has(s.entity_key)).length;
      const flags = new Map(old.map((s) => [s.entity_key, canonical(s.flags)]));
      return [
        k,
        {
          beginning: old.length,
          ending: next.length,
          ids_appearing: entered,
          ids_disappearing: exited,
          retained_state_transfers: next.filter(
            (s) =>
              oldIDs.has(s.entity_key) &&
              flags.get(s.entity_key) !== canonical(s.flags),
          ).length,
          reconciled: next.length === old.length + entered - exited,
        },
      ];
    }),
  );
  const value = {
    before_sha256: before.content_sha256,
    after_sha256: after.content_sha256,
    scope_comparability: comparable,
    as_of_start: a.manifest.state_as_of_utc,
    as_of_end: b.manifest.state_as_of_utc,
    changes,
    productivity_inference: false,
  };
  return { comparison: value, content_sha256: sha256(canonical(value)) };
}
