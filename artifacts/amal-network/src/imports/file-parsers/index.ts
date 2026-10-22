import Papa from 'papaparse';
import { bounded, canonicalize, fail, headers, MAX_UPLOAD_BYTES, ParseError, tableRows, type ParseResult, type Row } from './common';
import { parseCalendar } from './calendar';
import { parseSpreadsheet } from './spreadsheet';

export { MAX_UPLOAD_BYTES } from './common';
export type { ParseResult } from './common';
export const ACCEPTED_IMPORT_FILES = '.json,.csv,.xlsx,.xls,.ics,application/json,text/csv,application/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/calendar,application/ics';

function parseJson(text: string): Row[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) return fail('errJsonShape');
  if (value.length > 100) fail('errRowLimit');
  return bounded(value.map((entry: unknown, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return fail('errJsonShape', index + 1);
    const keys = Object.keys(entry);
    const mapping = headers(keys);
    const source: Row = {};
    keys.forEach((key, col) => { if (mapping[col]) source[mapping[col]!] = (entry as Row)[key]; });
    return canonicalize(source, index + 1);
  }));
}
function parseCsv(text: string): Row[] {
  const attempts = [',', '\t', ';'].map(delimiter => Papa.parse<string[]>(text, {
    delimiter, header: false, skipEmptyLines: true, preview: 102,
    dynamicTyping: false, quoteChar: '"', escapeChar: '"',
  }));
  const eligible = attempts.filter(result => {
    try { headers(result.data[0] ?? []); return true; } catch { return false; }
  });
  if (eligible.length > 1) return fail('errDelimiter');
  if (!eligible.length) {
    // Preserve precise duplicate/missing-header errors for the most plausible delimiter.
    const plausible = [...attempts].sort((a, b) => (b.data[0]?.length ?? 0) - (a.data[0]?.length ?? 0))[0]!;
    if (plausible.errors.length) fail('errCsv');
    headers(plausible.data[0] ?? []);
    return fail('errDelimiter');
  }
  const parsed = eligible[0]!;
  // Papa intentionally tolerates bare quotes in unquoted fields. Import files
  // use strict CSV grammar so malformed input cannot quietly change identity.
  let state: 'start' | 'unquoted' | 'quoted' | 'closed' = 'start';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') i++;
        else state = 'closed';
      }
    } else if (char === parsed.meta.delimiter || char === '\r' || char === '\n') {
      state = 'start';
    } else if (char === '"') {
      if (state !== 'start') fail('errCsv');
      state = 'quoted';
    } else {
      if (state === 'closed') fail('errCsv');
      state = 'unquoted';
    }
  }
  if (state === 'quoted') fail('errCsv');
  if (parsed.errors.length) fail('errCsv', parsed.errors[0]!.row === undefined ? undefined : parsed.errors[0]!.row! + 1);
  if (parsed.meta.truncated || parsed.data.length > 101) fail('errRowLimit');
  return tableRows(parsed.data);
}
/** File extensions choose parsers; binary workbooks never enter a text decoder.
 * Errors contain stable codes and locations only, never uploaded source contents.
 * This adapter produces staging rows only; server validation/review remains mandatory. */
export async function parseAppointmentFile(
  file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  sheetName?: string,
): Promise<ParseResult> {
  try {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_UPLOAD_BYTES) fail('errFileSize');
    const extension = file.name.toLowerCase().split('.').pop();
    if (!extension || !['json', 'csv', 'xlsx', 'xls', 'ics'].includes(extension)) fail('errFileType');
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_UPLOAD_BYTES) fail('errFileSize');
    if (!buffer.byteLength) fail('errEmpty');
    const bytes = new Uint8Array(buffer);
    if (extension === 'xlsx' || extension === 'xls') return parseSpreadsheet(bytes, extension, sheetName);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
    catch { return fail('errEncoding'); }
    const rows = extension === 'json' ? parseJson(text) : extension === 'csv' ? parseCsv(text) : parseCalendar(text);
    return { ok: true, rows };
  } catch (error) {
    if (error instanceof ParseError) return {
      ok: false, error: error.code,
      ...(error.row !== undefined ? { row: error.row } : {}),
      ...(error.column !== undefined ? { column: error.column } : {}),
      ...(error.sheetNames ? { sheetNames: error.sheetNames } : {}),
    };
    return { ok: false, error: 'errMalformed' };
  }
}
