/**
 * CSV serialisation for exported tables, and the reader that takes one back.
 *
 * Written by hand rather than pulled in: the whole job is quoting, and the rules are short
 * enough that a dependency would cost more to audit than to implement.
 */

/**
 * Quotes a single field per RFC 4180. A field is wrapped when it contains a delimiter, a
 * quote, or a newline, and embedded quotes are doubled. A leading `=`, `+`, `-` or `@` is
 * additionally prefixed with a quote character, because spreadsheet applications otherwise
 * read the value as a formula - a field like `=1+1` is data here, not arithmetic.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;

  if (/["\n\r,]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Renders rows as a CSV document, header row included, with CRLF line endings. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((column) => escapeCsvField(column.header)).join(',')];

  rows.forEach((row) => {
    lines.push(columns.map((column) => escapeCsvField(column.value(row))).join(','));
  });

  return lines.join('\r\n');
}

/**
 * Hands the reader a file. Object URLs are revoked on the next tick rather than immediately,
 * since revoking before the browser has started the download cancels it.
 */
export function downloadTextFile(filename: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * One record from a CSV document, with the line it started on.
 *
 * The line number is carried rather than recomputed because a quoted field may contain
 * newlines of its own: a reader told "row 12" has to count records, while "line 27" is
 * something they can go and look at in the file they are holding.
 */
export interface CsvRecord {
  line: number;
  cells: string[];
}

/**
 * Splits a CSV document into records, following the same RFC 4180 rules `escapeCsvField`
 * writes: a quoted field may contain commas, newlines, and doubled quotes, and any of CRLF,
 * LF, or a bare CR ends a record.
 *
 * Blank lines are skipped rather than reported as empty records — a trailing newline is how
 * most files end, and a file whose last row was "a row with one empty field" would otherwise
 * be an error message on every import. A byte-order mark is dropped, since a spreadsheet
 * saving as CSV is the likeliest source of one and it would otherwise arrive glued to the
 * first header.
 */
export function scanCsv(text: string): CsvRecord[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let index = 0;

  function endRecord(): void {
    cells.push(field);
    field = '';
    // A line holding nothing at all is not a record. One holding a single empty field is
    // indistinguishable from it here, and treating the two alike is what lets a file end
    // with a newline without the reader having to say so.
    if (cells.length > 1 || cells[0] !== '') {
      records.push({ line: recordLine, cells });
    }
    cells = [];
    recordLine = line;
  }

  while (index < source.length) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      // Inside a quoted value a newline is content, but it is still a line the reader will
      // count when they go looking for the record it belongs to.
      if (char === '\n' || (char === '\r' && source[index + 1] !== '\n')) line += 1;
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      cells.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      const width = char === '\r' && source[index + 1] === '\n' ? 2 : 1;
      line += 1;
      index += width;
      endRecord();
      continue;
    }

    field += char;
    index += 1;
  }

  if (inQuotes) {
    throw new Error('The file ends inside a quoted value — check for an unclosed quote.');
  }
  if (field !== '' || cells.length > 0) endRecord();

  return records;
}

/** Every record as a plain array of cells, for callers that do not need the line numbers. */
export function parseCsv(text: string): string[][] {
  return scanCsv(text).map((record) => record.cells);
}

/**
 * A header name reduced to what it actually names. "Display Name", "display_name", and
 * "displayName" are the same column under three house styles, and an import that accepted
 * only one of them would reject most files people already have.
 */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export interface CsvDataRow {
  line: number;
  cells: string[];
  /** Cells keyed by their normalised header, for the columns the file actually has. */
  fields: Record<string, string>;
}

export interface CsvDocument {
  /** The header row, normalised, in the order the file gave them. */
  headers: string[];
  rows: CsvDataRow[];
}

/**
 * Reads a document as a header row plus data rows keyed by column name.
 *
 * The first record is the header, which is the convention every spreadsheet exports and the
 * only one an import screen can offer without asking the reader to describe their own file.
 * A repeated column name keeps its first appearance rather than its last: a file with two
 * "email" columns is a mistake either way, and silently preferring the far one would put the
 * error where nobody is looking.
 */
export function parseCsvDocument(text: string): CsvDocument {
  const records = scanCsv(text);
  const [header, ...body] = records;

  if (!header) {
    return { headers: [], rows: [] };
  }

  const headers = header.cells.map(normalizeHeader);

  const rows = body.map((record) => {
    const fields: Record<string, string> = {};
    headers.forEach((name, position) => {
      if (!name || name in fields) return;
      fields[name] = record.cells[position]?.trim() ?? '';
    });
    return { line: record.line, cells: record.cells, fields };
  });

  return { headers, rows };
}
