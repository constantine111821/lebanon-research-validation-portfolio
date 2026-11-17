import { csvCell } from "../approved/phase2-data.js";
import { zipFiles } from "../../../../packages/domain/src/research-export.mjs";

const maxCellCharacters = 32767;
const maxCellLineBreaks = 253;
const maxSheetRows = 1048576;
const maxSheetColumns = 16384;
const maxSheetHyperlinks = 65530;
export const arcgisTextWidth = 240;
const mainNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageRelationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const gridPreviewHeight = 106;
const groupedRowHeight = 118;
const sheetName = "Periodical data";

export class PeriodicalSpreadsheetLimitError extends Error {
  /** @param {string} message @param {string | null} cell */
  constructor(message, cell = null) {
    super(message);
    this.name = "PeriodicalSpreadsheetLimitError";
    this.code = "PERIODICAL_SPREADSHEET_LIMIT";
    this.cell = cell;
  }
}

/** @typedef {{text: string, status?: "validated" | "attention", number?: number, hyperlink?: {url: string}}} PeriodicalCell */
/** @typedef {{maxBytes?: number, checkBudget?: () => void}} SerializationOptions */
/** @typedef {{start: number, end: number, label: string}} ColumnGroup */
/** @typedef {{title: string, scope: string, exportedOn: string, capturedAt?: string, summary?: string, instructions?: string}} WorkbookMetadata */
/** @typedef {SerializationOptions & {metadata?: WorkbookMetadata, outlineGroups?: ColumnGroup[], columnWidths?: Record<string, number>}} WorkbookOptions */

function columnName(index) {
  let name = "";
  for (let position = index + 1; position > 0; position = Math.floor((position - 1) / 26))
    name = String.fromCharCode(65 + ((position - 1) % 26)) + name;
  return name;
}

// Excel, Calc, and other spreadsheet readers may treat imported text as a formula.
// The existing CSV encoder quotes all cells. Also guard full-width formula markers
// and Unicode format characters which a spreadsheet may ignore at the start.
function safeCsvText(text) {
  return /^[\s\p{Cf}]*[=+\-@\uff1d\uff0b\uff0d\uff20\t\r\n]/u.test(text)
    ? "'" + text
    : text;
}

function cellText(text, cell) {
  if (typeof text !== "string") throw new TypeError("Periodical export requires text in " + cell + ".");
  if (safeCsvText(text).length > maxCellCharacters)
    throw new PeriodicalSpreadsheetLimitError("Cell " + cell + " exceeds the spreadsheet limit of 32,767 characters. The export stopped to preserve the full evidence.", cell);
  if (text.split(/\r\n|[\r\n]/).length > maxCellLineBreaks + 1)
    throw new PeriodicalSpreadsheetLimitError("Cell " + cell + " exceeds the spreadsheet limit of 253 line breaks. The export stopped to preserve the full evidence.", cell);
  if (!text.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/u.test(text))
    throw new PeriodicalSpreadsheetLimitError("Cell " + cell + " contains a character that cannot be preserved in the workbook. The export stopped without removing the text.", cell);
  return text;
}

function escapeXml(text) {
  // SpreadsheetML interprets this pattern even in inline text. Escape the
  // leading underscore of a literal pattern to keep the saved text visible.
  return escapeXmlAttribute(text.replace(/_(?=x[\da-f]{4}_)/gi, "_x005F_"));
}

function escapeXmlAttribute(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("\r", "&#13;");
}

function appendWithinBudget(parts, maxBytes) {
  let size = 0;
  return (part, destination = parts, overhead = 0) => {
    size += Buffer.byteLength(part, "utf8") + overhead;
    if (size > maxBytes)
      throw new PeriodicalSpreadsheetLimitError("This shared snapshot exceeds the download size limit. The export stopped to preserve the full evidence.");
    destination.push(part);
  };
}

