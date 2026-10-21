import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import express, { type Request, type Response } from "express";
import { pushInput } from "../src/sync/validation";
import { mapInput, uploadInput } from "../src/imports/validation";

/** Exercise the real JSON parser over an in-memory request stream, no server. */
async function parse(payload: unknown, limit: string) {
  const bytes = Buffer.from(JSON.stringify(payload));
  const stream = new PassThrough();
  const req = Object.assign(stream, {
    headers: { "content-type": "application/json", "content-length": String(bytes.length) },
    method: "POST", url: "/", socket: {},
  }) as unknown as Request;
  let error: unknown;
  await new Promise<void>(resolve => {
    express.json({ limit })(req, {} as Response, value => { error = value; resolve(); });
    stream.end(bytes);
  });
  return { error, bytes: bytes.length, body: req.body };
}
function oversized(error: unknown) {
  assert(error && typeof error === "object" && "type" in error);
  assert.equal(error.type, "entity.too.large");
}

test("50 maximum-length sync updates need more than 256KiB; 2MiB preserves escaped-string bounds", async () => {
  // NUL is accepted by the current bounded reason contract and JSON escapes it
  // to six bytes. This also bounds the cheaper normal Arabic/English encodings.
  const reason = "\u0000".repeat(2000);
  const payload = { operations: Array.from({ length: 50 }, (_, i) => ({
    sequence: i + 1, type: "update", appointmentId: 2147483647, input: {
      clientOpId: randomUUID(), expectedVersion: 2147483647,
      startsAt: "2026-09-12T06:00:00.000Z", endsAt: "2026-09-12T06:30:00.000Z",
      status: "cancelled", cancelReason: reason, overrideReason: reason, holdToken: randomUUID(),
    },
  })) };
  assert(pushInput.safeParse(payload).success);
  const tooSmall = await parse(payload, "256kb");
  oversized(tooSmall.error);
  const accepted = await parse(payload, "2mb");
  assert.equal(accepted.error, undefined);
  assert(accepted.bytes > 1024 * 1024 && accepted.bytes < 2 * 1024 * 1024);
  assert.deepEqual(accepted.body, payload);
});

test("100 full mapped import rows need more than 128KiB; 1MiB preserves all bounded mapped fields", async () => {
  const boundedText = (length: number) => "أ" + "\u0000".repeat(length - 1);
  const payload = { expectedVersion: 2147483647,
    rows: Array.from({ length: 100 }, (_, i) => ({
      rowId: i + 1, action: "include", doctorId: 2147483647,
      identity: { kind: "new", patient: {
        name: boundedText(200), phone: "+970599123456", dateOfBirth: "2020-01-01",
        guardianName: boundedText(200), guardianRelation: boundedText(100),
      } },
      startLocal: "2026-09-12T09:00:00", endLocal: "2026-09-12T09:30:00",
      associateAppointmentId: 2147483647, overrideReason: boundedText(1000),
    })) };
  assert(mapInput.safeParse(payload).success);
  const tooSmall = await parse(payload, "128kb");
  oversized(tooSmall.error);
  const accepted = await parse(payload, "1mb");
  assert.equal(accepted.error, undefined);
  assert(accepted.bytes > 900_000 && accepted.bytes < 1024 * 1024);
  assert.deepEqual(accepted.body, payload);
});

test("100 ordinary Unicode calendar rows fit the documented 128KiB upload contract", async () => {
  const payload = { source: "json", sourceName: "مواعيد العيادة", clientOpId: randomUUID(),
    rows: Array.from({ length: 100 }, (_, i) => ({
      event_id: i + 1, doctor_email: "doctor@example.test",
      patient_name_typed: "أ".repeat(200),
      start_time: "2026-09-12T09:00:00", end_time: "2026-09-12T09:30:00", event_status: "confirmed",
    })) };
  assert(uploadInput.safeParse(payload).success);
  const accepted = await parse(payload, "128kb");
  assert.equal(accepted.error, undefined);
  assert(accepted.bytes < 128 * 1024);
  assert.deepEqual(accepted.body, payload);
  const oversizedUpload = { ...payload, rows: [{ arbitrary_raw_column: "x".repeat(128 * 1024) }] };
  assert(uploadInput.safeParse(oversizedUpload).success,
    "arbitrary raw cells remain accepted by row staging, with request bytes bounded independently");
  oversized((await parse(oversizedUpload, "128kb")).error);
});

test("parser request-byte caps remain finite independently of item count", async () => {
  oversized((await parse({ text: "x".repeat(2 * 1024 * 1024) }, "2mb")).error);
  oversized((await parse({ text: "x".repeat(1024 * 1024) }, "1mb")).error);
});
