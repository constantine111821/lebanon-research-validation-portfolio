// Read-only projections of recorded evidence. Never fetches, translates or writes research.
import { h, label, sourceExcerpts, safeURL, effectiveSource, currentEvidence, evidenceFor } from "./shared.js";

export const RELATIONSHIPS = {
  SUPPORTS: ["Supports this finding", "Evidence for this exact proposition."],
  CONTRADICTS: ["Challenges this finding", "Evidence against this exact proposition."],
  LIMITS: ["Qualifies this finding", "This source narrows, adds conditions to, or limits what can safely be concluded from the finding."],
  CONTEXT_ONLY: [
    "Provides background",
    "Background that does not establish this fact.",
  ],
};
export const relationship = (code) =>
  RELATIONSHIPS[code] || [
    "Relationship not recorded",
    "Check how this source relates to the fact before deciding.",
  ];
export const relationshipHelp = () =>
  `<dl class="evidence-help">${Object.values(RELATIONSHIPS)
    .map(([title, text]) => `<dt>${h(title)}</dt><dd>${h(text)}</dd>`)
    .join("")}</dl>`;
const strings = (value) =>
  typeof value === "string" && value.trim()
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : [];

export function evidenceEntries(s, source, rel = {}) {
  source = effectiveSource(source, rel);
  const found = sourceExcerpts(s, source, rel);
  const entries =
    typeof found === "string"
      ? [{ text: found }]
      : Array.isArray(found)
        ? found
        : found
          ? [found]
          : [];
  if (entries.length)
    return entries
      .map((x) => (typeof x === "string" ? { text: x } : x))
      .filter((x) => typeof (x.text || x.excerpt || x.description) === "string")
      .map((x) => ({ ...x, text: x.text || x.excerpt || x.description }));
  const text =
    rel.relevant_excerpt ||
    rel.excerpt ||
    rel.evidence_description ||
    source.relevant_excerpt;
  return typeof text === "string" && text
    ? [{ text, label: "Recorded passage or observation" }]
    : [];
}

function entryKind(entry) {
  if (/source-record fields|structured record/i.test(entry.label || ""))
    return "structured";
  if (/assessment/i.test(entry.label || "")) return "assessment";
  if (/captured passage|source text|quotation/i.test(entry.label || ""))
    return "source";
  return "observation";
}

// Strip only explicitly labeled capture markup in the reading projection.
// Exact capture bytes, citation tokens and line labels remain in advanced details.
export function readableCapture(text) {
  return text
    .replace(/\uE200cite\uE202[^\uE201]*\uE201/g, (token) => {
      const body = token.slice(6, -1),
        at = body.indexOf("†");
      return at < 0 ? "" : body.slice(at + 1);
    })
    .replace(/(^|\n)[ \t]*L\d+:[ \t]?/g, "$1")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}

function readingEntry(entry, index) {
  const kind = entryKind(entry);
  if (kind === "structured") {
    let fields;
    try {
      fields = JSON.parse(entry.text);
    } catch {
      /* A malformed recorded value remains available verbatim. */
    }
    const names = [
      ["Name", "Recorded name"],
      ["name", "Recorded name"],
      ["name_en", "English name"],
      ["name_ar", "Original-language name"],
      ["title", "Recorded title"],
      ["description", "Recorded description"],
    ].filter(([k]) => typeof fields?.[k] === "string" && fields[k]);
    return `<section class="evidence-reading" data-evidence-kind="structured"><h4>Saved mapping or source record</h4>${names.length ? `<dl class="evidence-record-fields">${names.map(([k, title]) => `<dt>${h(title)}</dt><dd dir="auto">${h(fields[k])}</dd>`).join("")}</dl>` : "<p>A structured record is saved. Its complete fields are available in advanced details.</p>"}<p class="subtle">Recorded fields, not an article quotation.</p></section>`;
  }
  const title =
    kind === "assessment"
      ? "Recorded assessment"
      : kind === "source"
        ? "Saved source text"
        : "Recorded passage or observation";
  const text =
    kind === "source" && /captured passage/i.test(entry.label || "")
      ? readableCapture(entry.text)
      : entry.text;
  const long = text.length > 360;
  const preview = long ? text.slice(0, 280) : text;
  return `<section class="evidence-reading" data-evidence-kind="${kind}"><h4>${title}</h4>${kind === "assessment" ? '<p class="subtle">Earlier research judgment; not a source quotation.</p>' : ""}${long ? '<p class="subtle">Beginning of the saved text</p>' : ""}<p class="evidence-text" dir="auto">${h(preview)}${long ? "…" : ""}</p>${long ? `<details class="evidence-passage"><summary>Read the full ${kind === "assessment" ? "assessment" : "saved text"}</summary><div class="evidence-text" dir="auto" tabindex="0" aria-label="Full saved ${kind === "assessment" ? "assessment" : "source text"} ${index + 1}">${h(text)}</div></details>` : ""}${kind === "source" && /captured passage/i.test(entry.label || "") ? '<p class="subtle">Capture markers are hidden here. The exact saved capture is available in advanced details.</p>' : ""}</section>`;
}

