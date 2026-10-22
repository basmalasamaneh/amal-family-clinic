import { z } from 'zod';
import type { Appointment, SyncConflict, SyncResolutionResult, SyncResolutionHistoryResult, SyncOutcome } from '@workspace/api-client-react';
import type { LocalCacheDatabase } from './database';
import type { Scope, SyncPage, ResolveConflictInput, ResolutionIntent } from './types';
import { requireValid, utcInstant } from './projections';

// Unlike generated API Zod these schemas preserve ISO strings, never Date objects.
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1).max(4096);
const uuid = z.string().uuid();
const instant = z.string().refine(v => { try { utcInstant(v); return true; } catch { return false; } }).transform(v => utcInstant(v));
const status = z.enum(['booked', 'arrived', 'completed', 'cancelled', 'no_show', 'double_booked']);
const source = z.enum(['phone', 'walk-in', 'online', 'import']);
const interval = { startsAt: instant, endsAt: instant };
const appointment = z.object({ id, clinicId: id, doctorId: id, patientId: id, ...interval,
  source, status, version: id, clientOpId: uuid.nullable().optional() }).refine(a => Date.parse(a.endsAt) > Date.parse(a.startsAt));
const reasonText = z.string().min(1).max(2000).refine(v => !!v.trim());
const create = z.object({ clientOpId: uuid, clinicId: id, doctorId: id, patientId: id, ...interval, source, overrideReason: reasonText.optional() })
  .refine(a => Date.parse(a.endsAt) > Date.parse(a.startsAt));
const update = z.object({ clientOpId: uuid, expectedVersion: id, startsAt: instant.optional(), endsAt: instant.optional(),
  status: status.optional(), overrideReason: reasonText.optional(), cancelReason: reasonText.optional() });
const error = z.object({ code: text, messageKey: text, params: z.record(z.union([z.string(), z.number().finite(), z.boolean()])) });
const follow = z.object({ status: z.literal('follow-up'), conflictId: text, patientId: id, called: z.literal(false), version: id });
const resolved = z.object({ status: z.literal('resolved'), conflictId: text, appointment, version: id });
const open = z.object({ status: z.literal('open'), conflictId: text, error, version: id });
const safeResult = z.union([follow, resolved, open]);
const response = z.union([follow.extend({ phone: z.string().nullable() }), resolved, open]);
const action = z.enum(['call', 'move-self', 'move-other']);
const history = z.object({ id: text, clientOpId: uuid, action, result: safeResult, createdAt: instant });
const reason = z.union([
  z.object({ type: z.enum(['doctor-overlap', 'patient-overlap', 'same-day-other-clinic', 'outside-hours', 'slot-held']),
    with: z.object({ appointmentId: id, clinicId: id }).nullable(), severity: z.enum(['blocking', 'warning', 'info']),
    suggestedSlots: z.array(z.object(interval).refine(a => Date.parse(a.endsAt) > Date.parse(a.startsAt))) }),
  error.extend({ conflictId: text }),
]);
const conflictSchema = z.object({ id: text, clientOpId: uuid,
  operation: z.object({ target: text, payload: z.union([create, update]) }), targetId: id.nullable(), baseVersion: id.nullable(),
  serverState: appointment.nullable(), reasons: z.array(reason), status: z.enum(['open', 'resolved']), version: id,
  createdAt: instant, updatedAt: instant, history: z.array(history) });
const base = { clientOpId: uuid, conflictId: text, expectedVersion: id };
const move = { ...base, ...interval, targetExpectedVersion: id.optional(), overrideReason: reasonText.optional() };
const inputSchema = z.union([
  z.object({ ...base, action: z.literal('call') }),
  z.object({ ...move, action: z.literal('move-self') }),
  z.object({ ...move, action: z.literal('move-other'), otherAppointmentId: id, otherExpectedVersion: id }),
]);
function parse<T>(schema: z.ZodTypeAny, value: unknown): T {
  const result = schema.safeParse(value);
  requireValid(result.success);
  return result.data as T;
}
/** Runtime validation is required even for typed callers and duplicate acknowledgements. */
export function parseBookingOutcome(raw: SyncOutcome): SyncOutcome {
  const identity = { clientOpId: uuid, sequence: id };
  const machineError = error.extend({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/) });
  return parse<SyncOutcome>(z.union([
    z.object({ ...identity, status: z.literal('applied'), result: appointment }),
    machineError.extend({ ...identity, status: z.literal('conflict'), conflictId: uuid }),
    z.object({ ...identity, status: z.literal('rejected'), error: machineError }),
    machineError.extend({ ...identity, status: z.literal('blocked'), code: z.literal('PREDECESSOR_UNRESOLVED') }),
    machineError.extend({ ...identity, status: z.literal('blocked'), code: z.literal('SEQUENCE_GAP'), expectedSequence: id }),
  ]), raw);
}
const rows = <T extends Scope>(table: import('dexie').Table<T, any>, scope: Scope) =>
  table.where('[userId+clinicId]').equals([scope.userId, scope.clinicId]);
