import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { zipSync } from 'fflate';
import { ACCEPTED_IMPORT_FILES, MAX_UPLOAD_BYTES, parseAppointmentFile, type ParseResult } from '../src/imports/file-parsers/index';

const fields = ['event_id', 'doctor_email', 'patient_name_typed', 'start_time', 'end_time', 'event_status'];
const source = { event_id: 17, doctor_email: 'doctor@example.org', patient_name_typed: 'اسم المريض', start_time: '2026-01-15T09:00:00', end_time: '2026-01-15T09:30:00', event_status: 'confirmed' };
function upload(name: string, content: string | Uint8Array) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer };
}
const json = (rows: unknown) => parseAppointmentFile(upload('events.json', JSON.stringify(rows)));
function success(result: ParseResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('Expected successful parse');
  return result;
}
function error(result: ParseResult, code: string) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected parse failure');
  assert.equal(result.error, code);
  return result;
}
function workbook(type: 'xlsx' | 'xls' = 'xlsx', options: { sheets?: string[]; rows?: unknown[][]; date1904?: boolean; formula?: boolean } = {}) {
  const book = XLSX.utils.book_new();
  book.Workbook = { WBProps: { date1904: options.date1904 ?? false } };
  for (const name of options.sheets ?? ['calendar_app_export']) {
    const sheet = XLSX.utils.aoa_to_sheet(options.rows ?? [fields, Object.values(source)]);
    // BIFF writers require binary formula tokens; .f alone only writes XLSX.
    if (options.formula) sheet.A2 = Object.assign({ t: 'n', v: 17, f: '8+9' }, { bf: [7, 0, 0x1e, 8, 0, 0x1e, 9, 0, 0x03] });
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  return XLSX.write(book, { type: 'array', bookType: type }) as ArrayBuffer;
}
const bookFile = (type: 'xls' | 'xlsx', options?: Parameters<typeof workbook>[1]) => upload(`appointments.${type}`, new Uint8Array(workbook(type, options)));
const ics = (overrides: Record<string, string | null> = {}, extra = '') => {
  const props = {
    UID: 'full-appointment-id@example.org', ORGANIZER: 'mailto:doctor@example.org',
    SUMMARY: 'اسم المريض', DTSTART: '20260115T090000', DTEND: '20260115T093000', STATUS: 'CONFIRMED', ...overrides,
  };
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
    ...Object.entries(props).filter(([, value]) => value !== null).map(([key, value]) => `${key}:${value}`),
    extra, 'END:VEVENT', 'END:VCALENDAR', ''].filter(Boolean).join('\r\n');
};
const calendar = (text: string) => parseAppointmentFile(upload('appointments.ics', text));

