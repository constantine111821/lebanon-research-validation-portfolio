import { fmt } from "../approved/shared.js";
import { isDirectlyReportedDuration } from "../approved/timing.js";
import { casualtyType, findingStatus, recordedLocation, reviewStatus, workspaceEvents } from "./periodical-data.mjs";
import { arcgisTextWidth, PeriodicalSpreadsheetLimitError } from "./periodical-serialization.mjs";

export const arcgisHeaders = [
  "Event_ID", "Facility_ID", "Facility", "Longitude", "Latitude", "Location_Status",
  "date_display", "date_start", "date_end", "date_precision", "Date_Status",
  "Closure_Duration", "Closure_Unit", "Closure_Scope", "Closure_Status",
  "Deaths", "Deaths_Scope", "Deaths_Status", "Injuries", "Injuries_Scope", "Injuries_Status",
  "Incident_Status",
];

const missing = "Not recorded";
const validated = "Validated";
const held = new Set(["Disputed", "Deferred", "Not supported", "Not applicable", "Needs more evidence"]);
const known = value => value !== undefined && value !== null && value !== "";
const nonblank = value => typeof value === "string" && value.trim() !== "";
const quant = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const wholeCount = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const collected = findings => findings.map(({ scope }) => scope).filter(Boolean);
const common = values => new Set(values).size === 1 ? values[0] : "";
const current = claim => claim.is_current !== false && claim.correction_withdrawn !== true;
const maxArcgisFields = 255;
const textBytes = value => Buffer.byteLength(value, "utf8");
const knownDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number(value.slice(0, 4)) > 0 && Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

function choose(findings, noun) {
  const valued = findings.filter(finding => known(finding.value));
  const blocked = findings.filter(finding => held.has(finding.status));
  const alternatives = new Set(valued.map(({ value, unit, scope }) => JSON.stringify([value, unit, scope])));
  if (alternatives.size > 1)
    return { scope: common(collected(valued)), status: "Held: multiple recorded " + noun + " values or scopes" };
  if (blocked.length)
    return { scope: common(collected(findings)), status: common(blocked.map(finding => finding.status)) || "Held: conflicting " + noun + " review states" };
  if (!valued.length) return { scope: common(collected(findings)), status: common(findings.map(finding => finding.status)) || missing };
  return {
    ...valued[0],
    status: common(valued.map(finding => finding.status)) || "Mixed review status",
  };
}

function timing(value, precision) {
  const start = typeof value === "string" ? value : value?.start;
  const end = typeof value === "string" && precision === "DAY" ? value : value?.end;
  if (precision === "DAY") {
    if (!knownDay(start) || end !== start) return null;
    return { display: start, start, end };
  }
  if (precision === "RANGE") {
    if (!knownDay(start) || !knownDay(end) || start > end) return null;
    return { display: start === end ? start : start + " – " + end, start, end };
  }
  // Retain a recorded label at its recorded precision without deriving a day.
  return { display: fmt(value), start: "", end: "" };
}

function occurrence(snapshot, event, eventFacts) {
  const findings = eventFacts.filter(fact => fact.claim_family === "EVENT_DATE").map(fact => ({
    value: fact.current_verified_value,
    precision: fact.date_precision || "UNKNOWN",
    status: findingStatus(snapshot, event.incident_id, fact),
  }));
  const valued = findings.filter(finding => known(finding.value));
  const distinct = new Set(valued.map(finding => {
    const value = finding.value;
    return JSON.stringify([value?.start ?? value, value?.end ?? value, finding.precision]);
  }));
  if (distinct.size > 1)
    return ["Competing occurrence findings", "", "", "", "Held: conflicting calendar values or precision"];
  const blocked = findings.filter(finding => held.has(finding.status));
  if (blocked.length)
    return [valued.length ? fmt(valued[0].value) : "", "", "", valued[0]?.precision || "",
      common(blocked.map(finding => finding.status)) || "Held: conflicting date review states"];
  const start = event.event_start;
  const end = event.event_end;
  const fallback = snapshot.periodicalSelection?.scope !== "verified" && (known(start) || known(end)) ? {
    value: event.date_precision !== "RANGE" && known(start) && (!known(end) || end === start)
      ? start : { start, end },
    precision: event.date_precision || "UNKNOWN", status: "Unverified recorded event date",
  } : null;
  const selected = valued[0] ?? fallback;
  if (!selected) return ["", "", "", "", missing];
  const date = timing(selected.value, selected.precision);
  if (!date) return [fmt(selected.value), "", "", selected.precision, "Held: invalid calendar bounds"];
  const status = valued.length > 1 ? common(valued.map(finding => finding.status)) || "Mixed review status" : selected.status;
  return [date.display, date.start, date.end, selected.precision, status];
}

