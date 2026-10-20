import { z } from "zod/v4";
import { createInput, updateInput } from "../appointments/service";

const positive = z.number().int().positive();
export const pushInput = z.object({
  operations: z.array(z.discriminatedUnion("type", [
    z.object({ sequence: positive, type: z.literal("create"), input: createInput }).strict(),
    z.object({ sequence: positive, type: z.literal("update"), appointmentId: positive, input: updateInput }).strict(),
  ])).min(1).max(50),
}).strict().refine(v => v.operations.every((op, i) => i === 0 || op.sequence === v.operations[i - 1]!.sequence + 1));
const instant = z.iso.datetime({ offset: false }).transform(v => new Date(v).toISOString());
export const resolveInput = z.discriminatedUnion("action", [
  z.object({ clientOpId: z.uuid(), conflictId: z.uuid(), expectedVersion: positive, action: z.literal("call") }).strict(),
  z.object({ clientOpId: z.uuid(), conflictId: z.uuid(), expectedVersion: positive, action: z.literal("move-self"),
    startsAt: instant, endsAt: instant, targetExpectedVersion: positive.optional(), overrideReason: z.string().trim().min(1).max(2000).optional() }).strict(),
  z.object({ clientOpId: z.uuid(), conflictId: z.uuid(), expectedVersion: positive, action: z.literal("move-other"),
    startsAt: instant, endsAt: instant, otherAppointmentId: positive, otherExpectedVersion: positive,
    targetExpectedVersion: positive.optional(), overrideReason: z.string().trim().min(1).max(2000).optional() }).strict(),
]);
