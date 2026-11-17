import authorityRegistry from "../../../../packages/domain/src/gis-geography-authority.json" with { type: "json" };
import { sourceRecordIds } from "../../../../packages/domain/src/facility-geography.mjs";

const present = value => value !== undefined && value !== null && value !== "";
const documentedFirstVertex = "POLYGON_FIRST_VERTEX_WITH_DOCUMENTED_AXIS_ORIENTATION_CORRECTION";

/**
 * Citation provenance for a preserved working point, separate from current location validation.
 * @param {{ saved_periodical_capture?: boolean }} snapshot
 * @param {object} facility
 * @param {Map<string, object>} sources
 */
export function historicalLocationProvenance(snapshot, facility, sources) {
  const point = facility.geo;
  if (facility.is_current === false || facility.correction_withdrawn === true || !point ||
      facility.location_review?.coordinates || facility.location_review?.coordinate_rejected === true ||
      ["CONFLICTING", "NOT_SUPPORTED"].includes(facility.location_review?.state) ||
      (facility.location_evidence != null && (!Array.isArray(facility.location_evidence) ||
        facility.location_evidence.some(entry => entry?.scope === "location" && entry.location))))
    return null;

  const candidates = authorityRegistry.filter(entry => entry.facility_id === facility.facility_id);
  if (candidates.length !== 1) return null;
  const [authority] = candidates;
  const methods = [point.method, point.coordinate_method].filter(present);
  const compatible = method => method === authority.method ||
    (method === "POLYGON_FIRST_VERTEX" && authority.method === documentedFirstVertex);
  if (authority.accepted_working_coordinate !== true || authority.crs !== "EPSG:4326" ||
      [point.crs, point.coordinate_reference_system].filter(present).some(crs => crs !== authority.crs) ||
      !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) ||
      authority.latitude !== point.latitude || authority.longitude !== point.longitude ||
      !methods.length || !methods.every(compatible) ||
      [point.source_id, point.source].filter(present).some(id => id !== authority.source_id))
    return null;

  if (!authority.source_record_ids?.length) return null;
  if (Array.isArray(facility.authoritative_source_records)) {
    const records = sourceRecordIds(facility);
    const expected = authority.source_record_ids.toSorted();
    if (records.length !== expected.length || records.some((id, index) => id !== expected[index])) return null;
  } else if (facility.authoritative_source_records != null || snapshot.saved_periodical_capture !== true) {
    return null;
  }

  const locator = authority.authority_artifact?.split("#").at(1);
  const source = sources.get(authority.source_id);
  if (!locator || !/^[a-f0-9]{64}$/.test(authority.authority_sha256 || "") ||
      source?.source_id !== authority.source_id || source.source_type !== "mapping" ||
      source.is_current === false || source.correction_withdrawn === true || !Array.isArray(source.evidence_locator) ||
      !source.evidence_locator?.some(entry =>
        entry?.locator === locator && entry.sha256 === authority.authority_sha256))
    return null;

  return {
    sourceId: authority.source_id,
    crs: authority.crs,
    archiveLocator: authority.authority_artifact,
    archiveSha256: authority.authority_sha256,
    limitations: authority.limitations,
  };
}
