import { createHash } from "node:crypto";
import { outputAuthorized, factWaived } from "./acceptance-policy.js";
import {
  reviewed,
  facilityReadiness,
  recordType,
  factLabel,
} from "../../../apps/web/src/approved/shared.js";
import { evidenceEntries, relationship } from "../../../apps/web/src/approved/evidence-presentation.js";
import { reviewedGeographicAuthority } from "./facility-geography.mjs";

export const GIS_SCHEMA_VERSION = "1.2.0";
/** @typedef {{facility_id:string,source_record_ids:string[],latitude:number,longitude:number,crs:string,source_id:string,authority_artifact:string,authority_sha256:string,method:string,limitations:string,accepted_working_coordinate:boolean}} GISAuthority */
export const GIS_BASE_COLUMNS = [
  "date_display",
  "facility_name",
  "facility_type",
  "locality",
  "governorate",
  "incident_classification",
  "feature_id",
  "facility_id",
  "incident_id",
  "Latitude",
  "Longitude",
  "date_start",
  "date_end",
  "date_precision",
  "event_label",
  "incident_url",
];
export const GIS_PROFILE = {
  max_columns: 1000,
  max_text_bytes: 512,
  chunk_prefix: "text:",
  coordinate_system: "EPSG:4326",
  date_encoding: "YYYY-MM-DD calendar date; no timezone",
};
const rows = (s, k) => s.records?.[k] ?? [];
const by = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]), "en");
const stable = (x) =>
  Array.isArray(x)
    ? x.map(stable)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, stable(x[k])]),
        )
      : x;
export const canonicalJSON = (x) => JSON.stringify(stable(x));
export const checksum = (x) => createHash("sha256").update(x).digest("hex");
export class GISIntegrityError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const requireIntegrity = (v, code) => {
  if (!v) throw new GISIntegrityError(code);
};
const known = (v) => v !== null && v !== undefined && v !== "";
const safePublicURL = (v) => {
  try {
    const u = new URL(v);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? v
      : null;
  } catch {
    return null;
  }
};
const pick = (o, keys) =>
  Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));