function validateDimensions(headers, rows, headerRow = 1) {
  if (headers.length === 0 || headers.length > maxSheetColumns || rows.length + headerRow > maxSheetRows)
    throw new PeriodicalSpreadsheetLimitError("This shared snapshot exceeds the spreadsheet row or column limit.");
}

function verifyRow(row, headers) {
  if (row.length !== headers.length) throw new TypeError("Periodical export row does not match its headers.");
}

/** @param {string[]} headers @param {PeriodicalCell[][]} rows @param {SerializationOptions} options */
export function periodicalCsv(headers, rows, { maxBytes = Infinity, checkBudget = () => {} } = {}) {
  validateDimensions(headers, rows);
  const parts = [];
  const append = appendWithinBudget(parts, maxBytes);
  const columns = headers.map((_, index) => columnName(index));
  append("\ufeff");
  append(headers.map((header, index) => csvCell(safeCsvText(cellText(header, columns[index] + "1")))).join(",") + "\r\n");
  for (const [index, row] of rows.entries()) {
    checkBudget();
    verifyRow(row, headers);
    const number = index + 2;
    append(row.map(({ text }, column) => csvCell(safeCsvText(cellText(text, columns[column] + number)))).join(",") + "\r\n");
  }
  return parts.join("");
}

/** @param {string[]} headers @param {(string | number)[][]} rows @param {SerializationOptions} options */
export function periodicalArcgisCsv(headers, rows, { maxBytes = Infinity, checkBudget = () => {} } = {}) {
  const parts = [];
  const append = appendWithinBudget(parts, maxBytes);
  append("\ufeff" + headers.map(csvCell).join(",") + "\r\n");
  for (const [index, row] of rows.entries()) {
    checkBudget();
    verifyRow(row, headers);
    append(row.map((value, column) => {
      const address = columnName(column) + (index + 2);
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new TypeError("ArcGIS field " + address + " requires a finite numeric value.");
        return String(value);
      }
      const text = safeCsvText(cellText(value, address));
      if (Buffer.byteLength(text, "utf8") > arcgisTextWidth)
        throw new PeriodicalSpreadsheetLimitError("ArcGIS field " + address + " exceeds the " + arcgisTextWidth + "-byte compatibility limit. The export stopped without truncating any fields.", address);
      return csvCell(text);
    }).join(",") + "\r\n");
  }
  return parts.join("");
}

const contentTypes = `${xmlDeclaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
const rootRelationships = `${xmlDeclaration}<Relationships xmlns="${packageRelationshipNamespace}">
  <Relationship Id="rId1" Type="${relationshipNamespace}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
const workbook = `${xmlDeclaration}<workbook xmlns="${mainNamespace}" xmlns:r="${relationshipNamespace}">
  <bookViews><workbookView activeTab="0"/></bookViews>
  <sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
const workbookRelationships = `${xmlDeclaration}<Relationships xmlns="${packageRelationshipNamespace}">
  <Relationship Id="rId1" Type="${relationshipNamespace}/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="${relationshipNamespace}/styles" Target="styles.xml"/>
