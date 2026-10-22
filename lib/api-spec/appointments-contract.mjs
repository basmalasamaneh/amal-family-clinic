// Appointment-only contract extension; leaves unrelated service contracts intact.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function applyAppointmentsContract(spec) {
  const s = spec.components.schemas;
  const ref = name => ({ $ref: `#/components/schemas/${name}` });
  const instant = { type: "string", format: "date-time", description: "UTC ISO 8601 instant ending in Z; enforced by the appointment service before coercion." };
  const id = { type: "integer", minimum: 1 };
  const reason = { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" };
  const token = { type: "string", format: "uuid" };
  const statuses = ["booked", "double_booked", "completed", "no_show", "cancelled"];
  const object = (properties, required, example) => ({
    type: "object", additionalProperties: false, properties, required, examples: [example],
  });
  const example = s.AppointmentInput.examples[0];
  for (const name of ["AppointmentInput", "AppointmentUpdate"]) {
    s[name].description = "Patient overlaps always block across clinics. Legacy overrideReason is retained for compatibility but cannot permit an overlap.";
    Object.assign(s[name].properties, { overrideReason: reason, holdToken: token });
    s[name].properties.startsAt = instant;
    s[name].properties.endsAt = instant;
  }
  s.Appointment.properties.clientOpId = { type: ["string", "null"] };
  s.Appointment.properties.source = { type: "string" };
  for (const name of ["Appointment", "AppointmentUpdate"]) s[name].properties.status.enum = statuses;
  s.AppointmentUpdate.examples[0].status = "completed";
  s.AppointmentUpdate.properties.cancelReason = reason;
  s.AppointmentCheckInput = object({
    ...s.AppointmentInput.properties, appointmentId: id, expectedVersion: id,
  }, ["clinicId", "doctorId", "patientId", "startsAt", "endsAt", "source"], example);
  const holdProperties = { ...s.AppointmentCheckInput.properties };
  delete holdProperties.holdToken;
  delete holdProperties.source;
  delete holdProperties.expectedVersion;
  const { source, ...holdExample } = example;
  s.AppointmentHoldInput = object(holdProperties,
    ["clientOpId", "clinicId", "doctorId", "patientId", "startsAt", "endsAt"], holdExample);
  s.AppointmentHold = object({ token, expiresAt: instant }, ["token", "expiresAt"], {
    token: "00000000-0000-4000-8000-000000000099", expiresAt: "2026-09-09T07:00:30Z",
  });
  for (const name of ["AppointmentCheckInput", "AppointmentHoldInput"]) {
    s[name].description = "Patient overlaps always block across clinics. Legacy overrideReason is retained for compatibility but cannot permit an overlap.";
  }
  s.ConflictItem.properties.type.enum = [
    "doctor-overlap", "patient-overlap", "same-day-other-clinic", "outside-hours", "slot-held",
  ];
  s.ConflictItem.properties.with = { oneOf: [
    object({ appointmentId: id, clinicId: id }, ["appointmentId", "clinicId"], { appointmentId: 402, clinicId: 101 }),
    { type: "null" },
  ] };
  s.ConflictItem.properties.severity.enum = ["blocking", "warning", "info"];
  s.ConflictPreview.description = "Exactly {ok, conflicts}. ok means committing is permitted by current rules, not a reservation. Patient overlaps always block across all clinics: the same patient ID, or different IDs with all three exact normalized name, phone and date of birth values matching. No override reason or authorization permits an overlap. Legacy patient warning responses must also be treated as blocking. Same-day other-clinic nonoverlap is informational and needs no reason. Conflict details must not disclose matched patient identifiers. Preview has no appointment/audit writes.";
  const paths = spec.paths;
  const list = paths["/appointments"].get;
  list.parameters = list.parameters.filter(p => !["patientId", "status"].includes(p.name));
  list.parameters.push(
    { name: "patientId", in: "query", required: false, schema: id, example: 301 },
    { name: "status", in: "query", required: false, schema: { type: "string", enum: statuses }, example: "booked" },
  );
  paths["/appointments/check"].post.requestBody.content["application/json"].schema = ref("AppointmentCheckInput");
  const make = (method, operationId, body, result, status) => {
    const op = structuredClone(paths["/appointments"].post);
    op.operationId = operationId;
    op.parameters = [];
    op.requestBody.content["application/json"] = { schema: ref(body), example: s[body].examples[0] };
    delete op.responses["201"];
    op.responses[status] = result ? {
      description: "Success", content: { "application/json": { schema: ref(result), example: s[result].examples[0] } },
    } : { description: "Released (idempotent)" };
    op.description = method === "post"
      ? "Acquire an exact owner/doctor/clinic/interval hold for 30 server-timed seconds. No renewal; retrying clientOpId returns original token and expiry. Booking always rechecks. No appointment or override audit writes."
      : "Release an owned hold using clientOpId. Another owner cannot release it. Expiry requires no cleanup job.";
    op["x-implementation"] = "real";
    return op;
  };
  paths["/appointments/holds"] = { post: make("post", "acquireAppointmentHold", "AppointmentHoldInput", "AppointmentHold", "201") };
  const release = make("delete", "releaseAppointmentHold", "OperationInput", null, "204");
  release.parameters = [{ name: "token", in: "path", required: true, schema: token, example: s.AppointmentHold.examples[0].token }];
  paths["/appointments/holds/{token}"] = { delete: release };
  for (const path of ["/appointments", "/appointments/{id}", "/appointments/check"]) {
    for (const op of Object.values(paths[path])) {
      op["x-implementation"] = "real";
      op.description = "Operational appointments only. Doctor/front-desk within own clinic, doctor within own doctor scope. UTC instants, Asia/Hebron working hours. Cancel through PATCH status=cancelled; history is retained. All mutations require actor-bound clientOpId; edits require expectedVersion. See docs/appointments.md.";
    }
  }
  for (const [path, methods] of Object.entries(paths)) {
    if (!path.startsWith("/appointments")) continue;
    for (const op of Object.values(methods)) {
      op.responses["422"] = {
        description: "Invalid scheduling input or missing/invalid clinic settings",
        content: { "application/json": {
          schema: ref("ApiFailure"),
          example: { code: "INVALID_CLINIC_SETTINGS", messageKey: "error.invalidClinicSettings", params: {} },
        } },
      };
    }
  }
  paths["/appointments/{id}"].patch.requestBody.content["application/json"].example.status = "completed";
  spec.info.description = spec.info.description.replace("All domain services are contracts/mocks only in P1-02.", "Authentication and appointments are implemented; other domain services remain contracts/mocks.");
  return spec;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL("./openapi.yaml", import.meta.url);
  writeFileSync(path, JSON.stringify(applyAppointmentsContract(JSON.parse(readFileSync(path, "utf8"))), null, 2) + "\n");
}