function dependency(s, source, rel) {
  const objects = [
    source,
    rel,
    ...(Array.isArray(source.limitations) ? source.limitations : []),
    ...(Array.isArray(rel.limitations) ? rel.limitations : []),
  ].filter((x) => x && typeof x === "object");
  const nonIndependent = objects.some((x) => x.independent_for_claim === false);
  const repeated =
    ["republication", "syndication", "repost"].includes(
      String(rel.originality || source.originality).toLowerCase(),
    ) || source.retrieval_body_status === "DUPLICATE_OR_DEPENDENT";
  const peers = rel.dependency_group_id
    ? (s.records?.CLAIM_SOURCE || []).filter(
        (x) =>
          x.claim_id === rel.claim_id &&
          currentEvidence(x) &&
          x.source_id !== source.source_id &&
          x.dependency_group_id === rel.dependency_group_id,
      )
    : [];
  if (nonIndependent)
    return "Recorded as not independent for this fact. Do not count it as a separate confirmation.";
  if (repeated)
    return "Repeated reporting. A further copy is not automatically independent confirmation.";
  if (peers.length)
    return "Shares a recorded reporting group with another linked source. Multiple links do not establish independence.";
  if (rel.dependency_provenance?.relies_on === "yes")
    return "Relies on another report. Check the recorded limitations before counting independent support.";
  return "Independence is not established by the number of linked sources.";
}

export function sourceReading(s, source, rel = {}) {
  const entries = evidenceEntries(s, source, rel);
  // Prefer the recorded assessment before long captured text, without modifying either.
  return entries.length
    ? entries
        .map((entry, i) => ({ entry, i }))
        .sort(
          (a, b) =>
            (entryKind(a.entry) === "assessment" ? -1 : 0) -
            (entryKind(b.entry) === "assessment" ? -1 : 0),
        )
        .map(({ entry, i }) => readingEntry(entry, i))
        .join("")
    : '<p class="evidence-missing">No passage or observation is saved. This is a gap in the recorded evidence, not proof against the fact.</p>';
}

export function sourceCautions(s, source, rel = {}) {
  source = effectiveSource(source, rel);
  const displayedAssessments = evidenceEntries(s, source, rel)
    .filter((entry) => entryKind(entry) === "assessment")
    .map((entry) => entry.text);
  const limits = [
    ...new Set([...strings(rel.limitations), ...strings(source.limitations)]),
  ].filter((text) => !displayedAssessments.includes(text));
  const status = source.retrieval_body_status;
  const note = [...strings(rel.limitations), ...strings(source.limitations)]
    .length
    ? "The saved limitation note is included in the recorded assessment above."
    : "No limitation note is recorded. This does not mean the source has no limitations.";
  const availability = {
    PARTIAL_USABLE_BODY: "Only part of this source was captured.",
    INDEXED_ONLY:
      "Only an index or search result was recorded; the full source was not captured.",
    INACCESSIBLE_NEUTRAL:
      "The source could not be accessed when recorded. This does not decide the fact.",
    DUPLICATE_OR_DEPENDENT:
      "The available source is a repeated or dependent copy.",
  }[status];
  return `<aside class="evidence-cautions" aria-label="Evidence limitations"><p class="evidence-dependency">${h(dependency(s, source, rel))}</p>${availability ? `<p>${availability}</p>` : ""}${limits.length ? `<details class="evidence-limitations"><summary>Recorded limitations</summary><ul>${limits.map((x) => `<li dir="auto">${h(x)}</li>`).join("")}</ul></details>` : `<p class="subtle">${h(note)}</p>`}</aside>`;
}