</Relationships>`;
const alignment = '<alignment vertical="top" wrapText="1"/>';
const supportedFills = [0, 3, 4];
function valueStyles(fontId, numFmtId) {
  return supportedFills.map(fillId =>
    `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1">${alignment}</xf>`).join("");
}
const styles = `${xmlDeclaration}<styleSheet xmlns="${mainNamespace}">
  <fonts count="5">
    <font><sz val="11"/><color rgb="FF202428"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF263C36"/><name val="Calibri"/></font>
    <font><u/><sz val="11"/><color rgb="FF124A68"/><name val="Calibri"/></font>
  </fonts>
  <fills count="7">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF203548"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE9F0ED"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF285D55"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="13">
    <xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1">${alignment}</xf>
    <xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1">${alignment}</xf>
    <xf numFmtId="49" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyAlignment="1">${alignment}</xf>
    <xf numFmtId="49" fontId="0" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyAlignment="1">${alignment}</xf>
    <xf numFmtId="49" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="49" fontId="3" fillId="5" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    ${valueStyles(4, 49)}
    ${valueStyles(0, 0)}
    <xf numFmtId="49" fontId="1" fillId="6" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1">${alignment}</xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function xlsxCell(text, address, style) {
  return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function columnWidth(header, grouped, isHidden) {
  if (isHidden || /\bexcerpt\b/i.test(header)) return 60;
  if (grouped && /\bcitations?\b/i.test(header)) return 22;
  if (/\bcitations?\b/i.test(header)) return 52;
  if (header === "Facility") return 29;
  if (header === "Event ID") return 24;
  return Math.min(38, Math.max(23, header.length + 6));
}

function indexColumnGroups(groups, headers) {
  const summaries = new Map();
  const hidden = new Set();
  let previousEnd = -1;
  for (const { start, end, label } of groups) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 ||
        start - 1 <= previousEnd || end < start || end >= headers.length || typeof label !== "string" || !label.trim())
      throw new TypeError("Periodical Excel column groups must be ordered, disjoint, and have visible named summary columns.");
    summaries.set(start - 1, label);
    for (let column = start; column <= end; column++) hidden.add(column);
    previousEnd = end;
  }
  return { summaries, hidden };
}

function externalSourceUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || [...url.searchParams.keys()].some(key =>
      /^(?:access[_-]?token|id[_-]?token|token|api[_-]?key|signature|sig|x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential))$/i.test(key))) return null;
    return value;
  } catch {
    return null;
  }
}

function worksheetLinks(append, relPath) {
  const relationships = [];
  const links = [];
  const urlIds = new Map();
  function add(address, href) {
    const destination = externalSourceUrl(href?.url);
    if (!destination) return false;
    if (links.length >= maxSheetHyperlinks)
      throw new PeriodicalSpreadsheetLimitError("This shared snapshot exceeds Excel's hyperlink limit. The export stopped to preserve the full evidence.");
    if (!relationships.length)
      append(`${xmlDeclaration}<Relationships xmlns="${packageRelationshipNamespace}">`, relationships, zipEntryOverhead(relPath));
    if (!urlIds.has(destination)) {
      const id = `rId${urlIds.size + 1}`;
      append(`<Relationship Id="${id}" Type="${relationshipNamespace}/hyperlink" Target="${escapeXmlAttribute(destination)}" TargetMode="External"/>`, relationships);
      urlIds.set(destination, id);
    }
    append(`<hyperlink ref="${address}" r:id="${urlIds.get(destination)}"/>`, links);
    return true;
  }
  return { add, relationships, links };
}

function zipEntryOverhead(name) {
  return 76 + 2 * Buffer.byteLength(name);
}

/**
 * @param {string[]} headers
 * @param {(string | number)[][]} rows
 * @param {SerializationOptions & { csvFilename: string, schema: string }} options
 */
export function periodicalArcgisZip(headers, rows, { csvFilename, schema, maxBytes = Infinity, checkBudget = () => {} }) {
  const schemaFilename = "schema.ini";
  const overhead = 22 + zipEntryOverhead(csvFilename) + zipEntryOverhead(schemaFilename) + Buffer.byteLength(schema);
  const csv = periodicalArcgisCsv(headers, rows, { maxBytes: maxBytes - overhead, checkBudget });
  checkBudget();
  const archive = zipFiles({ [csvFilename]: csv, [schemaFilename]: schema });
  checkBudget();
  return archive;
}

function rowHeight(row, widths, maxHeight) {
  const estimatedLines = row.map(({ text }, index) => text.split(/\r\n|[\r\n]/).reduce((count, line) =>
    count + Math.max(1, Math.ceil(line.length / (0.82 * widths[index]))), 0));
  return Math.min(maxHeight, Math.max(34, Math.ceil(14 * Math.max(...estimatedLines) + 5)));
}

function sheetView(headerRow, freezeColumns) {
  const firstRow = headerRow + 1;
  const start = `${columnName(freezeColumns)}${firstRow}`;
  const activePane = freezeColumns ? "bottomRight" : "bottomLeft";
  const frozenColumns = freezeColumns ? `xSplit="${freezeColumns}" ` : "";
  return `<sheetView workbookViewId="0" zoomScale="100" zoomScaleNormal="100"><pane ${frozenColumns}ySplit="${headerRow}" topLeftCell="${start}" activePane="${activePane}" state="frozen"/>` +
    `<selection pane="${activePane}" activeCell="${start}" sqref="${start}"/></sheetView>`;
}

function workbookIntro(metadata, columns, widths, hidden, grouped) {
  const first = [0, columns.length > 1 && !hidden.has(1) ? 1 : 0];
  const twoBands = (metadata.summary || metadata.instructions || metadata.capturedAt) &&
    columns.length > 2 && !hidden.has(2);
  const second = [2, columns.length > 3 && !hidden.has(3) ? 3 : 2];
  const scope = `Scope: ${metadata.scope}`;
  const snapshot = `Snapshot date: ${metadata.exportedOn}`;
  const timing = metadata.capturedAt ? `${snapshot}\nCaptured ${metadata.capturedAt}` : snapshot;
  const instructions = metadata.instructions || (grouped
    ? "Select + above a heading to see all sources and full saved excerpts."
    : "Select a long cell and expand the formula bar to read it in full.");
  const region = (text, [start, end], style = 5) => ({ text, start, end, style });
  const bands = [
    [region(metadata.title, first, 4)],
    twoBands ? [region(timing, first), region(scope, second)] : [region(`${scope} · ${timing}`, first)],
    twoBands && metadata.summary
      ? [region(metadata.summary, first), region(instructions, second)]
      : [region([metadata.summary, instructions].filter(Boolean).join("\n"), first)],
  ];
  const merges = [];
  const rows = bands.map((band, index) => {
    const row = index + 1;
    let height = 30;
    const cells = band.map(({ text, start, end, style }) => {
      const startAddress = columns[start] + row;
      if (start !== end) merges.push(`<mergeCell ref="${startAddress}:${columns[end]}${row}"/>`);
      const availableWidth = widths.slice(start, end + 1).reduce((sum, width) => sum + width, 0);
      const inTitle = style === 4;
      const charsPerLine = availableWidth * (inTitle ? 0.65 : 0.9);
      const lineCount = text.split(/\r\n|[\r\n]/).reduce((sum, line) =>
        sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
      height = Math.max(height, Math.min(118, Math.ceil(lineCount * (inTitle ? 21 : 13) + 7)));
      return xlsxCell(cellText(text, startAddress), startAddress, style);
    });
    return `<row r="${row}" ht="${height}" customHeight="1">${cells.join("")}</row>`;
  });
  return { rows, merges };
}

/** @param {string[]} headers @param {PeriodicalCell[][]} rows @param {WorkbookOptions} options */
export function periodicalXlsx(headers, rows, { maxBytes = Infinity, checkBudget = () => {}, metadata, outlineGroups = [], columnWidths = {} } = {}) {
  const headerRow = metadata ? 4 : 1;
  validateDimensions(headers, rows, headerRow);
  const files = {
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": rootRelationships,
    "xl/workbook.xml": workbook,
    "xl/_rels/workbook.xml.rels": workbookRelationships,
    "xl/styles.xml": styles,
  };
  const initialBytes = Object.entries(files).reduce((bytes, [name, part]) =>
    bytes + Buffer.byteLength(part, "utf8") + zipEntryOverhead(name), 22);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const relPath = "xl/worksheets/_rels/sheet1.xml.rels";
  const parts = [];
  const append = appendWithinBudget(parts, maxBytes - initialBytes - zipEntryOverhead(sheetPath));
  const columns = headers.map((_, index) => columnName(index));
  const lastRow = rows.length + headerRow;
  const last = `${columns.at(-1)}${lastRow}`;
  const grouped = outlineGroups.length > 0;
  const { summaries, hidden } = indexColumnGroups(outlineGroups, headers);
  const widths = headers.map((header, index) => {
    const width = Object.hasOwn(columnWidths, header) ? columnWidths[header] : columnWidth(header, grouped, hidden.has(index));
    if (!Number.isFinite(width) || width < 8 || width > 255)
      throw new RangeError("Periodical Excel column width must be between 8 and 255.");
    return width;
  });
  const cols = widths.map((width, index) => {
    const outline = hidden.has(index) ? ' hidden="1" outlineLevel="1"' : summaries.has(index) ? ' collapsed="1"' : "";
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"${outline}/>`;
  });
  const { add, relationships, links } = worksheetLinks(append, relPath);
  const freezeColumns = metadata && headers[0] === "Facility" && headers[1] === "Event ID" && headers.length > 2 ? 2 : 0;
  const intro = metadata ? workbookIntro(metadata, columns, widths, hidden, grouped) : null;
  append(`${xmlDeclaration}<worksheet xmlns="${mainNamespace}" xmlns:r="${relationshipNamespace}">
  ${grouped ? '<sheetPr><outlinePr summaryRight="0" showOutlineSymbols="1"/></sheetPr>' : ""}<dimension ref="A1:${last}"/>
  <sheetViews>${sheetView(headerRow, freezeColumns)}</sheetViews>
  <sheetFormatPr defaultRowHeight="15"${grouped ? ' outlineLevelCol="1"' : ""}/><cols>${cols.join("")}</cols><sheetData>`);
  if (intro) append(intro.rows.join(""));
  const head = headers.map((text, index) => {
    const address = columns[index] + headerRow;
    return xlsxCell(cellText(summaries.get(index) ?? text, address), address, summaries.has(index) ? 12 : 1);
  });
  append(`<row r="${headerRow}" ht="${grouped ? 40 : 34}" customHeight="1">${head.join("")}</row>`);
  for (const [index, row] of rows.entries()) {
    checkBudget();
    verifyRow(row, headers);
    const number = index + headerRow + 1;
    const cells = row.map(({ text, status, number: numericValue, hyperlink }, column) => {
      const address = columns[column] + number;
      const fill = status === "validated" ? 1 : status === "attention" ? 2 : 0;
      const linked = add(address, hyperlink);
      if (numericValue !== undefined) {
        if (!Number.isFinite(numericValue) || linked)
          throw new TypeError("Periodical numeric cells require a finite value and no hyperlink at " + address + ".");
        return `<c r="${address}" s="${9 + fill}" t="n"><v>${numericValue}</v></c>`;
      }
      const style = linked ? 6 + fill : fill ? fill + 1 : 0;
      return xlsxCell(cellText(text, address), address, style);
    });
    const maxHeight = grouped ? groupedRowHeight : metadata ? gridPreviewHeight : 409;
    append(`<row r="${number}" ht="${rowHeight(row, widths, maxHeight)}" customHeight="1">${cells.join("")}</row>`);
  }
  append(`</sheetData><autoFilter ref="A${headerRow}:${last}"/>`);
  if (intro?.merges.length)
    append(`<mergeCells count="${intro.merges.length}">${intro.merges.join("")}</mergeCells>`);
  if (links.length) {
    append("<hyperlinks>");
    parts.push(...links); // Link bytes were reserved when collected.
    append("</hyperlinks>");
  }
  append("</worksheet>");
  if (relationships.length) {
    append("</Relationships>", relationships);
    files[relPath] = relationships.join("");
  }
  checkBudget();
  return zipFiles({ ...files, [sheetPath]: parts.join("") }, { officeWorkbook: true });
}
