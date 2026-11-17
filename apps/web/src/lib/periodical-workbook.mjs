import { FAMILIES } from "../approved/shared.js";
import { findingText } from "./periodical-data.mjs";

// Each text segment fits in a wrapped detail column at the report's row height.
// Keep the original text intact, including spaces, line breaks and Unicode.
function detailParts(text) {
  const parts = [];
  while (text.length > 160 || text.split(/\r\n|[\r\n]/).length > 4) {
    const breakLimit = [...text.matchAll(/\r\n|[\r\n]/g)][3]?.index ?? Infinity;
    let end = Math.min(160, breakLimit);
    if (/[\ud800-\udbff]/u.test(text[end - 1]) || text.slice(end - 1, end + 1) === "\r\n") end -= 1;
    const wordEnd = text.lastIndexOf(" ", end - 1) + 1;
    if (wordEnd >= end * 0.75 && wordEnd > 0) end = wordEnd;
    parts.push(text.slice(0, end));
    text = text.slice(end);
  }
  return [...parts, text];
}

function preview(text, limit) {
  const line = text.replace(/\s+/gu, " ");
  const chars = Array.from(line);
  return chars.length <= limit ? line : chars.slice(0, limit - 1).join("") + "…";
}

function detailGroup(workbook, label, anchorCells, fill) {
  appendColumn(workbook, label, anchorCells);
  const anchor = workbook.headers.length - 1;
  fill();
  const end = workbook.headers.length - 1;
  if (end > anchor) workbook.outlineGroups.push({ start: anchor + 1, end, label });
}

function appendColumn(workbook, header, cells) {
  workbook.headers.push(header);
  for (const [index, cell] of cells.entries()) workbook.rows[index].push(cell);
}

function appendText(workbook, header, cells) {
  const chunks = cells.map(cell => detailParts(cell.text));
  const length = chunks.reduce((max, parts) => Math.max(max, parts.length), 1);
  for (let part = 0; part < length; part++) {
    appendColumn(workbook, part ? `${header} (${part + 1})` : header,
      cells.map((cell, row) => ({ text: chunks[row][part] || "", status: chunks[row][part] ? cell.status : undefined })));
  }
}

function citationsFor(cell) {
  return cell.findings.flatMap(finding => finding.citations);
}

function bestCitation(citations) {
  const score = citation => (citation.active ? 8 : 0) + (citation.url ? 4 : 0) +
    (citation.relationshipCode === "SUPPORTS" ? 2 : 0);
  return citations.reduce((best, citation) => !best || score(citation) > score(best) ? citation : best, null);
}

function sourceDisplay(citation, otherCount = 0) {
  const publication = [citation.publisher, citation.published].filter(Boolean).join(" · ");
  return {
    text: [preview(citation.title, 96), publication && preview(publication, 74), citation.direction,
      !citation.url && "Saved source details available", otherCount > 0 && `+${otherCount} more in the details`].filter(Boolean).join("\n"),
    hyperlink: citation.url ? { url: citation.url } : undefined,
  };
}

function appendFindings(workbook, header, cells) {
  const count = cells.reduce((max, cell) => Math.max(max, cell.findings?.length ?? 0), 1);
  for (let index = 0; index < count; index++) {
    const items = cells.map(cell => cell.findings?.[index]);
    const heading = count === 1 ? header : `${header} · Finding ${index + 1}`;
    appendText(workbook, count === 1 ? `${header} findings` : heading, items.map(item => item
      ? { text: [findingText(item), item.citationStatus].filter(Boolean).join("\n"), status: item.status === "Validated" ? "validated" : "attention" }
      : { text: "" }));
    const citationCount = items.reduce((max, item) => Math.max(max, item?.citations.length ?? 0), 0);
    for (let source = 0; source < citationCount; source++) {
      const sourceHeading = `${heading} · Source ${source + 1}`;
      const citations = items.map(item => item?.citations[source]);
      appendColumn(workbook, sourceHeading, citations.map(citation => ({
        text: citation ? preview(citation.title, 100) : "",
        hyperlink: citation?.url ? { url: citation.url } : undefined,
      })));
      appendText(workbook, `${sourceHeading} excerpt / locator`, citations.map(citation => ({ text: citation?.text || "" })));
    }
  }
}