function scopeOf(fact) {
  const value = fact.scope ?? fact.effect_scope ?? fact.subject;
  return known(value) ? fmt(value) : "";
}

function closure(snapshot, eventId, eventFacts) {
  const findings = eventFacts.filter(fact => fact.claim_family === "RESTORATION_DATE" && fact.value_type === "QUANTITATIVE")
    .map(fact => ({
      value: fact.current_verified_value, unit: fact.quantitative_unit ?? "", scope: scopeOf(fact),
      status: findingStatus(snapshot, eventId, fact), direct: isDirectlyReportedDuration(fact),
    }));
  if (!findings.length) return ["", "", "", "Unresolved: no directly reported duration"];
  const reported = findings.filter(finding => finding.direct);
  if (!reported.length)
    return ["", "", common(collected(findings)), "Unresolved: no directly reported duration"];
  const result = choose(reported, "duration");
  if (!known(result.value)) return ["", "", result.scope || "", result.status === missing ? "Unresolved: duration not recorded" : result.status];
  if (!quant(result.value) || !nonblank(result.unit))
    return ["", "", result.scope, "Held: duration needs a nonnegative number and a recorded unit"];
  return [result.value, result.unit, result.scope, result.status];
}

function casualty(snapshot, eventId, eventFacts, kind) {
  const findings = eventFacts.filter(fact => casualtyType(fact) === kind).map(fact => ({
    value: fact.current_verified_value, scope: scopeOf(fact), status: findingStatus(snapshot, eventId, fact),
  }));
  const result = choose(findings, kind.toLowerCase());
  if (!known(result.value)) {
    const combined = eventFacts.some(fact => casualtyType(fact) === "Combined or unspecified");
    const status = result.status === missing && combined ? "Unresolved: separate count not recorded" : result.status;
    return ["", result.scope || "", status];
  }
  if (!wholeCount(result.value)) return ["", result.scope, "Held: no representable nonnegative whole count"];
  return [result.value, result.scope, result.status];
}

function location(snapshot, event, links, facilities) {
  if (!facilities.length) return ["", missing, "", "", "Unmapped: no current facility"];
  if (facilities.length !== 1 || links.some(link => link.facility_id !== facilities[0].facility_id))
    return ["", "Multiple or unresolved facilities", "", "", "Unmapped: no unique facility association"];
  const [facility] = facilities;
  const name = facility.canonical_name || facility.aliases?.find(alias => alias.value)?.value || missing;
  const { status, point } = recordedLocation(snapshot, facility);
  const reason = event.is_current === false ? "Archived or superseded event"
    : links.length !== 1 || links[0].facility_match_state !== "supported" ? "Physical facility association unresolved"
    : status !== validated ? status : point?.crs !== "EPSG:4326" ? "WGS84 coordinates not established" : null;
  return reason
    ? [facility.facility_id, name, "", "", "Unmapped: " + reason]
    : [facility.facility_id, name, point.longitude, point.latitude, validated];
}

export function periodicalArcgisRows(snapshot, checkBudget = () => {}) {
  const byEvent = new Map();
  for (const claim of snapshot.records.CLAIM) {
    if (!claim.incident_id || !current(claim)) continue;
    const facts = byEvent.get(claim.incident_id) ?? [];
    facts.push(claim);
    byEvent.set(claim.incident_id, facts);
  }
  return Array.from(workspaceEvents(snapshot, checkBudget), ({ event, links, facilities, ids }) => {
    const id = event.incident_id;
    const selected = snapshot.periodicalSelection?.factsByEvent?.get(id);
    const facts = (byEvent.get(id) ?? []).filter(fact =>
      (!fact.facility_id || ids.has(fact.facility_id)) && (!selected || selected.has(fact.claim_id)));
    return [
      id, ...location(snapshot, event, links, facilities),
      ...occurrence(snapshot, event, facts),
      ...closure(snapshot, id, facts),
      ...casualty(snapshot, id, facts, "Deaths"), ...casualty(snapshot, id, facts, "Injuries"),
      reviewStatus(snapshot, event),
    ];
  });
}

const factColumnPrefix = "Research_Facts_";
const citationColumnPrefix = "Research_Citations_";
const separator = " | ";
const continuation = "Continued: ";
const fitWidth = arcgisTextWidth - 1; // Reserve space for the CSV text protection prefix.

function oneLine(value) {
  return fmt(value).replace(/\s+/gu, " ").trim();
}

