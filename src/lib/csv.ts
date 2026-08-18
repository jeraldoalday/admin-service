/**
 * CSV serialisation for exported tables.
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