const priorityPairs = [2, 4, 6, 8, 10];
const compactMetadataHeadings = new Set(["Facility ID", "Record type", "Review status"]);
const contextHeadings = new Set(["Event title", "Working classification", "Recorded event timing", "Study eligibility", "Facility locality"]);
const facilityFindingHeadings = new Set(["Affected component", "Facility type", "Other identity findings"]);
const compactGisFields = new Set(["Event_ID", "Facility_ID", "Latitude", "Longitude", "Location_Status", "date_display", "Date_Status", "Incident_Status"]);

function prioritySummary(finding, header, facility) {
  const items = finding.status === "attention"
    ? [...finding.findings].sort((a, b) => Number(b.status === "Validated") - Number(a.status === "Validated"))
    : finding.findings;
  const lines = items.slice(0, 2).map(item => {
    if (!item.claimId && item.summary === "Not recorded") {
      const messages = { "Incident date": "Date remains unresolved", "Facility identity": "No separate identity finding",
        "Closure duration": "Duration remains unresolved", "Facility coordinates": "Coordinates unavailable" };
      return header === "Casualties" ? `${item.title} remain unresolved` : messages[header];
    }
    const status = item.status === "Not recorded" ? "Value unresolved" : item.status;
    if (header === "Casualties") {
      const measure = String(item.title).split(" · ")[0];
      return preview(`${measure} · ${status}${item.hasRecordedValue ? ` · ${item.summary}` : ""}`, 88);
    }
    const summary = header === "Facility identity" && item.summary === facility ? "Recorded name matches" : item.summary;
    if (item.status === "Separate identity finding unavailable") return "Linked facility recorded\nSeparate identity finding pending";
    if (item.status === "Not recorded") return preview(`Value unresolved · ${item.subject || "Finding recorded"}`, 88);
    return preview(`${summary} · ${status}`, 88);
  });
  if (finding.findings.length > 2) lines.push(`+${finding.findings.length - 2} more findings`);
  return { status: finding.status, text: lines.join("\n") };
}

function citationSummary(finding, header) {
  const citations = citationsFor(finding);
  const citation = bestCitation(citations);
  if (citation) return { status: finding.status, ...sourceDisplay(citation, citations.length - 1) };
  if (finding.findings.some(item => item.citationStatus === "No verified citation available"))
    return { text: "No verified citation available" };
  if (finding.findings.some(item => item.claimId)) return { text: "Source not linked to this finding" };
  if (header === "Facility identity" && finding.findings.some(item => item.status === "Separate identity finding unavailable"))
    return { text: "Workspace association" };
  if (header === "Incident date" && finding.findings.some(item => item.title === "Recorded episode date"))
    return { text: "Timing from event record" };
  if (header === "Facility coordinates" && finding.findings.some(item => item.summary !== "Not recorded"))
    return { text: "Source not linked to these coordinates" };
  return { text: "" };
}