function unique(list, key) {
  const map = new Map();
  for (const item of list) {
    requireIntegrity(
      typeof item[key] === "string" && item[key],
      "GIS_MISSING_IDENTIFIER",
    );
    requireIntegrity(!map.has(item[key]), "GIS_DUPLICATE_IDENTIFIER");
    map.set(item[key], item);
  }
  return map;
}
export function factEligible(s, c, incidentId = c.incident_id) {
  return (
    c.is_current !== false &&
    c.identity_purpose !== "facility_comparison" &&
    reviewed(c, s) &&
    c.validation_state === "SUPPORTED" &&
    known(c.current_verified_value) &&
    (s.dispositions?.facts?.[c.claim_id]?.state ?? "ACTIVE") !== "DEFERRED" &&
    !factWaived(s, c.claim_id, incidentId)
  );
}
const day = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number(v.slice(0, 4)) >= 1 &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
function chronology(facts) {
  const dates = facts.filter(
    (c) =>
      c.claim_family === "EVENT_DATE" && c.validation_state === "SUPPORTED",
  );
  const parsed = dates.map((c) => {
    const v = c.current_verified_value;
    if (c.date_precision === "DAY") {
      requireIntegrity(day(v), "GIS_INVALID_CALENDAR_DATE");
      return { start: v, end: v, precision: "DAY" };
    }
    if (c.date_precision === "RANGE") {
      requireIntegrity(
        v && day(v.start) && day(v.end) && v.start <= v.end,
        "GIS_INVALID_CALENDAR_DATE",
      );
      return {
        start: v.start,
        end: v.end,
        precision: v.start === v.end ? "DAY" : "RANGE",
      };
    }
    return null;
  });
  if (!parsed.length || parsed.some((v) => !v))
    return {
      start: "",
      end: "",
      precision: "UNKNOWN",
      display: "Event date not established by validated day/range evidence",
      reason: "MISSING_OR_UNVALIDATED_EVENT_DATE",
    };
  const distinct = [...new Set(parsed.map((c) => canonicalJSON(c)))];
  if (distinct.length !== 1)
    return {
      start: "",
      end: "",
      precision: "UNKNOWN",
      display: "Validated date findings require chronology reconciliation",
      reason: "CONFLICTING_EVENT_DATES",
    };
  const p = parsed[0];
  return {
    ...p,
    display: p.start === p.end ? p.start : `${p.start} – ${p.end}`,
    reason: null,
  };
}
function geometry(s, f, authorities, incidentId) {
  const ready = facilityReadiness(s, f.facility_id);
  if (!ready.identity_ready || !ready.type_ready)
    return { reason: "FACILITY_IDENTITY_OR_TYPE_NOT_VERIFIED" };
  // Completion can waive a research requirement without certifying its value.
  // Preserve existing conflict checks, then require an unwaived GIS-eligible
  // basis for the identity and type actually used in this incident's point.
  const eligibleBasis = rows(s, "CLAIM").filter(
    (c) =>
      c.facility_id === f.facility_id &&
      ["IDENTITY", "FACILITY_TYPE"].includes(c.claim_family) &&
      factEligible(s, c, incidentId),
  );
  const verified = facilityReadiness(
    { ...s, records: { ...s.records, CLAIM: eligibleBasis } },
    f.facility_id,
  );
  if (!verified.identity_ready || !verified.type_ready)
    return { reason: "FACILITY_IDENTITY_OR_TYPE_NOT_GIS_ELIGIBLE" };
  const r = f.location_review,
    w =
      s.workflow?.facility_reviews?.[f.facility_id] ??
      s.workflow?.facilities?.[f.facility_id];
  if (
    !r ||
    r.state !== "SUPPORTED" ||
    w?.lab_location_review_state !== "REVIEWED" ||
    !w.lab_location_reviewed_by ||
    !w.lab_location_reviewed_at ||
    w.lab_location_reviewed_facility_revision !==
      s.revisions?.FACILITY?.[f.facility_id]
  )
    return { reason: "LOCATION_REVIEW_NOT_CURRENT" };
  const p = r.coordinates;
  if (
    !p ||
    !Number.isFinite(p.latitude) ||
    !Number.isFinite(p.longitude) ||
    Math.abs(p.latitude) > 90 ||
    Math.abs(p.longitude) > 180 ||
    (p.latitude === 0 && p.longitude === 0)
  )
    return { reason: "GEOMETRY_MISSING_OR_INVALID" };
  const currentAuthority = reviewedGeographicAuthority(s, f);
  if (r.geographic_review && !currentAuthority)
    return { reason: "CURRENT_GEOGRAPHIC_AUTHORITY_NOT_VERIFIED" };
  const candidates = currentAuthority ? [currentAuthority] : authorities.filter((a) => a.facility_id === f.facility_id);
  if (candidates.length !== 1)
    return { reason: "COORDINATE_AUTHORITY_UNRESOLVED" };
  const a = candidates[0];
  const sourceRecordIds = [
    ...new Set(
      (f.authoritative_source_records ?? [])
        .filter(
          (x) => x.relationship === "PRIMARY_RECORD_FOR_PHYSICAL_FACILITY",
        )
        .map((x) => x.source_record_id),
    ),
  ].sort();
  if (
    !Array.isArray(a.source_record_ids) ||
    canonicalJSON(sourceRecordIds) !==
      canonicalJSON([...a.source_record_ids].sort())
  )
    return { reason: "FACILITY_SOURCE_IDENTITY_MISMATCH" };
  if (
    r.relation?.support_direction !== "SUPPORTS" ||
    !r.authority_artifact ||
    !r.basis
  )
    return { reason: "LOCATION_EVIDENCE_NOT_ESTABLISHED" };
  if (
    !a.accepted_working_coordinate ||
    a.crs !== "EPSG:4326" ||
    (!currentAuthority && !a.source_record_ids?.length) ||
    !a.authority_artifact ||
    !/^[a-f0-9]{64}$/.test(a.authority_sha256 ?? "") ||
    a.latitude !== p.latitude ||
    a.longitude !== p.longitude ||
    a.source_id !== r.source_id ||
    !rows(s, "SOURCE").some((x) => x.source_id === r.source_id)
  )
    return { reason: "COORDINATE_AUTHORITY_MISMATCH" };
  // Never silently revert an explicit newer correction or use names as an identity join.
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    facility_type: ready.facility_type,
    authority: a,
    review_basis: r.basis ?? null,
    review_limitations: r.limitations ?? null,
  };
}
function factProjection(s, c, sourceMap) {
  const relations = rows(s, "CLAIM_SOURCE")
    .filter((l) => l.claim_id === c.claim_id && l.is_current !== false)
    .sort(by("claim_source_id"));
  const citations = relations.map((l) => {
    const source = sourceMap.get(l.source_id);
    requireIntegrity(source, "GIS_DANGLING_SOURCE");
    for (const recordedURL of [source.original_url, source.canonical_url]) {
      let parsed;
      try {
        parsed = new URL(recordedURL);
      } catch {
        // Historical malformed citations remain explicit data-quality gaps.
      }
      requireIntegrity(
        !parsed?.username && !parsed?.password,
        "GIS_CREDENTIAL_BEARING_SOURCE_URL",
      );
    }
    requireIntegrity(
      ["SUPPORTS", "CONTRADICTS", "LIMITS", "CONTEXT_ONLY"].includes(
        l.support_direction,
      ),
      "GIS_UNKNOWN_EVIDENCE_RELATIONSHIP",
    );
    const publicURL =
      safePublicURL(source.canonical_url) || safePublicURL(source.original_url);
    const entries = evidenceEntries(s, source, l).map((e) =>
      pick(e, ["text", "label", "ref"]),
    );
    return {
      ...pick(l, [
        "claim_source_id",
        "claim_id",
        "source_id",
        "support_direction",
        "directness",
        "originality",
        "dependency_group_id",
        "dependency_provenance",
        "evidence_locator",
        "limitations",
      ]),
      source: pick(source, [
        "source_id",
        "source_type",
        "title",
        "publisher_platform",
        "original_url",
        "canonical_url",
        "publication_date",
        "retrieval_body_status",
        "content_preservation_status",
        "evidence_locator",
        "limitations",
      ]),
      public_url: publicURL,
      url_status: publicURL
        ? "RECORDED_URL_NOT_LIVE_CHECKED"
        : "NO_SAFE_PUBLIC_URL_RECORDED",
      passages: entries,
      citation_gaps: [
        ...(!publicURL ? ["PUBLIC_URL_UNAVAILABLE_OR_INVALID"] : []),
        ...(!entries.length ? ["PASSAGE_NOT_RECORDED"] : []),
      ],
      independence:
        "Source links do not establish independent corroboration; preserve the recorded dependency fields.",
    };
  });
  return {
    ...pick(c, [
      "claim_id",
      "incident_id",
      "facility_id",
      "claim_family",
      "subject",
      "value_type",
      "date_precision",
      "quantitative_unit",
      "impact_basis",
      "scope",
      "attack_claim_id",
      "effect_claim_id",
    ]),
    label: factLabel(c),
    value: c.current_verified_value,
    evidence_state: c.validation_state,
    revision: s.revisions.CLAIM[c.claim_id],
    citations,
  };
}
function narrative(feature) {
  const describe = (v) =>
    typeof v === "object" ? canonicalJSON(v) : String(v);
  return (
    `${feature.date_display}\n${feature.facility_name} · ${feature.facility_type}\n${feature.incident_classification}\n` +
    feature.facts
      .map(
        (f) =>
          `${f.label} — ${f.subject}: ${describe(f.value)}${f.quantitative_unit ? " " + f.quantitative_unit : ""} [${f.evidence_state}]\n` +
          (f.citations.length
            ? f.citations
                .map(
                  (c) =>
                    `  ${relationship(c.support_direction)[0]} [${c.support_direction}]: ${c.source.title || c.source_id} — ${c.source.publisher_platform || "Publisher not recorded"}; Source type: ${c.source.source_type || "UNKNOWN"}${c.source.content_preservation_status?.source_description ? "; Recorded source description: " + c.source.content_preservation_status.source_description : ""}; ${describe(c.source.publication_date ?? "Date not recorded")}; ${c.public_url || "No safe public URL"}\n${c.passages.map((p) => `    ${p.label || "Recorded passage / observation"}: ${p.text}`).join("\n")}${c.limitations ? `\n    Relationship limitations: ${describe(c.limitations)}` : ""}${c.source.limitations ? `\n    Source limitations: ${describe(c.source.limitations)}` : ""}\n    Access as recorded: ${c.source.retrieval_body_status || "UNKNOWN"}. Independence is not inferred.`,
                )
                .join("\n")
            : "  No source relationship recorded; citation gap retained."),
      )
      .join("\n")
  );
}
export function splitGISChunks(text) {
  const chunks = [];
  let start = 0,
    offset = 0,
    size = 5;
  while (offset < text.length) {
    const point = text.codePointAt(offset);
    const units = point > 0xffff ? 2 : 1;
    // Lone surrogates use the same three UTF-8 bytes as Buffer.byteLength.
    const bytes = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (size + bytes > GIS_PROFILE.max_text_bytes) {
      // Slice once per field instead of retaining a rope node per character.
      chunks.push("text:" + text.slice(start, offset));
      start = offset;
      size = 5;
    }
    offset += units;
    size += bytes;
  }
  if (offset > start || !chunks.length)
    chunks.push("text:" + text.slice(start, offset));
  return chunks;
}
export function gisCell(value) {
  let v = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[\s\uFEFF]*[=+@\-\t\r\n']/.test(v))
    v = "'" + v;
  return '"' + v.replaceAll('"', '""') + '"';
}
/** @param {object} s @param {{mode?:string,origin?:string,appCommit?:string,snapshotVersion?:string,authorities?:GISAuthority[],deadline?:number}} options */
export function buildGISExport(
  s,
  { mode = "full", origin, appCommit, snapshotVersion, authorities = [], deadline = Infinity } = {},
) {
  requireIntegrity(["full", "simplified"].includes(mode), "GIS_INVALID_MODE");
  requireIntegrity(
    s.profile?.active && ["researcher", "supervisor"].includes(s.profile.role),
    "GIS_ACCESS_DENIED",
  );
  requireIntegrity(
    /^[a-f0-9]{40}$/.test(appCommit ?? ""),
    "GIS_SOURCE_BINDING_REQUIRED",
  );
  requireIntegrity(
    typeof snapshotVersion === "string" && snapshotVersion.length > 0,
    "GIS_SNAPSHOT_BINDING_REQUIRED",
  );
  const site = new URL(origin);
  requireIntegrity(
    ["https:", "http:"].includes(site.protocol) &&
      !site.username &&
      !site.password &&
      site.pathname === "/" &&
      !site.search &&
      !site.hash,
    "GIS_INVALID_ORIGIN",
  );
  const facilities = unique(rows(s, "FACILITY"), "facility_id"),
    sources = unique(rows(s, "SOURCE"), "source_id");
  unique(rows(s, "INCIDENT"), "incident_id");
  unique(rows(s, "CLAIM"), "claim_id");
  unique(rows(s, "CLAIM_SOURCE"), "claim_source_id");
  unique(rows(s, "INCIDENT_FACILITY"), "incident_facility_id");
  const eligible = rows(s, "INCIDENT")
    .filter((i) => outputAuthorized(s, i.incident_id))
    .sort(by("incident_id"));
  const exclusions = [],
    features = [],
    factExclusions = [],
    seen = new Set();
  for (const incident of eligible) {
    requireIntegrity(Date.now() < deadline, "GIS_EXPORT_TIME_BUDGET");
    const id = incident.incident_id,
      classification = recordType(s, id);
    const links = rows(s, "INCIDENT_FACILITY")
      .filter((l) => l.incident_id === id && l.is_current !== false)
      .sort(by("facility_id"));
    if (!links.length)
      exclusions.push({
        incident_id: id,
        facility_id: null,
        category: "validation",
        reason: "NO_CURRENT_FACILITY_ASSOCIATION",
      });
    for (const link of links) {
      const fid = link.facility_id,
        featureId = canonicalJSON([fid, id]);
      requireIntegrity(!seen.has(featureId), "GIS_DUPLICATE_FACILITY_INCIDENT");
      seen.add(featureId);
      const f = facilities.get(fid);
      requireIntegrity(f, "GIS_DANGLING_FACILITY");
      const reject = (category, reason) =>
        exclusions.push({
          incident_id: id,
          facility_id: fid,
          category,
          reason,
        });
      if (link.facility_match_state !== "supported") {
        reject("validation", "FACILITY_INCIDENT_ASSOCIATION_UNRESOLVED");
        continue;
      }
      if (classification.group !== "attack") {
        reject("validation", "CONTEXT_OR_UNRESOLVED_RECORD");
        continue;
      }
      const geo = geometry(s, f, authorities, id);
      if (geo.reason) {
        reject("geometry", geo.reason);
        continue;
      }
      const candidates = rows(s, "CLAIM").filter(
        (c) =>
          c.is_current !== false &&
          ((c.facility_id === fid &&
            (c.incident_id === id ||
              ["IDENTITY", "FACILITY_TYPE"].includes(c.claim_family))) ||
            (!c.facility_id && c.incident_id === id)),
      );
      const facts = candidates.filter((c) => factEligible(s, c, id));
      factExclusions.push(
        ...candidates
          .filter((c) => !factEligible(s, c, id))
          .map((c) => ({
            feature_id: featureId,
            claim_id: c.claim_id,
            reason: "NOT_CURRENT_VALIDATED_FINDING",
          })),
      );
      const supported = (c) =>
        c.facility_id === fid &&
        c.validation_state === "SUPPORTED" &&
        rows(s, "CLAIM_SOURCE").some(
          (l) =>
            l.claim_id === c.claim_id &&
            l.support_direction === "SUPPORTS" &&
            l.is_current !== false,
        );
      const attack =
        facts.some(
          (c) =>
            supported(c) &&
            c.claim_family === "ATTACK_RELATIONSHIP" &&
            c.current_verified_value === "EXACT_TARGET",
        ) ||
        facts.some(
          (c) =>
            supported(c) &&
            c.claim_family === "ATTACK_TO_EFFECT_CAUSATION" &&
            c.current_verified_value === true &&
            facts.some(
              (a) =>
                a.claim_id === c.attack_claim_id &&
                supported(a) &&
                a.claim_family === "KINETIC_EVENT" &&
                a.current_verified_value === true,
            ) &&
            facts.some(
              (e) =>
                e.claim_id === c.effect_claim_id &&
                supported(e) &&
                [
                  "PHYSICAL_DAMAGE",
                  "FULL_CLOSURE",
                  "PARTIAL_CLOSURE",
                  "DEPARTMENT_OR_SERVICE_SHUTDOWN",
                  "REDUCED_CAPACITY",
                  "EVACUATION",
                  "PATIENT_TRANSFER",
                  "UTILITY_LOSS",
                  "ACCESS_DISRUPTION",
                  "RELOCATION",
                ].includes(e.claim_family) &&
                e.current_verified_value !== false &&
                e.current_verified_value !== 0,
            ),
        );
      if (!attack) {
        reject("validation", "NO_VALIDATED_FACILITY_ATTACK_FINDING");
        continue;
      }
      const dateFacts = facts.filter(
        (c) =>
          c.claim_family !== "EVENT_DATE" ||
          rows(s, "CLAIM_SOURCE").some(
            (l) =>
              l.claim_id === c.claim_id &&
              l.support_direction === "SUPPORTS" &&
              l.is_current !== false,
          ),
      );
      let date;
      try {
        date = chronology(dateFacts);
      } catch {
        throw new GISIntegrityError("GIS_INVALID_CALENDAR_DATE");
      }
      if (mode === "simplified" && date.reason) {
        reject("date", date.reason);
        continue;
      }
      const place = f.locality_governorate;
      const feature = {
        date_display: date.display,
        facility_name: f.canonical_name,
        facility_type: geo.facility_type,
        locality:
          typeof place === "object"
            ? (place?.locality ?? place?.adm3_name ?? f.locality ?? "")
            : (place ?? f.locality ?? ""),
        governorate:
          typeof place === "object"
            ? (place?.governorate ?? place?.adm1_name ?? place?.region ?? "")
            : "",
        incident_classification: classification.canonical,
        feature_id: featureId,
        facility_id: fid,
        incident_id: id,
        Latitude: geo.latitude,
        Longitude: geo.longitude,
        date_start: date.start,
        date_end: date.end,
        date_precision: date.precision,
        event_label: classification.label,
        incident_url: site.origin + "/cases/" + encodeURIComponent(id),
        location_provenance: geo.authority.source_record_ids.join("; ") || "Human-reviewed manual facility point; no HDX match asserted",
        location_limitations:
          "Full coordinate provenance and limitations are preserved in evidence columns.",
        facts: facts
          .sort(by("claim_id"))
          .map((c) => factProjection(s, c, sources)),
        location_authority: geo.authority,
        location_review_basis: geo.review_basis,
        location_review_limitations: geo.review_limitations,
        date_limitation: date.reason,
      };
      requireIntegrity(
        typeof feature.facility_name === "string" &&
          feature.facility_name.trim(),
        "GIS_FACILITY_NAME_MISSING",
      );
      features.push(feature);
    }
  }
  features.sort(
    (a, b) =>
      a.facility_id.localeCompare(b.facility_id, "en") ||
      a.incident_id.localeCompare(b.incident_id, "en"),
  );
  const table = features.map((f) => {
    const row = Object.fromEntries(GIS_BASE_COLUMNS.map((k) => [k, f[k]]));
    if (mode === "simplified") row.source_types = [...new Set(f.facts.flatMap(fact => fact.citations.map(c => c.source.source_type || "UNKNOWN")))].sort().join("; ") || "UNKNOWN";
    if (mode === "full") {
      Object.assign(row, {
        location_provenance: f.location_provenance,
        location_limitations: f.location_limitations,
        fact_count: f.facts.length,
      });
      for (const [prefix, text] of [
        ["findings", narrative(f)],
        [
          "evidence",
          canonicalJSON({
            feature_id: f.feature_id,
            date_limitation: f.date_limitation,
            location_authority: f.location_authority,
            location_review_basis: f.location_review_basis,
            location_review_limitations: f.location_review_limitations,
            facts: f.facts,
          }),
        ],
      ]) {
        splitGISChunks(text).forEach((part, i) => {
          row[prefix + "_" + String(i + 1).padStart(3, "0")] = part;
        });
      }
    }
    return row;
  });
  const dynamic = [
    ...new Set(
      table.flatMap((r) =>
        Object.keys(r).filter((k) => /^(findings|evidence)_\d+$/.test(k)),
      ),
    ),
  ].sort((a, b) =>
    a.startsWith("findings") && !b.startsWith("findings")
      ? -1
      : !a.startsWith("findings") && b.startsWith("findings")
        ? 1
        : a.localeCompare(b, "en"),
  );
  const columns = [
    ...GIS_BASE_COLUMNS,
    ...(mode === "full"
      ? [
          "location_provenance",
          "location_limitations",
          "fact_count",
          ...dynamic,
        ]
      : ["source_types"]),
  ];
  requireIntegrity(
    columns.length <= GIS_PROFILE.max_columns,
    "GIS_ARCGIS_FIELD_LIMIT_EXCEEDED",
  );
  for (const row of table)
    for (const v of Object.values(row)) {
      requireIntegrity(
        typeof v !== "string" ||
          (!v.includes("\0") &&
            !/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(v)),
        "GIS_UNSUPPORTED_CONTROL_CHARACTER",
      );
      requireIntegrity(
        typeof v !== "string" ||
          Buffer.byteLength(gisCell(v).slice(1, -1).replaceAll('""', '"')) <=
            GIS_PROFILE.max_text_bytes,
        "GIS_ARCGIS_TEXT_FIELD_TOO_LONG",
      );
    }
  const csv = features.length
    ? "\uFEFF" +
      [
        columns.map(gisCell).join(","),
        ...table.map((r) => columns.map((k) => gisCell(r[k])).join(",")),
      ].join("\r\n") +
      "\r\n"
    : null;
  const summary = {
    eligible_incidents_considered: eligible.length,
    facility_incident_features_exported: features.length,
    features_excluded_geometry: exclusions.filter(
      (x) => x.category === "geometry",
    ).length,
    features_excluded_date: exclusions.filter((x) => x.category === "date")
      .length,
    features_excluded_other: exclusions.filter(
      (x) => x.category === "validation",
    ).length,
    excluded_facts: factExclusions.length,
    undated_full_features: features.filter((f) => f.date_limitation).length,
    direct_file_mapping: {
      public_account_feature_limit: 250,
      public_account_within_feature_limit: features.length <= 250,
      organizational_account_feature_limit: 4000,
      organizational_account_within_feature_limit: features.length <= 4000,
      rows_truncated_or_split: false,
    },
    exclusions,
    fact_exclusions: factExclusions,
    empty_reason: !eligible.length
      ? "No incidents are currently approved for validated output."
      : !features.length
        ? "No approved facility-incident meets the geographic, factual and date requirements for this export."
        : null,
  };
  const receipt = {
    schema_version: GIS_SCHEMA_VERSION,
    mode,
    app_commit: appCommit,
    snapshot_version: snapshotVersion,
    geography_authority_sha256: checksum(canonicalJSON(authorities)),
    included_geography_authority_sha256: checksum(canonicalJSON(features.map(f => f.location_authority))),
    row_count: features.length,
    feature_ids: features.map((f) => f.feature_id),
    included_fact_ids: features.map((f) => ({
      feature_id: f.feature_id,
      claim_ids: f.facts.map((c) => c.claim_id),
    })),
    content_sha256: csv ? checksum(csv) : null,
    content_length_bytes: csv ? Buffer.byteLength(csv, "utf8") : 0,
    semantic_sha256: checksum(canonicalJSON(features)),
    columns,
    column_types: Object.fromEntries(
      columns.map((k) => [
        k,
        ["Latitude", "Longitude"].includes(k)
          ? "Double"
          : k === "fact_count"
            ? "Integer"
            : ["date_start", "date_end"].includes(k)
              ? "Date Only"
              : "String",
      ]),
    ),
    text_profile: GIS_PROFILE,
    summary,
  };
  return {
    csv,
    features,
    summary,
    receipt,
    filename: `validated-gis-${mode}-${receipt.content_sha256?.slice(0, 12) ?? "empty"}.csv`,
  };
}