function publication(source) {
  const d = source.publication_date;
  if (!d) return "Date not recorded";
  if (typeof d === "string") return d;
  const precision = d.precision || source.publication_date_precision;
  if (!precision || precision === "UNKNOWN") return "Date unknown";
  const value =
    d.value ?? d.date ?? [d.start, d.end].filter(Boolean).join(" → ");
  const text =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? [value.start, value.end].filter(Boolean).join(" → ")
        : "";
  return text
    ? `${text}${precision === "DAY" ? "" : " · " + label(precision)}`
    : "Date not recorded";
}

export function sourceHeader(source) {
  const url = source.canonical_url || source.original_url;
  const href = safeURL(url);
  const kind =
    source.content_preservation_status?.source_description ||
    source.source_type;
  return `<header class="evidence-source-head"><h3 dir="auto">${h(source.title || "Untitled source")}</h3><p class="evidence-byline" dir="auto">${h(source.publisher_platform || "Publisher not recorded")} <span aria-hidden="true">·</span> Published or posted: ${h(publication(source))}</p><p class="evidence-origin">${h({ mapping: "Saved mapping record", news: "Article", official: "Official statement", hospital: "Hospital statement", social: "Social-media source", video: "Video", photo: "Photograph", humanitarian: "Humanitarian report", observation: "Recorded research observation", "human OSINT": "Recorded research observation" }[kind] || label(kind || "Source type not recorded"))}</p>${href ? `<a class="evidence-source-link" href="${h(href)}" target="_blank" rel="noopener noreferrer">Open recorded source <span class="subtle">(new tab; availability not checked)</span></a>` : `<p class="evidence-missing">${url ? "No usable web link is recorded." : "No web link is recorded."} Saved evidence remains available below.</p>`}</header>`;
}

export function sourceAdvanced(s, source, rel = {}, full = false) {
  source = effectiveSource(source, rel);
  const data = full
    ? {
        source,
        preserved_shared_source: rel.citation_override
          ? s.records?.SOURCE?.find(x => x.source_id === source.source_id)
          : undefined,
        selected_fact_relationship: rel,
        saved_evidence: s.source_excerpts?.[source.source_id] || [],
        other_fact_relationships: (s.records?.CLAIM_SOURCE || []).filter(
          (x) =>
            x.source_id === source.source_id &&
            x.claim_source_id !== rel.claim_source_id,
        ),
      }
    : {
        source_id: source.source_id,
        original_url: source.original_url,
        canonical_url: source.canonical_url,
        evidence_locator: rel.evidence_locator || source.evidence_locator,
        originality: rel.originality || source.originality,
        directness: rel.directness,
        dependency_group_id: rel.dependency_group_id,
        dependency_provenance:
          rel.dependency_provenance || source.dependency_provenance,
        recorded_limitations: {
          source: source.limitations,
          relationship: rel.limitations,
        },
      };
  return `<details class="source-details evidence-advanced"><summary>Advanced details · citations and preserved records</summary><div class="secondary-content"><p>Recorded identifiers, URLs, citation locations and provenance are preserved below. They do not add approval or independent corroboration.</p>${
    full
      ? evidenceEntries(s, source, rel)
          .map(
            (entry) =>
              `<details><summary>${h(entry.label || "Exact recorded passage or observation")}</summary><pre class="raw" dir="auto">${h(entry.text)}</pre><pre class="raw">${h(JSON.stringify(entry.ref || {}, null, 2))}</pre></details>`,
          )
          .join("")
      : ""
  }<pre class="raw" dir="auto">${h(JSON.stringify(data, null, 2))}</pre></div></details>`;
}

