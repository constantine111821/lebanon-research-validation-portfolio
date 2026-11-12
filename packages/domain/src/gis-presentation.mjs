// Revision 004 content hierarchy, generated only from the eligible export projection.
// No network calls, credentials, snapshot/draft access or geographic decisions.
import { canonicalJSON, checksum, GISIntegrityError } from "./gis-export.mjs";
import { isIP } from "node:net";
import { parseCsv } from "./gis-csv-read.mjs";
export const PRESENTATION_VERSION = "1.0.0-r004";
export const MAX_ARCADE_BYTES = 256 * 1024; // local safety policy, NOT an Esri capacity claim
export const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const effects = new Set([
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
]);
const directions = {
  SUPPORTS: "Supports",
  CONTRADICTS: "Challenges",
  LIMITS: "Qualifies",
  CONTEXT_ONLY: "Context",
};
const requireOK = (value, code = "GIS_PRESENTATION_BINDING_MISMATCH") => {
  if (!value) throw new GISIntegrityError(code);
};
const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const display = (v) =>
  v == null
    ? "Not recorded"
    : Array.isArray(v)
      ? v.map(display).join("; ")
      : typeof v === "object"
        ? Object.entries(v)
            .filter(([, x]) => x != null)
            .map(([k, x]) => `${k.replaceAll("_", " ")}: ${display(x)}`)
            .join("; ")
        : typeof v === "boolean"
          ? v
            ? "Yes"
            : "No"
          : String(v);
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function date(v) {
  return String(v).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (raw, y, m, d) => {
    const n = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(n.valueOf()) || n.toISOString().slice(0, 10) !== raw
      ? raw
      : `${Number(d)} ${months[Number(m) - 1]} ${y}`;
  });
}
function value(f) {
  if (f.value == null) return "Not established in the recorded evidence";
  if (typeof f.value === "boolean") {
    const labels = {
      EVACUATION: ["No evacuation explicitly reported", "Evacuation reported"],
      IDENTITY: [
        "Facility identity not established by this finding",
        "Facility identity documented",
      ],
      KINETIC_EVENT: [
        "Explicit evidence of no attack occurrence",
        "Attack occurrence documented",
      ],
    };
    if (labels[f.claim_family]) return labels[f.claim_family][Number(f.value)];
  }
  if (f.claim_family === "ATTACK_RELATIONSHIP" && f.value === "EXACT_TARGET")
    return "This physical facility is identified as directly affected";
  if (f.claim_family === "FACILITY_TYPE" && f.value === "hospital")
    return "Hospital";
  if (f.claim_family === "EVENT_DATE") {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(f.value)))
      return `${months[Number(f.value.slice(5)) - 1]} ${f.value.slice(0, 4)} (day not established)`;
    return date(display(f.value));
  }
  return display(f.value);
}
export function safeSourceURL(v) {
  if (typeof v !== "string" || /[\s\\\u0000-\u001f]/.test(v)) return null;
  try {
    const u = new URL(v),
      h = u.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      !h.includes(".") ||
      isIP(h) ||
      h.includes(":") ||
      /^[\d.]+$/.test(h) ||
      /(^|\.)(localhost|invalid|local|test)$/.test(h)
    )
      return null;
    return v;
  } catch {
    return null;
  }
}
function approvedLinks(output, receipt) {
  if (!receipt) return new Set(); // Fail closed: no per-export verification, no active source links.
  requireOK(
    receipt.snapshot_sha256 === output.receipt.content_sha256 &&
      Array.isArray(receipt.validated_sources),
  );
  const recorded = new Set(
    output.features.flatMap((f) =>
      f.facts.flatMap((f) =>
        f.citations
          .filter(
            (c) =>
              c.public_url &&
              [c.source.original_url, c.source.canonical_url].includes(
                c.public_url,
              ),
          )
          .map((c) => JSON.stringify([c.source_id, c.public_url])),
      ),
    ),
  );
  return new Set(
    receipt.validated_sources.map((x) => {
      requireOK(
        x.status === "USABLE" &&
          typeof x.checked_on === "string" &&
          !Number.isNaN(Date.parse(x.checked_on)) &&
          typeof x.evidence === "string" &&
          x.evidence.trim() &&
          safeSourceURL(x.url) === x.url &&
          recorded.has(JSON.stringify([x.source_id, x.url])),
        "GIS_SOURCE_LINK_VALIDATION_INVALID",
      );
      return JSON.stringify([x.source_id, x.url]);
    }),
  );
}
export function renderIncident(f, links = new Set()) {
  const parts = [
    `<p>Incident profile</p><h2>${esc(f.facility_name)}</h2><p>${esc(date(f.date_display))}</p><p>${esc(String(f.facility_type).replace(/^./, (c) => c.toUpperCase()))} · ${esc(f.incident_classification)}<br>${esc(f.locality)}</p>`,
  ];
  if (
    f.date_limitation &&
    f.date_limitation !== "MISSING_OR_UNVALIDATED_EVENT_DATE"
  )
    parts.push(`<p>${esc(display(f.date_limitation))}</p>`);
  for (const [heading, key] of [
    ["Key findings", true],
    ["Additional findings", false],
  ]) {
    const facts = f.facts.filter((x) => effects.has(x.claim_family) === key);
    if (!facts.length) continue;
    parts.push(`<h3>${heading}</h3>`);
    for (const fact of facts) {
      parts.push(
        `<div><p><strong>${esc(fact.claim_family === "ATTACK_RELATIONSHIP" ? "Facility relationship" : fact.label)}</strong> <span dir="auto">${esc(value(fact))}</span></p>`,
      );
      const notes = [];
      for (const [k, label] of [
        ["scope", "Scope"],
        ["impact_basis", "Basis"],
        ["quantitative_unit", "Unit"],
      ])
        if (fact[k] != null) notes.push(`${label}: ${display(fact[k])}`);
      if (fact.evidence_state && fact.evidence_state !== "SUPPORTED")
        notes.push("Evidence status: " + fact.evidence_state);
      if (fact.date_precision && fact.date_precision !== "DAY")
        notes.push("Date precision: " + fact.date_precision.toLowerCase());
      if (
        fact.claim_family === "ATTACK_RELATIONSHIP" &&
        fact.value === "EXACT_TARGET"
      )
        notes.push("This relationship does not establish intent to attack.");
      if (
        fact.citations.some((c) =>
          ["CONTRADICTS", "LIMITS"].includes(c.support_direction),
        )
      )
        notes.push(
          "The recorded finding has challenging or qualifying evidence; see the sources below.",
        );
      if (notes.length) parts.push(`<p>${esc(notes.join(" · "))}</p>`);
      for (const c of fact.citations) {
        requireOK(
          Object.hasOwn(directions, c.support_direction),
          "GIS_PRESENTATION_UNKNOWN_DIRECTION",
        );
        const s = c.source;
        let title = esc(s.title || "Untitled source");
        if (
          links.has(JSON.stringify([c.source_id, c.public_url])) &&
          safeSourceURL(c.public_url)
        )
          title = `<a href="${esc(c.public_url)}" target="_blank" rel="noopener noreferrer">${title}</a>`;
        const type =
          {
            news: "News",
            dataset: "Dataset",
            video: "Video",
            photograph: "Photograph",
          }[s.source_type] ||
          s.source_type ||
          "Type not recorded";
        parts.push(
          `<div><p>${title}</p><p>${esc(type)} · ${directions[c.support_direction]}</p>`,
        );
        if (key || ["CONTRADICTS", "LIMITS"].includes(c.support_direction))
          for (const p of c.passages || []) {
            if (
              p.text &&
              (p.text.length <= 180 ||
                ["CONTRADICTS", "LIMITS"].includes(c.support_direction))
            )
              parts.push(`<p dir="auto">“${esc(p.text)}”</p>`);
            else if (p.text && p.ref?.locator)
              parts.push(
                `<p>Passage reference: ${esc(display(p.ref.locator))}</p>`,
              );
          }
        parts.push("</div>");
        const caveats = [
          c.limitations,
          s.limitations,
          ...(c.citation_gaps || []).filter(
            (x) => x !== "PUBLIC_URL_UNAVAILABLE_OR_INVALID",
          ),
        ]
          .filter(Boolean)
          .map(display)
          .map((x) =>
            x
              .replace(
                "DISPOSABLE GIS ACCEPTANCE FIXTURE; NOT REAL RESEARCH",
                "",
              )
              .replace(/^[; ]+|[; ]+$/g, ""),
          );
        if (caveats.some(Boolean))
          parts.push(
            `<p>${esc([...new Set(caveats.filter(Boolean))].join("; "))}</p>`,
          );
      }
      if (!fact.citations.length) parts.push("<p>No source recorded.</p>");
      parts.push("</div>");
    }
  }
  parts.push(
    "<p>Source relationships do not establish independent corroboration. Unreported service or restoration effects remain unknown.</p>",
  );
  return parts.join("\n");
}
// ZIP32 STORE with fixed DOS timestamp/order: deterministic, no extra dependency or compression spikes.
function crc32(b) {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function zipFiles(files) {
  const local = [],
    central = [];
  let offset = 0;
  for (const name of Object.keys(files).sort()) {
    const n = Buffer.from(name),
      b = Buffer.from(files[name]),
      crc = crc32(b),
      h = Buffer.alloc(30),
      d = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(33, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    d.writeUInt32LE(0x02014b50);
    d.writeUInt16LE(20, 4);
    d.writeUInt16LE(20, 6);
    d.writeUInt16LE(33, 14);
    d.writeUInt32LE(crc, 16);
    d.writeUInt32LE(b.length, 20);
    d.writeUInt32LE(b.length, 24);
    d.writeUInt16LE(n.length, 28);
    d.writeUInt32LE(offset, 42);
    local.push(h, n, b);
    central.push(d, n);
    offset += h.length + n.length + b.length;
  }
  const end = Buffer.alloc(22),
    size = central.reduce((s, b) => s + b.length, 0);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
/** @param {any} output @param {{generatedAt?: string|null, linkValidation?: any}} options */
export function buildPresentationPackage(
  output,
  { generatedAt = null, linkValidation = null } = {},
) {
  const r = output.receipt;
  requireOK(
    r?.mode === "full" && output.csv && r.snapshot_version && r.app_commit,
    "GIS_PRESENTATION_FULL_EXPORT_REQUIRED",
  );
  requireOK(
    checksum(output.csv) === r.content_sha256 &&
      Buffer.byteLength(output.csv) === r.content_length_bytes &&
      checksum(canonicalJSON(output.features)) === r.semantic_sha256,
  );
  requireOK(
    output.features.length === r.row_count &&
      canonicalJSON(output.features.map((f) => f.feature_id)) ===
        canonicalJSON(r.feature_ids) &&
      new Set(r.feature_ids).size === r.row_count,
  );
  const parsed = parseCsv(output.csv);
  requireOK(
    canonicalJSON(parsed.fields) === canonicalJSON(r.columns) &&
      parsed.rows.length === output.features.length,
  );
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i],
      f = output.features[i];
    const chunks = parsed.fields
      .filter((k) => /^evidence_\d+$/.test(k))
      .sort()
      .map((k) => row[k])
      .filter(Boolean);
    requireOK(chunks.length && chunks.every((x) => x.startsWith("text:")));
    const evidence = JSON.parse(chunks.map((x) => x.slice(5)).join(""));
    requireOK(
      row.feature_id === f.feature_id &&
        evidence.feature_id === f.feature_id &&
        canonicalJSON(evidence.facts) === canonicalJSON(f.facts) &&
        evidence.date_limitation === f.date_limitation,
    );
    for (const k of [
      "facility_name",
      "date_display",
      "facility_type",
      "locality",
      "incident_classification",
    ])
      requireOK(row[k] === String(f[k] ?? ""));
  }
  requireOK(
    generatedAt === null ||
      (typeof generatedAt === "string" &&
        !Number.isNaN(Date.parse(generatedAt))),
  );
  const links = approvedLinks(output, linkValidation),
    cards = Object.fromEntries(
      output.features.map((f) => [f.feature_id, renderIncident(f, links)]),
    );
  const expression = `Expects($feature, "feature_id");\nvar cards = FromJSON(${JSON.stringify(canonicalJSON(cards))});\nvar key = Text($feature.feature_id);\nif (!HasKey(cards,key)) return {type:"text",text:"Presentation unavailable: use the matching verified export package."};\nreturn {type:"text",text:cards[key]};\n`;
  requireOK(
    Buffer.byteLength(expression) <= MAX_ARCADE_BYTES,
    "GIS_PRESENTATION_CAPACITY_EXCEEDED",
  );
  const popup = {
    title: "{facility_name}",
    popupElements: [
      {
        type: "expression",
        expressionInfo: {
          title: "Fact and source presentation",
          expression,
          returnType: "dictionary",
        },
      },
    ],
  };
  const json = (v) => JSON.stringify(v, null, 2) + "\n";
  // Do not bundle the full export receipt: its exclusions contain unapproved IDs.
  const manifest = {
    format: "rvw-full-fact-presentation-package",
    version: 1,
    generator_version: PRESENTATION_VERSION,
    export_schema_version: r.schema_version,
    app_commit: r.app_commit,
    snapshot_version: r.snapshot_version,
    csv_sha256: r.content_sha256,
    semantic_sha256: r.semantic_sha256,
    configuration_sha256: checksum(json(popup)),
    feature_ids: r.feature_ids,
    columns: r.columns,
    feature_count: r.row_count,
    fact_count: output.features.reduce((n, f) => n + f.facts.length, 0),
    relationship_count: output.features.reduce(
      (n, f) => n + f.facts.reduce((n, x) => n + x.citations.length, 0),
      0,
    ),
    generated_at: generatedAt,
    generation_time_meaning:
      "Receipt metadata only, never event chronology. Null means reproducible content-addressed generation; response Date records delivery time.",
    link_policy:
      "Exact recorded source_id and public_url, matching original/canonical URL; public HTTP(S), no local/synthetic/IP destinations; explicit snapshot-bound USABLE validation required. No automatic network validation.",
    link_validation: linkValidation || {
      snapshot_sha256: r.content_sha256,
      validated_sources: [],
    },
    strategy:
      "Regenerated snapshot lookup; bounded at 256 KiB Arcade and 16 MiB package. Not a production scale claim.",
    runtime_attribute_retention:
      "UNVERIFIED; verify independently of the lookup before scientific GIS acceptance.",
  };
  const files = {
    "scientific.csv": output.csv,
    "popupInfo.json": json(popup),
    "presentation.arcade": expression,
    "manifest.json": json(manifest),
    "README.txt": GUIDE,
  };
  files["SHA256SUMS.txt"] = Object.keys(files)
    .sort()
    .map((k) => `${checksum(files[k])}  ${k}\n`)
    .join("");
  requireOK(
    Object.values(files).reduce((n, x) => n + Buffer.byteLength(x), 0) <=
      MAX_PACKAGE_BYTES - 4096,
    "GIS_PRESENTATION_CAPACITY_EXCEEDED",
  );
  const bytes = zipFiles(files);
  return {
    bytes,
    files,
    manifest,
    filename: output.filename.replace(".csv", ".presentation.zip"),
    receipt: {
      generated_at: generatedAt,
      content_sha256: checksum(bytes),
      content_length_bytes: bytes.length,
      snapshot_version: r.snapshot_version,
    },
  };
}
const GUIDE = `Full Fact scientific CSV + matching ArcGIS presentation\n\nThis package contains only the current eligible scientific projection. Importing a CSV does NOT install popup styling. No ArcGIS credentials were used to generate it.\n\n1. Verify SHA256SUMS.txt before use. Keep scientific.csv unchanged and retain manifest.json. Null generated_at is intentional for reproducible generation; use the download time as delivery metadata only.\n2. Import scientific.csv using an authorized private CSV workflow: WGS84 Longitude/Latitude, calendar dates without invented timezone/day precision. Do not publish a hosted layer or change sharing without separate authorization. Check the complete feature count, all fields, long continuation values and coordinates. Empty date fields remain unknown.\n3. Before configuration application, authenticate separately in your approved ArcGIS environment. Retrieve and back up the intended private web-map JSON and metadata. Verify ownership and the exact linked CSV item. Download that linked CSV and require its SHA-256 to equal manifest.csv_sha256. Never match by feature_id alone. Stop on any mismatch, edits or drift.\n4. Deep-copy that map JSON, replace ONLY the intended CSV operational layer's popupInfo with popupInfo.json. Verify a structural diff with no other change. Use the supported Item.update(item_properties={text: serialized_json}) only under separate exact owner authorization. Do not copy an entire map template or edit the dataset.\n5. Read back and compare the complete map, confirm private sharing, reopen and inspect representative facts, all four relationship directions, unknown dates and Arabic. A lookup popup is not evidence that transport fields survived import. Independently query CSVLayer runtime values before scientific acceptance.\n6. Regenerate and reapply the companion whenever the export changes, even if feature IDs are identical. This is a snapshot-bound configuration, not live synchronization.\n\nSource titles remain plain text unless exact source destinations have an explicit snapshot-bound usable-link verification receipt. No source is omitted; URLs and stable fact/source/relationship IDs remain in the CSV. Do not invent replacement URLs. The website does not fetch URLs or send research to an external validator.\n\nLimits: bounded lookup, not proven scalable beyond its measured envelope; missing or oversized packages fail without dropping findings. CSV downloads remain separate. Actual hosted download capacity and imported attribute retention require their own acceptance tests. Software delivery is not scientific approval.\n`;
