// Owner amendment 008: advancement is acceptance, not factual certification.
// Prefer the authoritative RPC breakdown; this fallback supports typed local projections.
export function factWaived(s, id, iid) {
  const d = s.dispositions?.facts?.[id],
    old = s.workflow?.incidents?.[iid]?.dispositions?.[id];
  return (
    (d?.state === "DEFERRED" && Boolean(d.reason?.trim())) ||
    (["deferred", "unable_to_resolve", "not_required"].includes(
      old?.disposition,
    ) &&
      Boolean(old.reason?.trim()))
  );
}
export function acceptanceReadiness(s, iid) {
  if (s.acceptance_readiness?.[iid]) return s.acceptance_readiness[iid];
  const w = s.workflow?.incidents?.[iid] || {},
    facilities = new Set(
      (s.records.INCIDENT_FACILITY || [])
        .filter((x) => x.incident_id === iid && x.is_current !== false)
        .map((x) => x.facility_id),
    );
  const categories = s.requirement_categories || {},
    required = new Set(w.required_claim_ids || []),
    optional = new Set(w.optional_claim_ids || []);
  const facts = (s.records.CLAIM || [])
    .filter(
      (c) =>
        c.is_current !== false &&
        c.identity_purpose !== "facility_comparison" &&
        (categories[c.claim_id] !== "INFORMATIONAL" ||
          required.has(c.claim_id)) &&
        (required.has(c.claim_id) || !optional.has(c.claim_id)) &&
        (c.incident_id === iid ||
          (facilities.has(c.facility_id) &&
            (required.has(c.claim_id) ||
              ["PHYSICAL_IDENTITY", "FACILITY_TYPE"].includes(
                categories[c.claim_id],
              )))),
    )
    .map((c) => {
      const review = s.workflow?.claims?.[c.claim_id];
      const current =
        review?.lab_review_state === "REVIEWED" &&
        !review.review_needed &&
        Boolean(review.lab_reviewed_by && review.lab_reviewed_at) &&
        review.lab_reviewed_claim_revision === s.revisions?.CLAIM?.[c.claim_id];
      return {
        claim_id: c.claim_id,
        facility_id: c.facility_id,
        category: categories[c.claim_id] || "INCIDENT_FACT",
        subject: c.subject,
        validation_state: c.validation_state,
        value: c.current_verified_value ?? null,
        lab_reviewed: current,
        reason:
          s.dispositions?.facts?.[c.claim_id]?.reason ||
          w.dispositions?.[c.claim_id]?.reason ||
          null,
        status: factWaived(s, c.claim_id, iid)
          ? "waived"
          : current
            ? "reviewed"
            : "outstanding",
      };
    });
  const other = [...facilities]
    .filter((fid) => s.workflow?.facilities?.[fid]?.location_required)
    .map((fid) => ({
      id: "LOCATION:" + fid,
      facility_id: fid,
      category: "LOCATION",
      status:
        s.workflow?.facilities?.[fid]?.lab_location_review_state === "REVIEWED"
          ? "reviewed"
          : "outstanding",
    }));
  const tasks = (s.records.GAP_TASK || [])
    .filter((t) => t.incident_id === iid)
    .map((t) => ({
      gap_task_id: t.gap_task_id,
      claim_id: t.claim_id,
      state:
        s.workflow?.tasks?.[t.gap_task_id]?.lab_task_state || "NOT_ASSESSED",
      question: t.factual_question,
    }));
  const incident = s.records.INCIDENT?.find((i) => i.incident_id === iid);
  return {
    policy: "OWNER_AMENDMENT_008",
    incident_id: iid,
    classification: incident?.incident_type || "unresolved cluster",
    facts,
    incident_facts: facts.filter((f) => f.category === "INCIDENT_FACT"),
    shared_facility_requirements: facts.filter(
      (f) => f.category !== "INCIDENT_FACT",
    ),
    other_requirements: other,
    reviewed: facts.filter((f) => f.status === "reviewed").length,
    waived: facts.filter((f) => f.status === "waived").length,
    outstanding: facts.filter((f) => f.status === "outstanding").length,
    total: facts.length,
    tasks,
    unknown: facts.filter((f) => f.value == null),
    conflicting: facts.filter((f) => f.validation_state === "CONFLICTING"),
    requirements_assessed: w.requirements_assessed === true,
  };
}
export function outputAuthorized(s, iid) {
  const d = s.dispositions?.incidents?.[iid],
    w = s.workflow?.incidents?.[iid],
    a = s.phase2_approvals?.[iid],
    rev = s.revisions?.INCIDENT?.[iid];
  return (
    d?.state !== "DEFERRED" &&
    ["review_complete", "supervisor_override", "complete"].includes(
      w?.status,
    ) &&
    w.completion?.completion_revision === rev &&
    a?.status === "APPROVED" &&
    a.approved_incident_revision === rev &&
    Boolean(a.approved_by && a.approved_at && a.approval_reason?.trim())
  );
}