export function renderEvidenceCard(s, source, rel = {}, full = false) {
  source = effectiveSource(source, rel);
  if (!currentEvidence(rel))
    return `<article class="evidence-card evidence-readable"><h3>Withdrawn relationship — historical record</h3><p>This source is no longer counted as current evidence for this fact. Withdrawal does not establish a negative finding.</p>${sourceHeader(source)}${sourceReading(s, source, rel)}${sourceAdvanced(s, source, rel, true)}</article>`;
  if (!full) return renderEvidenceSummary(s, source, rel);
  const [name, meaning] = relationship(rel.support_direction);
  return `<article class="evidence-card source-card evidence-readable ${rel.support_direction === "CONTRADICTS" ? "contra" : rel.support_direction === "LIMITS" ? "limit" : ""}" data-source-id="${h(source.source_id)}" data-evidence-relation="${h(rel.support_direction || "UNKNOWN")}"><div class="evidence-relationship"><strong>${h(name)}</strong><span>${h(meaning)}</span></div>${sourceHeader(source)}${sourceReading(s, source, rel)}${sourceCautions(s, source, rel)}${sourceAdvanced(s, source, rel, full)}${!full ? `<button type="button" data-action="source" data-id="${h(source.source_id)}" data-claim="${h(rel.claim_id || "")}" data-relation="${h(rel.claim_source_id || "")}">Complete source details</button>` : ""}</article>`;
}

const short = (text, size = 260) => { const chars = Array.from(String(text || '')); return chars.slice(0,size).join('') + (chars.length>size?'…':''); };
function structuredPreview(entry) {
  try {
    const fields=JSON.parse(entry.text),names=[['Name','Recorded name'],['name','Recorded name'],['name_en','English name'],['name_ar','Original-language name'],['title','Recorded title'],['description','Recorded description'],['locality','Recorded locality']];
    const recorded=names.filter(([key])=>typeof fields[key]==='string'&&fields[key]).map(([key,title])=>`${title}: ${fields[key]}`);
    if(recorded.length)return recorded.join('; ')+'. Recorded source fields, not an article quotation or a new identity decision.';
  } catch { /* Exact unparsed fields remain in Source Provenance. */ }
  return 'A structured source record is saved. Inspect its complete fields; it is not an article quotation or a verified identity decision.';
}
export function sourceTypeLabel(source) {
  const names={news:'News article',official:'Official statement',humanitarian:'Humanitarian report',social:'Social-media source',mapping:'Mapping record','human OSINT':'Research observation',other:'Other'};
  const canonical=source.source_type;
  const subtype=source.content_preservation_status?.source_description;
  const specific={hospital:'Hospital statement',video:'Video',photo:'Photograph'}[subtype];
  return specific ? `${specific} · recorded category: ${names[canonical] || (canonical?label(canonical):'Unclassified')}` : names[canonical] || (canonical?label(canonical):'Source type unclassified');
}
export function renderEvidenceSummary(s, source, rel = {}) {
  source = effectiveSource(source, rel);
  const entries=evidenceEntries(s,source,rel),entry=entries.find(e=>entryKind(e)==='observation')||entries.find(e=>entryKind(e)==='source')||entries.find(e=>entryKind(e)==='assessment')||entries[0];
  const kind=entry?entryKind(entry):'missing',text=entry?(kind==='structured'?structuredPreview(entry):kind==='source'&&/captured passage/i.test(entry.label||'')?readableCapture(entry.text):entry.text):'No relevant passage is saved. Inspect the recorded source and citation gap before deciding.';
  const limit=[...new Set([...strings(rel.limitations),...strings(source.limitations)])].filter(x=>x!==entry?.text).join(' '),dep=dependency(s,source,rel),href=safeURL(source.canonical_url||source.original_url),name=relationship(rel.support_direction)[0];
  return `<article class="evidence-card evidence-compact evidence-readable ${rel.support_direction==='CONTRADICTS'?'contra':rel.support_direction==='LIMITS'?'limit':''}" data-source-id="${h(source.source_id)}" data-evidence-relation="${h(rel.support_direction||'UNKNOWN')}"><h4 dir="auto">${h(source.title||'Preserved source without a recorded title')}</h4><p class="evidence-byline" dir="auto">${h(source.publisher_platform||'Publisher not recorded')} · <span data-source-type="${h(source.source_type||'UNKNOWN')}">${h(sourceTypeLabel(source))}</span> · Published or posted: ${h(publication(source))}</p><p class="evidence-relationship"><strong>${h(name)}</strong></p><p class="evidence-text" dir="auto"><b>${kind==='assessment'?'Recorded assessment (not a quotation)':kind==='structured'?'Recorded source fields':'Relevant evidence'}:</b> ${h(short(text))}</p>${limit?`<p class="evidence-summary-limit" dir="auto"><b>Limit:</b> ${h(short(limit,180))}</p>`:''}${!dep.startsWith('Independence is not established')?`<p class="evidence-dependency">${h(dep)}</p>`:''}${source.retrieval_body_status&&source.retrieval_body_status!=='USABLE_BODY'?`<p class="subtle">${h({PARTIAL_USABLE_BODY:'Partial source capture',INDEXED_ONLY:'Index or search result only',INACCESSIBLE_NEUTRAL:'Source was inaccessible when recorded',DUPLICATE_OR_DEPENDENT:'Repeated or dependent report'}[source.retrieval_body_status]||'Source access not established')}</p>`:''}<div class="inline">${href?`<a href="${h(href)}" target="_blank" rel="noopener noreferrer">Open source</a>`:'<span>No usable web link recorded</span>'}<button type="button" data-action="source" data-id="${h(source.source_id)}" data-claim="${h(rel.claim_id||'')}" data-relation="${h(rel.claim_source_id||'')}">View passage and details</button></div></article>`;
}
function sameSavedLocation(location, ref) {
  if (typeof location?.locator !== "string" || typeof ref?.locator !== "string") return false;
  if (location.sha256 || ref.sha256) {
    if (location.sha256 !== ref.sha256 || location.original_relative_path !== ref.original_relative_path) return false;
    return location.locator === ref.locator || ref.locator.startsWith(`${location.locator}/`);
  }
  return location.locator === ref.locator;
}

