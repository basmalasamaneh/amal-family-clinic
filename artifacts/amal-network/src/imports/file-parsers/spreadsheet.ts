import * as XLSX from 'xlsx';
import { canonicalize, bounded, fail, headers, MAX_ROWS, ParseError, type ParseResult, type Row } from './common';
import { checkZip } from './zip';

function sheetTable(sheet: XLSX.WorkSheet): unknown[][] {
  const ref = sheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  if (range.e.c - range.s.c > 63) fail('errColumns');
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true });
}
function excelDate(value: number, date1904: boolean, row: number, column: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 2958465) return fail('errDate', row, column);
  const date = XLSX.SSF.parse_date_code(value, { date1904 });
  if (!date) return fail('errDate', row, column);
  const pad = (n: number, length = 2) => String(n).padStart(length, '0');
  return `${pad(date.y, 4)}-${pad(date.m)}-${pad(date.d)}T${pad(date.H)}:${pad(date.M)}:${pad(date.S)}`;
}
export function parseSpreadsheet(bytes: Uint8Array, extension: string, selected?: string): ParseResult {
  if (extension === 'xlsx') {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail('errFormat');
    checkZip(bytes);
  } else if (![0xd0, 0x09].includes(bytes[0]!)) {
    // Accept OLE BIFF XLS and raw BIFF, not HTML/CSV disguised as a workbook.
    fail('errFormat');
  }
  const workbook = XLSX.read(bytes, {
    type: 'array', sheetRows: 102, cellFormula: true, cellDates: false,
    cellHTML: false, cellStyles: false, bookVBA: false, bookDeps: false,
    bookFiles: false, WTF: false,
  });
  const sheetNames = workbook.SheetNames;
  const eligible = sheetNames.filter(name => {
    try { headers(sheetTable(workbook.Sheets[name]!)[0] ?? []); return true; } catch { return false; }
  });
  const name = selected ?? (eligible.includes('calendar_app_export') ? 'calendar_app_export' : eligible.length === 1 ? eligible[0] : undefined);
  if (!name || !sheetNames.includes(name)) throw new ParseError('errSheetChoice', undefined, undefined, sheetNames);
  try {
    const sheet = workbook.Sheets[name]!;
    const table = sheetTable(sheet);
    if (!table.length) fail('errEmpty');
    const mapping = headers(table[0]!);
    const range = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref']!);
    if (range.e.r - range.s.r > MAX_ROWS || table.length - 1 > MAX_ROWS) fail('errRowLimit');
    // Reject formulas in any selected cells, not just the six mapped columns.
    for (const [address, cell] of Object.entries(sheet)) {
      if (!address.startsWith('!') && (cell as XLSX.CellObject).f !== undefined) fail('errFormula', XLSX.utils.decode_cell(address).r + 1);
    }
    const rows = table.slice(1).map((cells, i) => {
      const source: Row = {};
      mapping.forEach((key, col) => {
        if (!key) return;
        const value = cells[col];
        source[key] = (key === 'start_time' || key === 'end_time') && typeof value === 'number'
          ? excelDate(value, Boolean(workbook.Workbook?.WBProps?.date1904), i + 2, key) : value;
      });
      return canonicalize(source, i + 2);
    });
    return { ok: true, rows: bounded(rows), sheetNames, selectedSheet: name };
  } catch (error) {
    if (error instanceof ParseError) error.sheetNames = sheetNames;
    throw error;
  }
}