function eventOverview(cells, verifiedOnly) {
  const findings = [...new Map(cells.flatMap(cell => cell.findings || []).filter(item => item.claimId)
    .map(item => [item.claimId, item])).values()];
  const citations = findings.flatMap(finding => finding.citations);
  const ids = new Set(citations.map(citation => citation.sourceId).filter(Boolean));
  const aiCount = findings.filter(finding => finding.aiOrigin).length;
  const verifiedCount = findings.filter(finding => finding.status === "Validated").length;
  const progress = [
    `${findings.length} fact record${findings.length === 1 ? "" : "s"}`,
    `${citations.length} evidence link${citations.length === 1 ? "" : "s"} · ${ids.size} source${ids.size === 1 ? "" : "s"}`,
    aiCount > 0 && `AI origin recorded for ${aiCount} ${aiCount === 1 ? "fact" : "facts"}`,
    findings.length > 0 && `${verifiedCount} verified`,
  ].filter(Boolean).join("\n");
  const ranked = findings.filter(item => item.current && (item.subject || item.hasRecordedValue)).map(item => {
    const citation = bestCitation(item.citations);
    const score = (citation?.active ? 8 : 0) + (citation?.url ? 5 : 0) +
      (item.status === "Validated" ? 4 : 0) + (item.hasRecordedValue ? 3 : 0) +
      (!["IDENTITY", "EVENT_DATE", "FACILITY_TYPE"].includes(item.family) ? 2 : 0);
    return { item, citation, score };
  }).sort((a, b) => b.score - a.score);
  const first = ranked[0];
  const second = ranked.find(entry => entry.item.family !== first?.item.family);
  const descriptions = [first, second].filter(Boolean).map(({ item }) => {
    const family = FAMILIES[item.family] || "Finding";
    const status = item.status === "Not recorded" ? "Value unresolved" : item.status;
    const text = item.hasRecordedValue ? [item.subject, item.summary].filter(Boolean).join(" · ") : item.subject;
    return `${family} · ${status}\n${preview(text, 92)}`;
  });
  return [{ text: progress }, { text: descriptions.join("\n") || (verifiedOnly ? "No verified findings in this report" : "Research entry awaiting a finding") },
    first?.citation ? sourceDisplay(first.citation, first.item.citations.length - 1) : { text: "" }];
}

export function periodicalWorkbook(report, gisHeaders, gisRows) {
  const simplified = report.selection?.report === "simplified";
  const verifiedOnly = report.selection?.scope === "verified";
  const workbook = {
    headers: [...report.headers.slice(0, 2), "Evidence at a glance", "Documented findings", "Featured source"],
    rows: report.rows.map(row => [...row.slice(0, 2), ...eventOverview(simplified ? priorityPairs.map(index => row[index]) : row, verifiedOnly)]),
    outlineGroups: [],
  };
  for (const index of priorityPairs) {
    const heading = report.headers[index];
    const findings = report.rows.map(row => row[index]);
    appendColumn(workbook, heading, findings.map((finding, row) => prioritySummary(finding, heading, report.rows[row][0].text)));
    detailGroup(workbook, report.headers[index + 1], findings.map(finding => citationSummary(finding, heading)), () => {
      appendFindings(workbook, heading, findings);
    });
  }

  const empty = report.rows.map(() => ({ text: "" }));
  function additionalFields(include) {
    for (let index = 12; index < report.headers.length; index++) {
      const header = report.headers[index];
      if (["Snapshot date", "Export scope"].includes(header) || header.endsWith(" citations")) continue;
      if (!include(header)) continue;
      const cells = report.rows.map(row => row[index]);
      if (cells.some(cell => cell.findings)) appendFindings(workbook, header, cells);
      else appendText(workbook, header, cells);
    }
  }
  detailGroup(workbook, "Event & facility details", empty, () => {
    additionalFields(header => compactMetadataHeadings.has(header) || (!verifiedOnly && contextHeadings.has(header)) ||
      (!simplified && facilityFindingHeadings.has(header)));
  });
  if (!simplified) {
    detailGroup(workbook, "Additional findings & citations", empty, () => {
      additionalFields(header => !compactMetadataHeadings.has(header) && !contextHeadings.has(header) && !facilityFindingHeadings.has(header));
    });
  }

  detailGroup(workbook, "GIS fields", empty, () => {
    const eventIdIndex = gisHeaders.indexOf("Event_ID");
    const byEvent = new Map(gisRows.map(row => [row[eventIdIndex], row]));
    for (const [index, header] of gisHeaders.entries()) {
      if (header === "Facility" || (simplified && !compactGisFields.has(header))) continue;
      appendColumn(workbook, header, report.rows.map(event => {
        const value = byEvent.get(event[1].text)?.[index] ?? "";
        return typeof value === "number" ? { text: "", number: value } : { text: value };
      }));
    }
  });
  return workbook;
}