function citedCapturePassages(text, scope) {
  const citation = /^(turn\w+) lines? (.+)$/i.exec(scope || "");
  if (!citation) return [];
  const [, view, scopeText] = citation;
  const bounds = scopeText.split(/;\s*/).flatMap((part) => {
    const range = /^(?:(?:[\w-]+ )?observation )?(\d+)(?:[–-](\d+))?$/i.exec(part);
    if (!range || /^(?:not|no|except|exclude)\b/i.test(part)) return [];
    return [[Number(range[1]), Number(range[2] || range[1])]];
  });
  // A provider citation token can precede the next numbered line without a newline.
  const markers = Array.from(text.matchAll(/(?:^|\uE201[ \t]+)(L(\d+):)/gm), (match) => ({
    number: Number(match[2]),
    start: match.index + match[0].length - match[1].length,
  }));
  const groups = [];
  for (const [index, { number, start }] of markers.entries()) {
    if (!bounds.some(([start, end]) => number >= start && number <= end)) continue;
    const savedLine = text.slice(start, markers[index + 1]?.start);
    const previous = groups.at(-1);
    if (previous && previous.end + 1 === number) {
      previous.end = number;
      previous.text += savedLine;
    } else groups.push({ start: number, end: number, text: savedLine });
  }
  return groups.map(({ start, end, text: passage }) => ({
    text: passage,
    locator: start === end ? `${view} line ${start}` : `${view} lines ${start}–${end}`,
    kind: "source",
  }));
}

