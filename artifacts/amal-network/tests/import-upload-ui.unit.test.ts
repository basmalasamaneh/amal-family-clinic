import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importAr, importEn } from '../src/imports/strings';
import { uploadError, uploadErrorAliases, uploadErrorContext } from '../src/imports/model';

const source = readFileSync(new URL('../src/imports/ImportPage.tsx', import.meta.url), 'utf8');
const upload = source.split('/* ---------------- Step 1 ---------------- */')[1]!.split('/* ---------------- Step 2 ---------------- */')[0]!;

test('upload surface removes seed staging while retaining saved batch controls', () => {
  assert.doesNotMatch(source, /button-stage-seed|source: 'seed'|seedTitle|seedBody|seedBtn|\bDatabase\b|\bFileJson\b/);
  assert.match(upload, /button-reopen-last/);
  assert.match(upload, /button-reopen/);
  assert.match(upload, /source: 'json', sourceName: rows.name, rows: rows.rows, clientOpId:/);
});

test('file selection uses canonical parser and guards async results and stale previews', () => {
  assert.match(source, /ACCEPTED_IMPORT_FILES, MAX_UPLOAD_BYTES, parseAppointmentFile/);
  assert.doesNotMatch(upload, /parseExport|\.text\(\)/);
  assert.match(upload, /setRows\(null\); setFileErr\(null\); setParsing\(true\); opRef.current = null/);
  assert.match(upload, /mounted.current && sequence.current === seq/);
  assert.match(upload, /mounted.current = false; sequence.current\+\+/);
  assert.match(upload, /catch \{[\s\S]*?setFileErr\('errParse'\)/);
  assert.match(upload, /disabled=\{!rows \|\| parsing \|\| upload.isPending\}/);
  assert.match(upload, /disabled=\{upload.isPending\} onChange=\{onFile\}/);
  assert.match(upload, /preview-import-file/);
  assert.match(upload, /select-import-sheet/);
  assert.match(upload, /parseFile\(fileRef.current, e.target.value\)/);
  assert.match(upload, /setFileErr\(uploadError\(r.error\)\)/);
  assert.match(upload, /setFileContext\(uploadErrorContext\(r.row, r.column\)\)/);
  assert.match(upload, /sheetNames.length > 0/);
});

test('all parser errors and upload copy have English and Arabic translations', () => {
  const codes = ['errType', 'errSize', 'errParse', 'errShape', 'errHeaders', 'errSheetChoice', 'errSheet', 'errRows', 'errFormula', 'errDate', 'errCalendar', 'errRecurrence', 'errIdentity', 'errNormalizedSize', 'errArchive'] as const;
  for (const code of codes) {
    assert.ok(importEn.upload[code]);
    assert.ok(importAr.upload[code]);
    assert.notEqual(importEn.upload[code], importAr.upload[code]);
  }
  assert.deepEqual(Object.keys(importEn.upload).sort(), Object.keys(importAr.upload).sort());
  assert.match(importEn.upload.limits, /2 MiB/);
  assert.match(importEn.upload.errType, /PDFs and images/);
});

test('actual parser error codes resolve to localized actionable messages', () => {
  const codes = ['errFileSize', 'errFileType', 'errEmpty', 'errEncoding', 'errFormat', 'errMalformed', 'errJsonShape', 'errMissingHeader', 'errDuplicateHeader', 'errColumns', 'errField', 'errId', 'errDate', 'errCsv', 'errDelimiter', 'errSheetChoice', 'errFormula', 'errZip', 'errZipLimit', 'errRowLimit', 'errPayloadLimit', 'errCalendar', 'errCalendarTime', 'errAllDay', 'errDuration', 'errRecurrence', 'errStatus', 'errTimezone'];
  assert.deepEqual(Object.keys(uploadErrorAliases).sort(), codes.sort());
  for (const code of codes) {
    const key = uploadError(code);
    assert.ok(importEn.upload[key]);
    assert.ok(importAr.upload[key]);
    if (code !== 'errMalformed') assert.notEqual(key, 'errParse');
  }
  for (const unknown of ['newUnknownError', '__proto__', 'constructor', '<script>']) assert.equal(uploadError(unknown), 'errParse');
});

test('error location accepts only numeric rows and canonical column names, never source data', () => {
  assert.deepEqual(uploadErrorContext(7, 'doctor_email'), { row: 7, column: 'doctor_email' });
  assert.deepEqual(uploadErrorContext(1, 'event_uid'), { row: 1, column: 'event_uid' });
  assert.deepEqual(uploadErrorContext(3, 'patient@example.org'), { row: 3 });
  assert.deepEqual(uploadErrorContext(-1, '<script>'), {});
  assert.deepEqual(uploadErrorContext(Infinity, 'SUMMARY'), {});
  assert.deepEqual(uploadErrorContext(1.5, undefined), {});
});