function researchAttributes(report, row, mappable) {
  const findings = [];
  const citations = [];
  const seen = new Set();
  for (const [index, cell] of row.entries()) {
    const field = report.headers[index];
    if (field === "Facility coordinates" && !mappable) continue;
    for (const [position, item] of (cell.findings ?? []).entries()) {
      if (item.claimId && seen.has(item.claimId)) continue;
      if (item.claimId) seen.add(item.claimId);
      if (!item.claimId && item.summary === missing && !item.citations.length) continue;
      const key = item.claimId ? "Fact ID " + item.claimId : field + " #" + (position + 1);
      findings.push([
        key, field, item.title && oneLine(item.title), "Status: " + item.status,
        "Value: " + oneLine(item.summary ?? item.value), item.citationStatus,
      ].filter(Boolean).join(" · "));
      for (const cite of item.citations) {
        const link = [
          key, cite.direction,
          cite.evidenceId && "Evidence ID " + cite.evidenceId,
          cite.sourceId && "Source ID " + cite.sourceId,
        ].filter(Boolean).join(" · ");
        const withUrl = cite.url && link + " · " + cite.url;
        // Keep complete IDs in CSV. A long URL is available in the paired Excel
        // when the existing stable IDs already identify this reference.
        if (withUrl && (textBytes(withUrl) <= fitWidth || (!cite.evidenceId && !cite.sourceId))) citations.push(withUrl);
        else citations.push(link + (cite.url ? " · URL in Excel" : ""));
      }
    }
  }
  return { findings, citations };
}

function wrapColumns(lines) {
  const fields = [];
  let field = "";
  for (const line of lines) {
    const next = field ? field + separator + line : line;
    if (textBytes(next) <= fitWidth) {
      field = next;
      continue;
    }
    if (field) fields.push(field);
    field = "";
    let bytes = 0;
    for (const char of line) {
      const length = textBytes(char);
      if (bytes + length > fitWidth) {
        fields.push(field);
        field = continuation;
        bytes = textBytes(continuation);
      }
      field += char;
      bytes += length;
    }
  }
  if (field) fields.push(field);
  return fields;
}

function supplementalHeaders(prefix, length) {
  return Array.from({ length }, (_, index) => prefix + String(index + 1).padStart(3, "0"));
}

export function periodicalArcgisTable(report, gisRows, checkBudget = () => {}) {
  const byEvent = new Map(report.rows.map(row => [row[1].text, row]));
  const gisEventIds = new Set(gisRows.map(row => row[0]));
  if (byEvent.size !== report.rows.length || gisEventIds.size !== gisRows.length ||
      gisEventIds.size !== byEvent.size || [...gisEventIds].some(id => !byEvent.has(id)))
    throw new TypeError("Periodical Excel and ArcGIS must contain the same unique event IDs.");
  let factWidth = 0;
  let citationWidth = 0;
  const longitude = arcgisHeaders.indexOf("Longitude");
  const latitude = arcgisHeaders.indexOf("Latitude");
  const entries = gisRows.map(row => {
    checkBudget();
    const mappable = Number.isFinite(row[longitude]) && Number.isFinite(row[latitude]);
    const attributes = researchAttributes(report, byEvent.get(row[0]), mappable);
    const facts = wrapColumns(attributes.findings);
    const citations = wrapColumns(attributes.citations);
    factWidth = Math.max(factWidth, facts.length);
    citationWidth = Math.max(citationWidth, citations.length);
    if (arcgisHeaders.length + factWidth + citationWidth > maxArcgisFields)
      throw new PeriodicalSpreadsheetLimitError("The selected research exceeds the 255-field ArcGIS text table limit. Choose the Excel report or a smaller research selection to retain every finding and citation.");
    return { row, facts, citations };
  });
  const pad = (cells, width) => [...cells, ...Array(width - cells.length).fill("")];
  return {
    headers: [...arcgisHeaders, ...supplementalHeaders(factColumnPrefix, factWidth), ...supplementalHeaders(citationColumnPrefix, citationWidth)],
    rows: entries.map(({ row, facts, citations }) => [...row, ...pad(facts, factWidth), ...pad(citations, citationWidth)]),
  };
}

export function periodicalArcgisSchema(filename, headers = arcgisHeaders) {
  if (!/^[A-Za-z0-9_.-]+\.csv$/.test(filename)) throw new TypeError("Use the ArcGIS CSV filename without a path.");
  if (headers.length > maxArcgisFields || headers.length < arcgisHeaders.length ||
      arcgisHeaders.some((header, index) => header !== headers[index]) ||
      new Set(headers).size !== headers.length ||
      headers.slice(arcgisHeaders.length).some(header => !/^Research_(?:Facts|Citations)_\d{3}$/u.test(header)))
    throw new TypeError("ArcGIS schema columns must match the periodical table.");
  const types = {
    Longitude: "Double", Latitude: "Double", Closure_Duration: "Double",
    Deaths: "Long", Injuries: "Long",
  };
  return [
    "[" + filename + "]", "ColNameHeader=True", "Format=CSVDelimited",
    ...headers.map((header, i) => "Col" + (i + 1) + "=" + header + " " + (types[header] || "Text Width " + arcgisTextWidth)),
    "",
  ].join("\r\n");
}
