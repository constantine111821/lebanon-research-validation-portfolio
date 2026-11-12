// CSV parser used to verify transport bytes independently of the export projection.
export function parseCsv(text) {
  const input = text.replace(/^\uFEFF/u, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === '"') {
      if (cell !== "" || closed) throw new Error("CSV_UNEXPECTED_QUOTE");
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      closed = false;
    } else {
      if (closed) throw new Error("CSV_TRAILING_QUOTED_CONTENT");
      cell += c;
    }
  }
  if (quoted) throw new Error("CSV_UNCLOSED_QUOTE");
  if (cell !== "" || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) throw new Error("CSV_EMPTY");
  const [fields, ...values] = rows;
  if (new Set(fields).size !== fields.length)
    throw new Error("CSV_DUPLICATE_FIELD");
  if (values.some((r) => r.length !== fields.length))
    throw new Error("CSV_ROW_WIDTH");
  return {
    fields,
    rows: values.map((r) =>
      Object.fromEntries(fields.map((f, i) => [f, r[i]])),
    ),
  };
}

export function serializeCsv(fields, rows) {
  const cell = (value) =>
    /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return `${[fields, ...rows.map((row) => fields.map((field) => row[field]))].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