function incidentPassages(s, source, relation) {
  const locations = Array.isArray(relation.evidence_locator) ? relation.evidence_locator : [];
  const inline = locations.flatMap((location) => {
    const text = location?.excerpt || location?.description;
    return typeof text === "string" && text.trim()
      ? [{ text, locator: location.locator, kind: location.description && !location.excerpt ? "observation" : "excerpt" }]
      : [];
  });
  if (inline.length) return inline;

  const text = relation.relevant_excerpt || relation.excerpt || relation.evidence_description;
  if (typeof text === "string" && text.trim()) {
    return [{ text, locator: locations[0]?.locator, kind: relation.evidence_description === text ? "observation" : "excerpt" }];
  }

  const saved = sourceExcerpts(s, source, relation);
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((entry) => {
    if (typeof entry?.text !== "string" || !entry.text.trim()) return [];
    const matches = locations.filter((location) => sameSavedLocation(location, entry.ref));
    if (!matches.length) return [];
    const kind = entryKind(entry);
    // Legacy captures can contain several facts. Use the positive line ranges
    // recorded on this relationship and leave prose-only references in details.
    const scope = matches.map((location) => location.authority_scope).find((value) => /^turn\w+ lines? \d/i.test(value || ""));
    if (kind === "source" && entry.line_range) return citedCapturePassages(entry.text, scope);
    return [{ text: entry.text, locator: entry.ref.locator, kind }];
  });
}