const key = (scope: Scope, value: string): [string, number, string] => [scope.userId, scope.clinicId, value];
function scopedAppointment(a: Appointment, scope: Scope) { requireValid(a.clinicId === scope.clinicId); }
function validateConflict(c: SyncConflict, scope: Scope) {
  requireValid(c.clientOpId === c.operation.payload.clientOpId);
  if ('clinicId' in c.operation.payload) requireValid(c.operation.payload.clinicId === scope.clinicId && c.targetId === null);
  else requireValid(c.targetId !== null && c.baseVersion !== null);
  requireValid(c.operation.target === (c.targetId === null ? 'create' : `update:${c.targetId}`));
  if (c.serverState) {
    scopedAppointment(c.serverState, scope);
    requireValid(c.targetId === c.serverState.id);
  }
  for (const r of c.reasons) if ('with' in r && r.with) requireValid(r.with.clinicId === scope.clinicId);
  let version = 1;
  for (const h of c.history) {
    requireValid(h.result.conflictId === c.id && h.result.version <= c.version);
    requireValid(h.result.version > version);
    version = h.result.version;
    if (h.result.status === 'resolved') scopedAppointment(h.result.appointment, scope);
  }
  requireValid(new Set(c.history.map(h => h.clientOpId)).size === c.history.length);
  requireValid((c.status === 'resolved') === c.history.some(h => h.result.status === 'resolved'));
}

export async function applyPage(db: LocalCacheDatabase, scope: Scope, raw: SyncPage) {
  const payload = z.object({ id, clinicId: id, doctorId: id, patientId: id, ...interval, source: text,
    clientOpId: uuid.nullable(), status, version: id, deleted: z.boolean() })
    .refine(a => Date.parse(a.endsAt) > Date.parse(a.startsAt));
  const change = z.union([
    z.object({ id: z.string().regex(/^[1-9]\d*$/), kind: z.literal('appointment'), entityId: text, payload }),
    z.object({ id: z.string().regex(/^[1-9]\d*$/), kind: z.literal('conflict'), entityId: text,
      payload: z.object({ id: text, actorId: id, status: z.enum(['open', 'resolved']), version: id, clientOpId: uuid }) }),
  ]);
  const page = parse<SyncPage>(z.object({ changes: z.array(change), nextCursor: text.nullable(), since: text }), raw);
  let previous = 0n;
  for (const c of page.changes) {
    requireValid(BigInt(c.id) > previous); previous = BigInt(c.id);
    requireValid(c.entityId === String(c.payload.id));
    if (c.kind === 'appointment') {
      requireValid(c.payload.clinicId === scope.clinicId);
      const { deleted, source: _source, ...a } = c.payload;
      const appointmentKey: [string, number, number] = [scope.userId, scope.clinicId, a.id];
      const tombstone = await db.syncTombstones.get(appointmentKey);
      // A bootstrap replays old upserts: only a strictly newer feed entry can revive an ID.
      if (tombstone && BigInt(c.id) <= BigInt(tombstone.changeId)) continue;
      if (deleted) {
        await db.appointments.delete(appointmentKey);
        await db.syncTombstones.put({ ...scope, id: a.id, changeId: c.id });
      } else {
        await db.appointments.put({ ...a, ...scope });
        await db.syncTombstones.delete(appointmentKey);
      }
    } else {
      // Feed status alone is not resolution evidence. Full details must be fetched.
      requireValid(String(c.payload.actorId) === scope.userId.replace(/^account:/, ''));
    }
  }
  await db.syncCursors.put({ ...scope, cursor: page.nextCursor ?? page.since });
}

async function applyResolved(db: LocalCacheDatabase, scope: Scope, c: SyncConflict, result: SyncResolutionHistoryResult, now: Date) {
  if (result.status !== 'resolved') return;
  const a = result.appointment;
  scopedAppointment(a, scope);
  const original = c.operation.payload;
  if ('clinicId' in original) requireValid(a.doctorId === original.doctorId && a.patientId === original.patientId && a.source === original.source);
  else requireValid(a.id === c.targetId);
  const p = await db.proposals.get(key(scope, c.operation.payload.clientOpId));
  if (p) {
    const delivered = p.deliveryInput ?? p.input;
    requireValid(a.doctorId === delivered.doctorId && a.patientId === delivered.patientId);
    const prior = p.canonicalHistory ?? (p.canonical ? [p.canonical] : []);
    if (!prior.some(v => JSON.stringify(v) === JSON.stringify(a))) prior.push(a);
    await db.proposals.put({ ...p, canonical: a, canonicalHistory: prior, outcome: 'applied', outcomeCode: null });
    await db.outbox.update(key(scope, p.operationId), { status: 'succeeded', retryAt: null, errorCode: null, updatedAt: now.toISOString() });
  }
  const { source: _source, ...projection } = a;
  if (!await db.syncTombstones.get([scope.userId, scope.clinicId, a.id]))
    await db.appointments.put({ ...projection, ...scope });
}

