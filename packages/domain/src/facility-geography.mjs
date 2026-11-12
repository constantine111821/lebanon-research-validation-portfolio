// A current RPC-authored decision may authorize a point beyond the preserved
// historical registry. User-entered metadata alone never establishes authority.
export const GEOGRAPHIC_REVIEW_POLICY = "SUPERVISOR_GEOGRAPHY_REVIEW_20261020";
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
const canonical = x => JSON.stringify(stable(x));
const same = (a, b) => canonical(a ?? null) === canonical(b ?? null);
const rows = (s, k) => s.records?.[k] || [];
export function sourceRecordIds(f) {
  return [...new Set((f.authoritative_source_records || []).filter(x => x.relationship === "PRIMARY_RECORD_FOR_PHYSICAL_FACILITY").map(x => x.source_record_id))].sort();
}
export function reviewedGeographicAuthority(s, f) {
  const r = f?.location_review, proof = r?.geographic_review;
  if (proof?.policy !== GEOGRAPHIC_REVIEW_POLICY) return null;
  const w = s.workflow?.facility_reviews?.[f.facility_id] || s.workflow?.facilities?.[f.facility_id];
  const revision = s.revisions?.FACILITY?.[f.facility_id];
  const history = rows(s, "ACTIVITY_LOG").find(x => x.activity_id === r.authority_artifact);
  if (!history || history.entity_type !== "FACILITY" || history.entity_id !== f.facility_id || history.action_type !== "validate" || history.actor_role !== "supervisor" || history.actor !== r.reviewer || history.actor !== w?.lab_location_reviewed_by || !/^[a-f0-9]{64}$/.test(history.authority_artifact?.sha256 || "")) return null;
  // The immutable audit and its hash are supplied by the authenticated server
  // snapshot; clients cannot write facility/workflow/audit backing rows. Compare
  // every proof field to that exact artifact, rather than accepting client metadata.
  if (r.state !== "SUPPORTED" || r.relation?.support_direction !== "SUPPORTS" || !r.basis || !r.review_note || !r.limitations || w?.lab_location_review_state !== "REVIEWED" || !r.reviewed_at || !w.lab_location_reviewed_at || proof.workflow_reviewed_at !== w.lab_location_reviewed_at || proof.facility_revision !== revision || w.lab_location_reviewed_facility_revision !== revision) return null;
  if (!same(history.after_ref?.location_review, r) || !same(history.authority_artifact?.payload?.after?.location_review, r) || !same(history.authority_artifact?.payload?.operation, proof)) return null;
  if (!same(proof.source_record_ids, sourceRecordIds(f)) || proof.facility_id !== f.facility_id || proof.reviewed_by !== r.reviewer || proof.reviewed_at !== r.reviewed_at || proof.source_id !== r.source_id || !same(proof.coordinates, r.coordinates) || !["HDX_DERIVED", "RESEARCHED_CORRECTION", "MANUAL_NON_HDX"].includes(proof.reference_type)) return null;
  const p = r.coordinates, source = rows(s, "SOURCE").find(x => x.source_id === r.source_id);
  if (!p || p.crs !== "EPSG:4326" || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || (p.latitude === 0 && p.longitude === 0) || !["EXACT_POINT", "ENTRANCE", "MAPPED_FACILITY_POINT", "POLYGON_CENTROID", "POLYGON_FIRST_VERTEX"].includes(r.method) || !source?.title || !source?.publisher_platform || !source?.original_url && !source?.canonical_url) return null;
  return { facility_id: f.facility_id, source_record_ids: proof.source_record_ids, latitude: p.latitude, longitude: p.longitude, crs: p.crs, source_id: r.source_id, authority_artifact: r.authority_artifact, authority_sha256: history.authority_artifact.sha256, method: r.method, limitations: r.limitations, accepted_working_coordinate: true, reference_type: proof.reference_type, authority_policy: proof.policy, facility_revision: revision };
}
