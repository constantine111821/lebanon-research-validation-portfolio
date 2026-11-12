export function records() {
  const data = {
    facility: [],
    incident: [],
    incident_facility: [],
    claim: [],
    source: [],
    claim_source: [],
  };
  for (const code of ["MAIN", "OTHER", "SHARED"]) {
    const iid = "I-SYN019-" + code,
      fid = "F-SYN019-" + code;
    data.facility.push({
      facility_id: fid,
      canonical_name: "Synthetic019 " + code + " Facility",
      aliases: [{ value: "منشأة اختبار", language: "ar" }],
      identity_status: "IDENTIFIED",
      locality_governorate: {
        locality: "Synthetic district",
        governorate: "Synthetic area",
      },
      geo: null,
      legacy_refs: [],
    });
    data.incident.push({
      incident_id: iid,
      incident_label: "Synthetic019 " + code + " case — not research",
      incident_type: "kinetic episode",
      event_start: null,
      event_end: null,
      date_precision: "UNKNOWN",
      temporal_eligibility: "SYNTHETIC",
      clustering_status: "DISTINCT",
      is_current: true,
      limitations: "Disposable synthetic fixture only",
    });
    data.incident_facility.push({
      incident_facility_id: "IF-SYN019-" + code,
      incident_id: iid,
      facility_id: fid,
      is_current: true,
      facility_match_state: "supported",
      role: "affected facility",
      identity_basis_claim_ids: [],
    });
  }
  for (const [id, family, type, value, subject] of [
    ["ATTACK", "KINETIC_EVENT", "BOOLEAN", true, "Synthetic sound-bomb event"],
    [
      "DAMAGE",
      "PHYSICAL_DAMAGE",
      "TEXT_WHERE_REQUIRED",
      "Synthetic window damage",
      "Synthetic physical consequences",
    ],
    ["DATE", "EVENT_DATE", "DATE", null, "Unknown synthetic incident date"],
    [
      "EVAC",
      "EVACUATION",
      "BOOLEAN",
      false,
      "Explicit synthetic no evacuation finding",
    ],
    [
      "SERVICE",
      "SERVICE_DISRUPTION",
      "BOOLEAN",
      null,
      "Unknown synthetic service consequences",
    ],
    ["IDENTITY", "IDENTITY", "BOOLEAN", true, "Synthetic physical identity"],
    [
      "TYPE",
      "FACILITY_TYPE",
      "CATEGORICAL",
      "hospital",
      "Synthetic facility type",
    ],
  ])
    data.claim.push({
      claim_id: "C-SYN019-" + id,
      incident_id: "I-SYN019-MAIN",
      facility_id: ["DATE"].includes(id) ? null : "F-SYN019-MAIN",
      claim_family: family,
      subject,
      value_type: type,
      current_verified_value: value,
      validation_state: value === null ? "NEEDS_MORE_EVIDENCE" : "SUPPORTED",
      validation_origin: "SYNTHETIC_019",
      individual_human_factual_adjudication: "NO",
      is_current: true,
      date_precision: id === "DATE" ? "UNKNOWN" : null,
      quantitative_unit: null,
      impact_basis: null,
      review_notes: "Synthetic only; no research approval",
      legacy_refs: [],
    });
  data.claim.push({
    ...data.claim[1],
    claim_id: "C-SYN019-OTHER",
    incident_id: "I-SYN019-OTHER",
    facility_id: "F-SYN019-OTHER",
  });
  for (const direction of [
    "SUPPORTS",
    "CONTRADICTS",
    "LIMITS",
    "CONTEXT_ONLY",
  ]) {
    const sid = "S-SYN019-" + direction;
    data.source.push({
      source_id: sid,
      source_type: "news",
      title: "Synthetic019 " + direction + " report",
      publisher_platform: "Disposable fixture publisher",
      original_url: "https://example.invalid/scientific019/" + direction,
      canonical_url: null,
      publication_date: { value: null, precision: "UNKNOWN" },
      retrieval_date: "2026-11-04",
      retrieval_body_status: "USABLE_BODY",
      content_preservation_status: {
        excerpt: "Synthetic recorded passage only",
        access: "Direct",
        completeness: "Complete",
        preservation: "Local fixture",
      },
      limitations: "Synthetic; no real incident",
      legacy_refs: [],
    });
    data.claim_source.push({
      claim_source_id: "E-SYN019-" + direction,
      claim_id: "C-SYN019-DAMAGE",
      source_id: sid,
      support_direction: direction,
      directness: "direct",
      originality: "original",
      dependency_group_id: "DG-SYN019-" + direction,
      dependency_provenance: {
        relies_on: "None",
        underlying_source: "Synthetic original",
      },
      evidence_locator: [
        {
          locator: "Synthetic paragraph 1",
          excerpt: "Synthetic " + direction + " description",
        },
      ],
      limitations: "Synthetic limitation",
      evidence_role: "evidence",
    });
  }
  for (const id of [
    "ATTACK",
    "DATE",
    "EVAC",
    "SERVICE",
    "IDENTITY",
    "TYPE",
    "OTHER",
  ])
    data.claim_source.push({
      ...data.claim_source[0],
      claim_source_id: "E-SYN019-" + id,
      claim_id: "C-SYN019-" + id,
      evidence_locator: [
        {
          locator: "Synthetic " + id + " paragraph",
          excerpt: "Synthetic separate assertion",
        },
      ],
    });
  return data;
}
