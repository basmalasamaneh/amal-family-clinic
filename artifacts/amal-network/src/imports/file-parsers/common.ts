import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 100;
export const MAX_JSON_BYTES = 128 * 1024;
export const ZONE = 'Asia/Hebron';
export type Row = Record<string, unknown>;
export type ParseResult = { ok: true; rows: Row[]; sheetNames?: string[]; selectedSheet?: string } |
  { ok: false; error: string; sheetNames?: string[]; row?: number; column?: string };

export class ParseError extends Error {
  constructor(public code: string, public row?: number, public column?: string, public sheetNames?: string[]) { super(code); }
}
export const fail = (code: string, row?: number, column?: string): never => { throw new ParseError(code, row, column); };
export const FIELDS = ['event_id', 'doctor_email', 'patient_name_typed', 'start_time', 'end_time', 'event_status'] as const;
type Field = typeof FIELDS[number] | 'event_uid';
// Only these explicit aliases are supported; no fuzzy/positional identity inference.
export const HEADER_ALIASES: Readonly<Record<Field, readonly string[]>> = {
  event_id: ['event_id', 'event id', 'id', 'appointment id', 'معرف الموعد', 'رقم الموعد', 'معرف الحدث'],
  doctor_email: ['doctor_email', 'doctor email', 'doctor e-mail', 'بريد الطبيب', 'البريد الإلكتروني للطبيب', 'البريد الالكتروني للطبيب'],
  patient_name_typed: ['patient_name_typed', 'patient name', 'patient', 'اسم المريض'],
  start_time: ['start_time', 'start time', 'start', 'وقت البداية', 'بداية الموعد'],
  end_time: ['end_time', 'end time', 'end', 'وقت النهاية', 'نهاية الموعد'],
  event_status: ['event_status', 'event status', 'status', 'حالة الموعد', 'الحالة'],
  event_uid: ['event_uid', 'event uid', 'uid'],
};
const normalizeHeader = (v: string) => v.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');
export function headers(values: unknown[]): (Field | null)[] {
  const seen = new Set<Field>();
  const mapping = values.map((value) => {
    if (typeof value !== 'string') return null;
    const key = (Object.keys(HEADER_ALIASES) as Field[]).find(k => HEADER_ALIASES[k].includes(normalizeHeader(value)));
    if (!key) return null;
    if (seen.has(key)) fail('errDuplicateHeader', 1, key);
    seen.add(key);
    return key;
  });
  for (const key of FIELDS) if (!seen.has(key)) fail('errMissingHeader', 1, key);
  return mapping;
}
const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/i;
export function timestamp(value: unknown, row: number, column: string): string {
  if (typeof value !== 'string' || value.length > 64) return fail('errDate', row, column);
  const match = iso.exec(value.trim());
  if (!match) return fail('errDate', row, column);
  const [, y, m, d, h, min, sec = '00', fraction = '', offset] = match;
  const local = `${y}-${m}-${d}T${h}:${min}:${sec}${fraction}`;
  // UTC here validates calendar components only, never interprets naive source time.
  const check = new Date(`${local}Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 19) !== local.slice(0, 19)) return fail('errDate', row, column);
  if (!offset) return local;
  const instant = new Date(`${local}${offset.toUpperCase()}`);
  if (!Number.isFinite(instant.getTime())) return fail('errDate', row, column);
  return formatInTimeZone(instant, ZONE, "yyyy-MM-dd'T'HH:mm:ss.SSS");
}
export function zonedTime(local: string, zone: string, row: number, column: string): string {
  timestamp(local, row, column);
  if (zone === ZONE || zone === 'floating') return local;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
    const instant = fromZonedTime(local, zone);
    if (!Number.isFinite(instant.getTime())) return fail('errTimezone', row, column);
    return formatInTimeZone(instant, ZONE, "yyyy-MM-dd'T'HH:mm:ss");
  } catch { return fail('errTimezone', row, column); }
}
export function canonicalize(source: Row, row: number): Row {
  const result: Row = {};
  const id = source.event_id;
  // Legacy numeric IDs must fit a positive signed 32-bit integer. Digit strings
  // (including leading zeros) within that range canonicalize to that integer.
  // Larger safe numbers become string UIDs; out-of-range digit strings preserve
  // every original digit as a UID. Unsafe JS numbers are always rejected.
  if (typeof id === 'number') {
    if (!Number.isSafeInteger(id) || id <= 0) fail('errId', row, 'event_id');
    if (id <= 2147483647) result.event_id = id;
    else { result.event_id = 1; result.event_uid = String(id); }
  } else if (typeof id === 'string' && id.trim() && id.length <= 1024) {
    const numeric = /^\d+$/.test(id) ? Number(id) : NaN;
    if (Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 2147483647) result.event_id = numeric;
    else { result.event_id = 1; result.event_uid = id; }
  } else fail('errId', row, 'event_id');
  if (source.event_uid !== undefined && source.event_uid !== null && source.event_uid !== '') {
    if (typeof source.event_uid !== 'string' || !source.event_uid.trim() || source.event_uid.length > 1024) fail('errId', row, 'event_uid');
    if (result.event_uid && result.event_uid !== source.event_uid) fail('errId', row, 'event_uid');
    result.event_uid = source.event_uid;
  }
  for (const field of ['doctor_email', 'patient_name_typed', 'event_status'] as const) {
    const value = source[field];
    if (typeof value !== 'string' || !value.trim() || value.length > 1024) return fail('errField', row, field);
    result[field] = field === 'event_status' ? value.trim().toLowerCase() : value.trim();
  }
  result.start_time = timestamp(source.start_time, row, 'start_time');
  result.end_time = timestamp(source.end_time, row, 'end_time');
  return result;
}
export function bounded(rows: Row[]): Row[] {
  if (rows.length > MAX_ROWS) fail('errRowLimit');
  if (!rows.length) fail('errEmpty');
  if (new TextEncoder().encode(JSON.stringify(rows)).byteLength > MAX_JSON_BYTES) fail('errPayloadLimit');
  return rows;
}
export function tableRows(table: unknown[][]): Row[] {
  if (!table.length) return fail('errEmpty');
  const mapping = headers(table[0]!);
  if (table.length - 1 > MAX_ROWS) fail('errRowLimit');
  return bounded(table.slice(1).map((cells, i) => {
    if (cells.length > mapping.length && cells.slice(mapping.length).some(v => v !== '' && v != null)) fail('errColumns', i + 2);
    const source: Row = {};
    mapping.forEach((key, j) => { if (key) source[key] = cells[j]; });
    return canonicalize(source, i + 2);
  }));
}