test('contract exposes bounded size and all file types', () => {
  assert.equal(MAX_UPLOAD_BYTES, 2097152);
  for (const ext of ['.json', '.csv', '.xlsx', '.xls', '.ics']) assert.ok(ACCEPTED_IMPORT_FILES.includes(ext));
});
test('JSON canonical rows, explicit aliases and local time remain unchanged', async () => {
  const parsed = success(await json([source]));
  assert.deepEqual(parsed.rows, [source]);
  const aliased = { 'Event ID': '00017', 'Doctor Email': source.doctor_email, 'Patient Name': source.patient_name_typed, Start: '2026-01-15 09:00', End: source.end_time, Status: 'CONFIRMED' };
  const row = success(await json([aliased])).rows[0]!;
  assert.equal(row.event_id, 17);
  assert.equal(row.start_time, source.start_time);
  assert.equal(row.event_status, 'confirmed');
});
test('IDs preserve stable identity and never round unsafe integers', async () => {
  for (const id of ['9007199254740993', 'stable-id', '0', 'a'.repeat(1024)]) {
    const row = success(await json([{ ...source, event_id: id }])).rows[0]!;
    assert.equal(row.event_id, 1);
    assert.equal(row.event_uid, id);
  }
  for (const id of [9007199254740992, -1, 0, 1.5, '', 'x'.repeat(1025)]) error(await json([{ ...source, event_id: id }]), 'errId');
  error(await json([{ ...source, event_id: 'stable', event_uid: 'other' }]), 'errId');
});
test('legacy IDs respect signed 32-bit bounds while numeric UIDs remain exact', async () => {
  for (const id of [2147483647, '2147483647', '0002147483647']) {
    const row = success(await json([{ ...source, event_id: id }])).rows[0]!;
    assert.equal(row.event_id, 2147483647);
    assert.equal(row.event_uid, undefined);
  }
  for (const id of [2147483648, '2147483648', '0002147483648', Number.MAX_SAFE_INTEGER, '9007199254740993']) {
    const uid = String(id);
    const row = success(await json([{ ...source, event_id: id }])).rows[0]!;
    assert.equal(row.event_id, 1);
    assert.equal(row.event_uid, uid);
    const explicit = success(await json([{ ...source, event_id: id, event_uid: uid }])).rows[0]!;
    assert.deepEqual(explicit, row);
    error(await json([{ ...source, event_id: id, event_uid: 'different' }]), 'errId');
  }
  const explicit = success(await json([{ ...source, event_id: 2147483647, event_uid: '0002147483648' }])).rows[0]!;
  assert.equal(explicit.event_id, 2147483647);
  assert.equal(explicit.event_uid, '0002147483648');
  for (const uid of ['2147483647', '2147483648', '0002147483648']) {
    const row = success(await calendar(ics({ UID: uid }))).rows[0]!;
    assert.equal(row.event_id, 1);
    assert.equal(row.event_uid, uid);
  }
});
test('JSON rejects shape, missing/duplicate aliases, invalid fields and dates without skipping', async () => {
  for (const value of [{ rows: [source] }, [null], [1], [[]]]) error(await json(value), 'errJsonShape');
  error(await json([{ ...source, id: 18 }]), 'errDuplicateHeader');
  const { doctor_email: _, ...missing } = source;
  error(await json([missing]), 'errMissingHeader');
  error(await json([source, { ...source, patient_name_typed: '' }]), 'errField');
  for (const date of ['2026-02-30T09:00:00', '2026-01-15', '2026-01-15T25:00:00', true]) {
    error(await json([{ ...source, start_time: date }]), 'errDate');
  }
  // DST gaps/folds remain local for authoritative server revalidation.
  assert.equal(success(await json([{ ...source, start_time: '2026-03-28T02:30:00' }])).rows[0]!.start_time, '2026-03-28T02:30:00');
});
test('UTC and explicit offsets convert once to Hebron wall time independent of browser TZ', async () => {
  const rows = success(await json([{ ...source, start_time: '2026-01-15T07:00:00Z', end_time: '2026-01-15T09:30:00+02:00' }])).rows;
  assert.equal(rows[0]!.start_time, '2026-01-15T09:00:00.000');
  assert.equal(rows[0]!.end_time, '2026-01-15T09:30:00.000');
});
test('CSV UTF-8 Arabic BOM, CRLF, quoted commas/newlines and escaped quotes', async () => {
  const text = '\uFEFFمعرف الموعد,بريد الطبيب,اسم المريض,وقت البداية,وقت النهاية,حالة الموعد\r\n17,doctor@example.org,"اسم, ""مريض""\r\nثان",2026-01-15 09:00,2026-01-15 09:30,confirmed\r\n';
  const row = success(await parseAppointmentFile(upload('events.csv', text))).rows[0]!;
  assert.equal(row.patient_name_typed, 'اسم, "مريض"\r\nثان');
  assert.equal(row.event_id, 17);
});
test('CSV reliable tab/semicolon delimiters, malformed quotes and ragged rows', async () => {
  for (const delimiter of ['\t', ';']) {
    const text = [fields.join(delimiter), Object.values(source).join(delimiter)].join('\r\n');
    assert.equal(success(await parseAppointmentFile(upload('events.csv', text))).rows.length, 1);
  }
  error(await parseAppointmentFile(upload('events.csv', `${fields.join(',')}\n17,a,"unterminated`)), 'errCsv');
  error(await parseAppointmentFile(upload('events.csv', `${fields.join(',')}\n17,a,b"c,2026-01-15T09:00:00,2026-01-15T09:30:00,confirmed`)), 'errCsv');
  error(await parseAppointmentFile(upload('events.csv', `${fields.join(',')}\n${Object.values(source).join(',')},extra`)), 'errColumns');
});
test('real in-memory XLSX and legacy XLS roundtrip', async () => {
  for (const type of ['xlsx', 'xls'] as const) {
    const parsed = success(await parseAppointmentFile(bookFile(type)));
    assert.deepEqual(parsed.rows, [source]);
    assert.equal(parsed.selectedSheet, 'calendar_app_export');
  }
});
test('six-sheet workbook prefers calendar_app_export; ambiguity requires explicit choice', async () => {
  const sheets = ['patients', 'doctors', 'visits', 'appointments', 'calendar_app_export', 'notes'];
  const selected = success(await parseAppointmentFile(bookFile('xlsx', { sheets })));
  assert.equal(selected.selectedSheet, 'calendar_app_export');
  assert.deepEqual(selected.sheetNames, sheets);
  const ambiguous = bookFile('xlsx', { sheets: ['one', 'two'] });
  assert.deepEqual(error(await parseAppointmentFile(ambiguous), 'errSheetChoice').sheetNames, ['one', 'two']);
  assert.equal(success(await parseAppointmentFile(ambiguous, 'two')).selectedSheet, 'two');
  error(await parseAppointmentFile(ambiguous, 'missing'), 'errSheetChoice');
  assert.equal(success(await parseAppointmentFile(bookFile('xlsx', { sheets: ['only'] }))).selectedSheet, 'only');
});
test('selected sheet header mapping is revalidated, not guessed', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['other'], ['data']]), 'invalid');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([fields, Object.values(source)]), 'valid');
  const file = upload('events.xlsx', new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })));
  assert.equal(success(await parseAppointmentFile(file)).selectedSheet, 'valid');
  error(await parseAppointmentFile(file, 'invalid'), 'errMissingHeader');
});
test('Excel serial dates honor 1900 and 1904 epochs without timezone conversion', async () => {
  for (const date1904 of [false, true]) {
    const serial = date1904 ? 44575.375 : 46037.375; // 2026-01-15 09:00 in each epoch.
    const parsed = success(await parseAppointmentFile(bookFile('xlsx', {
      date1904, rows: [fields, [17, source.doctor_email, source.patient_name_typed, serial, serial + 1 / 48, 'confirmed']],
    })));
    assert.equal(parsed.rows[0]!.start_time, source.start_time);
    assert.equal(parsed.rows[0]!.end_time, source.end_time);
  }
});
test('selected Excel formulas rejected in XLS and XLSX', async () => {
  for (const type of ['xls', 'xlsx'] as const) error(await parseAppointmentFile(bookFile(type, { formula: true })), 'errFormula');
});
test('row bounds apply to every format and no row is silently discarded', async () => {
  error(await json(Array.from({ length: 101 }, () => source)), 'errRowLimit');
  error(await parseAppointmentFile(upload('events.csv', [fields, ...Array.from({ length: 101 }, () => Object.values(source))].map(row => row.join(',')).join('\n'))), 'errRowLimit');
  for (const type of ['xls', 'xlsx'] as const) {
    error(await parseAppointmentFile(bookFile(type, { rows: [fields, ...Array.from({ length: 101 }, () => Object.values(source))] })), 'errRowLimit');
  }
  assert.equal(success(await json(Array.from({ length: 100 }, () => source))).rows.length, 100);
  const eventBlock = ics().split('BEGIN:VEVENT')[1]!.split('END:VEVENT')[0]!;
  error(await calendar(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${Array.from({ length: 101 }, () => `BEGIN:VEVENT${eventBlock}END:VEVENT\r\n`).join('')}END:VCALENDAR\r\n`), 'errRowLimit');
});
test('canonical JSON limit, declared and actual file limits, encoding and malformed errors are bounded', async () => {
  error(await json(Array.from({ length: 100 }, () => ({ ...source, patient_name_typed: 'ع'.repeat(1000) }))), 'errPayloadLimit');
  let read = false;
  error(await parseAppointmentFile({ name: 'events.csv', size: MAX_UPLOAD_BYTES + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } }), 'errFileSize');
  assert.equal(read, false);
  error(await parseAppointmentFile({ name: 'events.csv', size: 1, arrayBuffer: async () => new ArrayBuffer(MAX_UPLOAD_BYTES + 1) }), 'errFileSize');
  error(await parseAppointmentFile(upload('events.csv', new Uint8Array([255]))), 'errEncoding');
  error(await parseAppointmentFile(upload('events.json', 'private raw source garbage')), 'errMalformed');
  error(await parseAppointmentFile(upload('events.txt', 'data')), 'errFileType');
  error(await parseAppointmentFile(upload('events.xlsx', 'not a zip')), 'errFormat');
});
test('ZIP advertised expansion and actual forged-size bomb rejected before SheetJS', async () => {
  const many = zipSync(Object.fromEntries(Array.from({ length: 513 }, (_, i) => [`entry-${i}`, new Uint8Array(0)])));
  error(await parseAppointmentFile(upload('events.xlsx', many)), 'errZipLimit');
  const bomb = zipSync({ 'huge.xml': new Uint8Array(17 * 1024 * 1024) });
  error(await parseAppointmentFile(upload('events.xlsx', bomb)), 'errZipLimit');
  const forged = bomb.slice();
  const view = new DataView(forged.buffer);
  for (let i = 0; i < forged.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1, true);
    if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, 1, true);
  }
  error(await parseAppointmentFile(upload('events.xlsx', forged)), 'errZipLimit');
});
test('ICS floating times, complete UID and literal unfolded/escaped SUMMARY', async () => {
  const parsed = success(await calendar(ics({ SUMMARY: 'اسم\\, مريض\\nسطر\r\n ثان' })));
  const row = parsed.rows[0]!;
  assert.equal(row.event_id, 1);
  assert.equal(row.event_uid, 'full-appointment-id@example.org');
  assert.equal(row.patient_name_typed, 'اسم, مريض\nسطرثان');
  assert.equal(row.start_time, source.start_time);
  assert.equal(row.doctor_email, source.doctor_email);
  assert.equal(row.event_status, 'confirmed');
});
test('ICS UTC and known IANA zones convert to Hebron, unknown zones reject', async () => {
  const utc = success(await calendar(ics({ DTSTART: '20260115T070000Z', DTEND: '20260115T073000Z' })));
  assert.equal(utc.rows[0]!.start_time, source.start_time);
  const iana = success(await calendar(ics({ DTSTART: null, DTEND: null }, 'DTSTART;TZID=America/New_York:20260115T020000\r\nDTEND;TZID=America/New_York:20260115T023000')));
  assert.equal(iana.rows[0]!.start_time, source.start_time);
  error(await calendar(ics({ DTSTART: null }, 'DTSTART;TZID=Invalid/Zone:20260115T090000')), 'errTimezone');
});
test('ICS required fields, unsupported status, all-day, recurrence and duration reject explicitly', async () => {
  for (const status of [null, 'TENTATIVE', 'BOGUS']) error(await calendar(ics({ STATUS: status })), 'errStatus');
  error(await calendar(ics({ UID: null })), 'errId');
  error(await calendar(ics({ ORGANIZER: null })), 'errField');
  error(await calendar(ics({ SUMMARY: null })), 'errField');
  error(await calendar(ics({ DTSTART: null })), 'errCalendarTime');
  error(await calendar(ics({ DTSTART: '20260230T090000' })), 'errDate');
  error(await calendar(ics({ DTEND: null }, 'DURATION:PT30M')), 'errDuration');
  error(await calendar(ics({ DTSTART: null }, 'DTSTART;VALUE=DATE:20260115')), 'errAllDay');
  for (const recurrence of ['RRULE:FREQ=DAILY', 'RDATE:20260116T090000', 'EXDATE:20260116T090000', 'RECURRENCE-ID:20260116T090000']) {
    error(await calendar(ics({}, recurrence)), 'errRecurrence');
  }
  const custom = success(await calendar(ics({ ORGANIZER: null, SUMMARY: null }, 'X-DOCTOR-EMAIL:other@example.org\r\nX-PATIENT-NAME:Literal patient')));
  assert.equal(custom.rows[0]!.doctor_email, 'other@example.org');
  assert.equal(custom.rows[0]!.patient_name_typed, 'Literal patient');
});
test('existing attached workbook is read-only, bounded and selects export without dumping source rows', async (t) => {
  const path = resolve(import.meta.dirname, '../../../attached_assets/Amal_Family_Clinic_Group_data_1792331449501.xlsx');
  if (!existsSync(path)) return t.skip('Source workbook not available');
  const bytes = readFileSync(path);
  const parsed = success(await parseAppointmentFile(upload('source.xlsx', bytes)));
  assert.equal(parsed.sheetNames?.length, 6);
  assert.equal(parsed.selectedSheet, 'calendar_app_export');
  assert.equal(parsed.rows.length, 24);
});
