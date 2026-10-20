import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { aggregateAdoption, aggregateAppointments, aggregateTelemetry } from "../src/kpis/aggregates";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("KPI SQL tests prohibited in deployment");
}

test("KPI SQL aggregates reconcile seeds and isolated operational evidence without changing seeds", async (t) => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const seedSnapshot = async () => {
    const result: Record<string, unknown> = {};
    for (const table of ["clinics", "doctors", "patients", "appointments", "patient_visit_history", "calendar_app_export"]) {
      result[table] = (await client.query(`SELECT count(*)::integer AS count,
        md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text)) AS hash FROM public.${table} t`)).rows[0];
    }
    return result;
  };
  const before = await seedSnapshot();
  try {
    await client.query("BEGIN");
    await t.test("immutable baseline and independent clinic/weekday SQL", async () => {
      const start = fromZonedTime("2026-09-08T00:00:00", "Asia/Hebron").toISOString();
      const end = fromZonedTime("2026-09-14T00:00:00", "Asia/Hebron").toISOString();
      const actual = await aggregateAppointments(client, "before", start, end, null);
      assert.equal(actual.totalAppointments, 102);
      assert.deepEqual(actual.collisions, { sameDoctorSameStartPairs: 6, samePatientSameStartCrossClinicPairs: 2 });
      assert.deepEqual(actual.noShow, { numerator: 22, denominator: 102, ratio: 22 / 102, percent: 21.6 });
      assert.deepEqual(actual.bookingsBySource, { phone: 48, "walk-in": 21, calendar: 33, "amal-network": 0, unknown: 0 });
      const values = [start, end];
      const { rows: [independent] } = await client.query(`SELECT
        (SELECT count(*)::integer FROM public.appointments a JOIN public.appointments b
          ON a.appointment_id<b.appointment_id AND a.doctor_id=b.doctor_id AND a.scheduled_at=b.scheduled_at
          WHERE a.scheduled_at >= $1 AND a.scheduled_at < $2) AS doctor,
        (SELECT count(*)::integer FROM public.appointments a JOIN public.appointments b
          ON a.appointment_id<b.appointment_id AND a.patient_id=b.patient_id AND a.clinic_id<>b.clinic_id AND a.scheduled_at=b.scheduled_at
          WHERE a.scheduled_at >= $1 AND a.scheduled_at < $2) AS patient,
        (SELECT count(*)::integer FROM public.appointments WHERE status='completed' AND scheduled_at >= $1 AND scheduled_at < $2) AS completed`, values);
      assert.equal(actual.completed, independent.completed);
      assert.equal(actual.collisions.sameDoctorSameStartPairs, independent.doctor);
      assert.equal(actual.collisions.samePatientSameStartCrossClinicPairs, independent.patient);
      for (const clinic of actual.clinics) {
        const { rows: [expected] } = await client.query(`SELECT count(*)::integer AS denominator,
          count(*) FILTER (WHERE status='no_show')::integer AS numerator FROM public.appointments
          WHERE scheduled_at >= $1 AND scheduled_at < $2 AND clinic_id=$3`, [...values, clinic.clinicId]);
        assert.equal(clinic.noShow.denominator, expected.denominator);
        assert.equal(clinic.noShow.numerator, expected.numerator);
        const filtered = await aggregateAppointments(client, "before", start, end, clinic.clinicId);
        assert.deepEqual(filtered.noShow, clinic.noShow);
        assert.deepEqual(filtered.bookingsBySource, clinic.bookingsBySource);
        assert.deepEqual(filtered.collisions, clinic.collisions);
        const sources = (await client.query(`SELECT lower(btrim(booking_method)) AS source,count(*)::integer AS n
          FROM public.appointments WHERE scheduled_at >= $1 AND scheduled_at < $2 AND clinic_id=$3 GROUP BY 1`,
        [...values, clinic.clinicId])).rows;
        const normalized = { phone: 0, "walk-in": 0, calendar: 0, "amal-network": 0, unknown: 0 };
        for (const source of sources) {
          const bucket = source.source === "phone" ? "phone" : ["walk_in", "walk-in", "walk in"].includes(source.source)
            ? "walk-in" : ["calendar_app", "calendar-app", "calendar app", "calendar"].includes(source.source) ? "calendar" : "unknown";
          normalized[bucket] += source.n;
        }
        assert.deepEqual(clinic.bookingsBySource, normalized);
      }
      for (const day of actual.weekdays) {
        const { rows: [expected] } = await client.query(`SELECT count(*)::integer AS denominator,
          count(*) FILTER (WHERE status='no_show')::integer AS numerator FROM public.appointments
          WHERE scheduled_at >= $1 AND scheduled_at < $2
            AND extract(dow FROM scheduled_at AT TIME ZONE 'Asia/Hebron')=$3`, [...values, day.weekday]);
        assert.equal(day.noShow.numerator, expected.numerator);
        assert.equal(day.noShow.denominator, expected.denominator);
        assert.equal(Object.values(day.bookingsBySource).reduce((sum, n) => sum + n, 0), expected.denominator);
      }
    });

    const marker = randomUUID();
    const clinics: number[] = [];
    const doctors: number[] = [];
    for (const mode of ["lite", "full"]) {
      const { rows: [clinic] } = await client.query(`INSERT INTO operational.clinics
        (clinic_name,city,booking_method,network_mode,joined_at) VALUES($1,'test','phone',$2,'2090-01-01T01:02:03Z') RETURNING clinic_id`,
      [`kpi-${mode}-${marker}`, mode]);
      clinics.push(clinic.clinic_id);
      const { rows: [doctor] } = await client.query(`INSERT INTO operational.doctors(doctor_name,clinic_id,specialty,email)
        VALUES('private-doctor',$1,'test',$2) RETURNING doctor_id`, [clinic.clinic_id, `${randomUUID()}@kpi.test`]);
      doctors.push(doctor.doctor_id);
    }
    const patients = (await client.query("SELECT patient_id FROM operational.patients ORDER BY patient_id LIMIT 2")).rows;
    assert.equal(patients.length, 2);
    const start = "2095-09-08T21:00:00.000Z", end = "2095-09-09T21:00:00.000Z";
    const at = "2095-09-08T21:30:00.000Z";

    await t.test("all-status unordered pairs retain cross-clinic counterparts; source buckets, local midnight, empty rates", async () => {
      const insert = async (clinic: number, patient: number, status: string, source: string, time = at) => {
        await client.query(`INSERT INTO operational.appointments(clinic_id,doctor_id,patient_id,scheduled_at,booking_method,status)
          VALUES($1,$2,$3,$4,$5,$6)`, [clinics[clinic], doctors[clinic], patients[patient].patient_id, time, source, status]);
      };
      await insert(0, 0, "cancelled", " Phone ");
      await insert(0, 0, "no_show", "walk_in");
      await insert(0, 1, "completed", "Calendar App");
      await insert(1, 0, "booked", "amal_network");
      await insert(1, 1, "no_show", "unrecognized", "2095-09-09T08:00:00Z");
      await insert(0, 1, "no_show", "phone", end); // exclusive upper bound
      const network = await aggregateAppointments(client, "after", start, end, null);
      const left = await aggregateAppointments(client, "after", start, end, clinics[0]);
      const right = await aggregateAppointments(client, "after", start, end, clinics[1]);
      assert.equal(network.totalAppointments, 5);
      assert.equal(network.completed, 1);
      assert.deepEqual(network.noShow, { numerator: 2, denominator: 5, ratio: 0.4, percent: 40 });
      assert.deepEqual(network.bookingsBySource, { phone: 1, "walk-in": 1, calendar: 1, "amal-network": 1, unknown: 1 });
      assert.deepEqual(left.collisions, { sameDoctorSameStartPairs: 3, samePatientSameStartCrossClinicPairs: 2 });
      assert.deepEqual(right.collisions, { sameDoctorSameStartPairs: 0, samePatientSameStartCrossClinicPairs: 2 });
      assert.equal(network.collisions.samePatientSameStartCrossClinicPairs, 2, "clinic totals deliberately not additive");
      const weekday = Number(formatInTimeZone(at, "Asia/Hebron", "i")) % 7;
      assert.equal(network.weekdays[weekday].noShow.denominator, 5);
      const empty = await aggregateAppointments(client, "after", "2096-01-01T00:00:00Z", "2096-01-02T00:00:00Z", clinics[0]);
      assert.deepEqual(empty.noShow, { numerator: 0, denominator: 0, ratio: null, percent: null });
      assert.equal(empty.clinics.length, 1);
      assert.deepEqual(empty.clinics[0].noShow, empty.noShow);
      assert(empty.weekdays.every(d => d.noShow.ratio === null && d.noShow.percent === null));
      const serial = JSON.stringify(network);
      for (const secret of ["private-doctor", "patientId", "doctorId", "appointmentId", "clientOpId", "diagnosis"]) {
        assert(!serial.includes(secret), secret);
      }
    });

    await t.test("session timezone and DST boundaries cannot change aggregate instants or weekdays", async () => {
      for (const date of ["2026-03-28", "2026-10-24"]) {
        const lower = fromZonedTime(`${date}T00:00:00`, "Asia/Hebron").toISOString();
        const upper = fromZonedTime(`${date}T23:59:59.999`, "Asia/Hebron").toISOString();
        await client.query("SET LOCAL TIME ZONE 'Pacific/Honolulu'");
        const a = await aggregateAppointments(client, "before", lower, upper, null);
        const telemetry = await aggregateTelemetry(client, lower, upper, clinics[0]);
        assert.deepEqual(telemetry.conflicts.daily.map(d => d.date), [date]);
        await client.query("SET LOCAL TIME ZONE 'Asia/Tokyo'");
        assert.deepEqual(await aggregateAppointments(client, "before", lower, upper, null), a);
        assert.deepEqual(await aggregateTelemetry(client, lower, upper, clinics[0]), telemetry);
      }
    });

    await t.test("durable logical commit outcomes deduplicate retries, previews, overrides, resolutions and received sync creates", async () => {
      const { rows: [actor] } = await client.query(`INSERT INTO operational.users(email,password_hash,role)
        VALUES($1,'unused','administrator') RETURNING id`, [`${marker}@kpi.test`]);
      const devices: number[] = [];
      for (let i = 0; i < 2; i++) {
        devices.push((await client.query(`INSERT INTO operational.devices(clinic_id,label) VALUES($1,'kpiTest') RETURNING id`, [clinics[0]])).rows[0].id);
      }
      const day1 = "2097-06-04T10:00:00Z", day2 = "2097-06-05T10:00:00Z";
      let sequence = 0;
      const operation = async (status: string, time: string, code: string | null, warning = false, resolved = false, receipt = true, target = "create") => {
        const id = randomUUID(), conflictId = status === "conflict" ? randomUUID() : null;
        await client.query(`INSERT INTO operational.appointment_operations
          (client_op_id,actor_id,clinic_id,doctor_id,payload_hash,result,created_at,status,request,device_id,conflict_id)
          VALUES($1,$2,$3,$4,'test',$5,$6,$7,$8,$9,$10)`,
        [id, actor.id, clinics[0], doctors[0], JSON.stringify(code ? { code } : { id: 1 }), time, status,
          JSON.stringify({ target, payload: {} }), devices[0], conflictId]);
        if (conflictId) {
          await client.query(`INSERT INTO operational.sync_conflicts
            (id,client_op_id,actor_id,clinic_id,doctor_id,operation,reasons,status,created_at)
            VALUES($1,$2,$3,$4,$5,'{}',$6,$7,$8)`,
          [conflictId, id, actor.id, clinics[0], doctors[0], JSON.stringify([{ severity: warning ? "warning" : "block" }]), resolved ? "resolved" : "open", time]);
        }
        if (receipt) {
          sequence++;
          for (const device of devices) {
            await client.query("INSERT INTO operational.sync_device_operations(device_id,sequence,client_op_id) VALUES($1,$2,$3)", [device, sequence, id]);
          }
        }
        return id;
      };
      const originalBlocked = await operation("conflict", day1, "APPOINTMENT_CONFLICT");
      await operation("conflict", day1, "APPOINTMENT_CONFLICT", true);
      await operation("conflict", day1, "APPOINTMENT_CONFLICT", false, true);
      await operation("rejected", day2, "HOLD_EXPIRED");
      const override = await operation("applied", day2, null);
      await operation("conflict", day2, "VERSION_CONFLICT", false, false, false, "update:1");
      await operation("applied", day2, null, false, false, false, `resolve:${randomUUID()}`);
      for (let i = 0; i < 3; i++) {
        await client.query(`INSERT INTO operational.audit_log(user_id,clinic_id,action,detail,at)
          VALUES($1,$2,'appointment.patient_overlap_override',$3,$4)`,
        [actor.id, clinics[0], JSON.stringify({ clientOpId: override, reason: "private override text" }), day2]);
      }
      await client.query(`INSERT INTO operational.audit_log(clinic_id,action,detail,at)
        VALUES($1,'appointment.preview','{"warning":true}',$2)`, [clinics[0], day1]);
      const telemetryStart = fromZonedTime("2097-06-04T00:00:00", "Asia/Hebron").toISOString();
      const telemetryEnd = fromZonedTime("2097-06-06T00:00:00", "Asia/Hebron").toISOString();
      const result = await aggregateTelemetry(client, telemetryStart, telemetryEnd, clinics[0]);
      assert.deepEqual(result.conflicts.cumulative, { blocked: 3, warnings: 2, overrides: 1 });
      assert.deepEqual(result.conflicts.daily, [
        { date: "2097-06-04", blocked: 3, warnings: 1, overrides: 0, cumulativeBlocked: 3, cumulativeWarnings: 1, cumulativeOverrides: 0 },
        { date: "2097-06-05", blocked: 0, warnings: 1, overrides: 1, cumulativeBlocked: 3, cumulativeWarnings: 2, cumulativeOverrides: 1 },
      ]);
      assert.equal(result.downtime.receivedCreates, 5);
      assert.equal(result.downtime.synced, 2);
      assert.equal(result.downtime.conflicted, 2);
      assert.equal(result.downtime.rejected, 1);
      assert.equal(result.downtime.pending, 0);
      assert.deepEqual(result.downtime.queued, { available: false, reason: "CLIENT_QUEUE_NOT_OBSERVED", value: null });
      assert.deepEqual(result.downtime.lost, { available: false, reason: "CLIENT_LOSS_NOT_OBSERVED", value: null });
      assert.equal(result.lookupTime.medianSeconds, null);
      assert.equal(result.lookupTime.sampleCount, 0);
      assert.equal(result.lookupTime.reason, "NO_LOOKUP_SAMPLES");
      assert.equal(result.networkActivity.reason, "LOGICAL_NETWORK_LOOKUP_PRODUCER_UNAVAILABLE");
      assert.equal(result.networkActivity.daily, null);
      assert(!JSON.stringify(result).includes("private override text"));
      assert(!JSON.stringify(result).includes(override));
      const resolutionId = await operation("applied", day2, null, false, false, false, "resolve:test");
      await client.query(`INSERT INTO operational.sync_resolution_history(conflict_id,client_op_id,actor_id,action,result,created_at)
        SELECT conflict_id,$2,$3,'move-self',$4,$5 FROM operational.appointment_operations WHERE client_op_id=$1`,
      [originalBlocked, resolutionId, actor.id, JSON.stringify({ status: "open", error: { code: "APPOINTMENT_CONFLICT" } }), day2]);
      const resolvedAttempt = await aggregateTelemetry(client, telemetryStart, telemetryEnd, clinics[0]);
      assert.equal(resolvedAttempt.conflicts.cumulative.blocked, 4);
      assert.equal(resolvedAttempt.downtime.receivedCreates, 5, "resolution wrapper is not another queued create");
      const other = await aggregateTelemetry(client, telemetryStart, telemetryEnd, clinics[1]);
      assert.deepEqual(other.conflicts.cumulative, { blocked: 0, warnings: 0, overrides: 0 });
      assert.equal(other.downtime.receivedCreates, 0);
    });

    await t.test("adoption projects only existing state and dates, without inventing Trial history", async () => {
      for (let i = 0; i < 2; i++) {
        const result = await aggregateAdoption(client, clinics[i]);
        assert.equal(result.clinics.length, 1);
        assert.equal(result.clinics[0].clinicId, clinics[i]);
        assert.equal(result.clinics[0].state, i ? "full" : "lite");
        assert.equal(Date.parse(result.clinics[0].joinedAt!), Date.parse("2090-01-01T01:02:03Z"));
        assert.deepEqual(result.counts, { trial: null, lite: i ? 0 : 1, full: i ? 1 : 0 });
        assert.equal(result.history.reason, "ADOPTION_TRANSITION_HISTORY_UNAVAILABLE");
      }
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      const utc = await aggregateAdoption(client, null);
      await client.query("SET LOCAL TIME ZONE 'Pacific/Honolulu'");
      assert.deepEqual(await aggregateAdoption(client, null), utc);
    });
    await client.query("ROLLBACK");
    assert.deepEqual(await seedSnapshot(), before, "all six seed contents unchanged");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