function renderIncidentEvidence(s, source, relation) {
  source = effectiveSource(source, relation);
  const passages = incidentPassages(s, source, relation);
  const title = h(source.title || "Source title not recorded");
  const href = safeURL(source.canonical_url) || safeURL(source.original_url);
  const subtype = source.content_preservation_status?.source_description || source.source_type;
  const descriptions = {
    source: "Saved source excerpt",
    excerpt: "Saved excerpt or description",
    observation: "Recorded observation",
    assessment: "Recorded assessment",
    structured: "Saved mapping or source record",
  };
  const relationName = relationship(relation.support_direction)[0];
  const sourceLimits = Array.isArray(source.limitations) ? source.limitations : [];
  const identityLimits = sourceLimits.flatMap((limit) => limit?.facility_specific_evidence_eligible === false ? strings(limit.basis) : []);
  const limits = [...new Set([...strings(relation.limitations), ...strings(source.limitations), ...identityLimits])]
    .filter((text) => !passages.some((entry) => entry.text === text));
  const dependencyNote = dependency(s, source, relation);
  const provenance = dependencyNote.startsWith("Independence is not established") ? "" : dependencyNote;
  const availability = {
    PARTIAL_USABLE_BODY: "Only part of the source was captured.",
    INDEXED_ONLY: "Only an index or search result was recorded.",
    INACCESSIBLE_NEUTRAL: "The source was inaccessible when recorded.",
    DUPLICATE_OR_DEPENDENT: "The captured source is a repeated or dependent copy.",
  }[source.retrieval_body_status];
  return `<article class="evidence-card evidence-compact evidence-readable incident-evidence-card ${relation.support_direction === "CONTRADICTS" ? "contra" : relation.support_direction === "LIMITS" ? "limit" : ""}" data-source-id="${h(source.source_id)}" data-evidence-relation="${h(relation.support_direction || "UNKNOWN")}">
    <header class="evidence-source-head">
      <h5 class="incident-evidence-source-title" dir="auto">${href ? `<a href="${h(href)}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</h5>
      <p class="evidence-byline">${h(source.publisher_platform || "Publisher not recorded")} · Published or posted: ${h(publication(source))}</p>
      ${href ? "" : '<p class="evidence-missing">No usable web link recorded.</p>'}
    </header>
    ${passages.map(({ text, locator, kind }) => {
      if (kind === "excerpt" && subtype === "mapping") kind = "structured";
      if (kind === "excerpt" && ["video", "photo", "human OSINT", "observation"].includes(subtype)) kind = "observation";
      const exactText = h(text).replaceAll("\r", "&#13;");
      return `<div class="incident-evidence-passage" data-evidence-kind="${kind}"><p><strong>${descriptions[kind]}</strong></p><div class="incident-evidence-passage-text" dir="auto">${exactText}</div>${locator ? `<p class="incident-evidence-locator"><strong>Saved citation</strong> <bdi>${h(locator)}</bdi></p>` : ""}</div>`;
    }).join("") || '<p class="evidence-missing">No saved excerpt is tied to this finding. Check the source details for the recorded citation.</p>'}
    <p class="evidence-relationship"><strong>${h(relationName)}</strong></p>
    ${limits.length || provenance || availability ? `<div class="incident-evidence-caveats">
      ${limits.map((text) => `<p dir="auto"><strong>Limit</strong> ${h(text)}</p>`).join("")}
      ${provenance ? `<p class="evidence-dependency">${h(provenance)}</p>` : ""}
      ${availability ? `<p>${h(availability)}</p>` : ""}
    </div>` : ""}
    <button type="button" data-action="source" data-id="${h(source.source_id)}" data-claim="${h(relation.claim_id)}" data-relation="${h(relation.claim_source_id)}">Source details</button>
  </article>`;
}

export function renderFactEvidence(s, claim, { incidentReview = false } = {}) {
 const links=(s.records?.CLAIM_SOURCE||[]).filter(r=>r.claim_id===claim.claim_id&&currentEvidence(r));
 const pairs=links.map(relation=>({relation,source:s.records?.SOURCE?.find(x=>x.source_id===relation.source_id)}));
 const renderSource=incidentReview?renderIncidentEvidence:renderEvidenceSummary;
 const count=code=>links.filter(r=>r.support_direction===code).length;
 const types={SUPPORTS:'Key supporting evidence',CONTRADICTS:'Evidence that challenges this finding',LIMITS:'Evidence that qualifies this finding',CONTEXT_ONLY:'Background only'};
 const summary=`${new Set(links.map(r=>r.source_id)).size} linked sources · ${links.length} relationships`;
 const adverse=[count('CONTRADICTS')?`${count('CONTRADICTS')} challenging`:null,count('LIMITS')?`${count('LIMITS')} qualifying`:null].filter(Boolean).join(' · ');
 const body=Object.entries(types).map(([code,title])=>{
   const group=pairs.filter(p=>p.relation.support_direction===code);return group.length?`<section class="fact-evidence-group" data-evidence-group="${code}"><h4>${title}</h4>${(code==='LIMITS'||code==='CONTEXT_ONLY')?`<p class="subtle">${h(RELATIONSHIPS[code][1])}</p>`:''}<div class="review-evidence">${group.map(p=>p.source?renderSource(s,p.source,p.relation):'<p class="empty">Linked source unavailable in this workspace. Its recorded relationship is retained.</p>').join('')}</div></section>`:'';
 }).join('');
 const unknown=pairs.filter(p=>!types[p.relation.support_direction]).map(p=>p.source?renderSource(s,p.source,p.relation):'<p class="empty">Linked source unavailable; relationship retained.</p>').join('');
 return `<details class="fact-evidence-disclosure" data-disclosure-key="evidence-${h(claim.claim_id)}" data-evidence-claim="${h(claim.claim_id)}"><summary><span>Evidence · ${summary}</span>${adverse?`<strong class="evidence-caution">${adverse}</strong>`:''}</summary>${body}${unknown}${!links.length?'<p class="empty">No current evidence relationship is available. Any withdrawn evidence remains in Scientific corrections history. Missing support does not establish a negative finding.</p>':''}</details>`;
}

export function renderApprovalEvidence(s, claim, pending) {
  const revision = s.revisions?.CLAIM?.[claim.claim_id] ?? null;
  const pairs = s.records ? evidenceFor(s, claim.claim_id) : [];
  const references = pairs.map(({ relation, source }) => ({
    id: relation.claim_source_id,
    revision: s.revisions?.CLAIM_SOURCE?.[relation.claim_source_id] ?? null,
    source_id: source.source_id,
    source_revision: s.revisions?.SOURCE?.[source.source_id] ?? null,
  }));
  const saved = pending?.approval_evidence;
  const sameEvidence = pending?.expected_claim_revision === revision &&
    saved?.length === references.length &&
    references.every(ref => saved.some(entry => Object.keys(ref).every(key => entry[key] === ref[key])));
  return `<fieldset class="section-space" aria-label="Evidence for approval"><legend>Evidence for approval</legend><p>For a Supported decision, choose the supporting relationships you relied on. Other evidence stays linked. Explain any recorded challenges or qualifications in your review.</p><input type="hidden" name="approval_fact_revision" value="${h(revision)}"><input type="hidden" name="approval_evidence_baseline" value="${h(JSON.stringify(references))}">${pairs.map(({ relation, source }, index) => {
    const ref = references[index];
    const eligible = relation.support_direction === 'SUPPORTS' && ref.revision !== null && ref.source_revision !== null;
    const checked = eligible && sameEvidence && saved.some(entry => entry.id === ref.id && entry.selected);
    return `<div>${renderEvidenceSummary(s, source, relation)}${eligible ? `<label class="approval-evidence-choice"><input type="checkbox" name="approval_evidence_choice" value="${h(ref.id)}"${checked ? ' checked' : ''}> Rely on ${h(source.title || ref.source_id)} for approval</label>` : '<p class="subtle">Available for review. Ineligible as supporting evidence.</p>'}<p class="subtle">Source ${h(ref.source_id)} · relationship ${h(ref.id)}</p></div>`;
  }).join('') || '<p>No evidence is linked. Attach evidence before certifying a review. New facts can still be submitted unreviewed.</p>'}</fieldset>`;
}

export function renderApprovalHistory(s, claim) {
  const reviews = (s.records?.ACTIVITY_LOG || [])
    .filter(log => log.entity_type === 'CLAIM' && log.entity_id === claim.claim_id)
    .map(log => log.authority_artifact?.payload?.operation?.review_artifact)
    .filter(review => Array.isArray(review?.approval_basis))
    .sort((a, b) => String(b.reviewed_at).localeCompare(String(a.reviewed_at)));
  return reviews.map(review => `<details class="secondary-details" data-approval-basis><summary>Evidence selected for approval · ${h(review.reviewed_at)}</summary><p>Reviewed fact revision ${h(review.prior_revision)} · ${h(s.team?.find(p => p.user_id === review.reviewer)?.display_name || review.reviewer)}</p><p>${h(review.proposal?.review_notes)}</p><p>${h(review.proposal?.basis_explanation)}</p><ul>${review.approval_basis.map(e => `<li>${h(e.data?.citation_override?.title || e.source?.data?.title || e.source?.id)} · source ${h(e.source?.id)} rev ${h(e.source?.revision)} · relationship ${h(e.id)} rev ${h(e.revision)}</li>`).join('')}</ul><p class="subtle">The complete evidence considered at that review remains in its activity record.</p></details>`).join('');
}

export function renderEvidenceDetails(
  s,
  id,
  claimId = null,
  relationId = null,
) {
  const source = s.records?.SOURCE?.find((x) => x.source_id === id);
  if (!source)
    return '<p class="empty">This source is not available in the current record. Your review inputs are unchanged.</p>';
  const links = (s.records?.CLAIM_SOURCE || []).filter(
    (x) => x.source_id === id,
  );
  const selected =
    links.find((x) => relationId && x.claim_source_id === relationId) ||
    links.find((x) => claimId && x.claim_id === claimId) ||
    links[0] ||
    {};
  const claim = s.records?.CLAIM?.find((x) => x.claim_id === selected.claim_id);
  const others = links.filter((x) => x !== selected);
  return `<section class="source-fact-context"><h3>The fact you are checking</h3><p dir="auto">${h(claim?.subject || "No fact relationship is recorded for this source.")}</p><p class="subtle">Decide whether this evidence answers this exact question. Support for one fact does not establish other facts.</p></section>${renderEvidenceCard(s, source, selected, true)}${others.length ? `<details class="secondary-details"><summary>Other linked facts (${others.length})</summary><ul>${others.map((x) => `<li dir="auto">${h(s.records.CLAIM.find((c) => c.claim_id === x.claim_id)?.subject || "Fact not available")} — ${h(relationship(x.support_direction)[0])}</li>`).join("")}</ul></details>` : ""}`;
}