export async function reconcile(db: LocalCacheDatabase, scope: Scope, raw: SyncConflict[], now: Date) {
  const items = parse<SyncConflict[]>(z.array(conflictSchema), raw);
  for (const c of items) {
    validateConflict(c, scope);
    const old = await db.syncConflicts.get(key(scope, c.id));
    if (old && old.conflict.version > c.version) continue;
    requireValid(!old || old.conflict.clientOpId === c.clientOpId);
    requireValid(!old || old.conflict.status !== 'resolved' || c.status === 'resolved');
    if (!('clinicId' in c.operation.payload) && !c.serverState) {
      requireValid(c.targetId !== null && await db.appointments.get([scope.userId, scope.clinicId, c.targetId]));
    }
    for (const h of c.history) {
      await applyResolved(db, scope, c, h.result, now);
      const intent = await db.resolutionIntents.get(key(scope, h.clientOpId));
      if (intent) {
        requireValid(intent.conflictId === c.id && intent.input.action === h.action);
        await db.resolutionIntents.put({ ...intent, status: 'finished', result: h.result });
      }
    }
    const missing = old?.conflict.history.filter(h => !c.history.some(n => n.clientOpId === h.clientOpId)) ?? [];
    await db.syncConflicts.put({ ...scope, id: c.id, conflict: { ...c,
      history: [...missing, ...c.history].sort((a, b) => a.result.version - b.result.version) } });
  }
}

export async function saveIntent(db: LocalCacheDatabase, scope: Scope, raw: ResolveConflictInput, now: Date): Promise<ResolutionIntent> {
  const input = parse<ResolveConflictInput>(inputSchema, raw);
  if (input.action !== 'call') requireValid(Date.parse(input.endsAt) > Date.parse(input.startsAt));
  const existing = await db.resolutionIntents.get(key(scope, input.clientOpId));
  if (existing) { requireValid(JSON.stringify(existing.input) === JSON.stringify(input)); return existing; }
  const c = (await db.syncConflicts.get(key(scope, input.conflictId)))?.conflict;
  requireValid(c && c.status === 'open' && c.version === input.expectedVersion && c.clientOpId !== input.clientOpId);
  requireValid(!await db.proposals.get(key(scope, input.clientOpId)) && !await db.outbox.get(key(scope, input.clientOpId)));
  requireValid(!await rows(db.resolutionIntents, scope).filter(i => i.conflictId === input.conflictId && i.status === 'pending').count());
  const intent: ResolutionIntent = { ...scope, clientOpId: input.clientOpId, conflictId: input.conflictId,
    input, status: 'pending', createdAt: now.toISOString(), result: null };
  await db.resolutionIntents.add(intent);
  return intent;
}

export async function finishIntent(db: LocalCacheDatabase, scope: Scope, clientOpId: string, raw: SyncResolutionResult, now: Date) {
  const checked = parse<SyncResolutionResult>(response, raw);
  const result = parse<SyncResolutionHistoryResult>(safeResult, checked); // phone is intentionally stripped
  const intent = await db.resolutionIntents.get(key(scope, clientOpId));
  requireValid(intent && intent.status !== 'rejected' && intent.conflictId === result.conflictId && result.version === intent.input.expectedVersion + 1);
  requireValid(result.status === 'open' || (intent.input.action === 'call') === (result.status === 'follow-up'));
  if (intent.status === 'finished') { requireValid(JSON.stringify(intent.result) === JSON.stringify(result)); return; }
  const c = (await db.syncConflicts.get(key(scope, result.conflictId)))?.conflict;
  requireValid(c);
  if (result.status === 'follow-up' && 'patientId' in c.operation.payload)
    requireValid(result.patientId === c.operation.payload.patientId);
  if (result.status === 'resolved' && intent.input.action === 'move-self') {
    requireValid(utcInstant(result.appointment.startsAt) === utcInstant(intent.input.startsAt) &&
      utcInstant(result.appointment.endsAt) === utcInstant(intent.input.endsAt));
  }
  await applyResolved(db, scope, c, result, now);
  const next: SyncConflict = { ...c, version: Math.max(c.version, result.version),
    status: result.status === 'resolved' ? 'resolved' : c.status, updatedAt: now.toISOString(),
    history: [...c.history.filter(h => h.clientOpId !== clientOpId), {
      id: `local:${clientOpId}`, clientOpId, action: intent.input.action, result, createdAt: now.toISOString(),
    }] };
  await db.syncConflicts.put({ ...scope, id: c.id, conflict: next });
  await db.resolutionIntents.put({ ...intent, status: 'finished', result });
}

export async function readState(db: LocalCacheDatabase, scope: Scope) {
  const conflicts = (await rows(db.syncConflicts, scope).toArray()).map(r => r.conflict);
  const intents = await rows(db.resolutionIntents, scope).toArray();
  intents.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.clientOpId.localeCompare(b.clientOpId));
  const tombstoneIds = (await rows(db.syncTombstones, scope).toArray()).map(row => row.id).sort((a, b) => a - b);
  return { cursor: (await db.syncCursors.get([scope.userId, scope.clinicId]))?.cursor ?? null, conflicts, intents, tombstoneIds };
}
