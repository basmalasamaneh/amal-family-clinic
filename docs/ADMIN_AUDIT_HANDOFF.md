# Admin audit feed for P2-10

Use `listAdminAudit` / `useListAdminAudit` from the regenerated frontend client.

`GET /api/admin/audit` accepts:
- `limit`: 1–100, default 25.
- `beforeId`: exclusive pagination boundary; use `nextBeforeId` from the previous response with the same filters.
- `clinicId`, `actorId`: exact positive IDs.
- `action`: the documented `AdminAuditAction` enum only.
- `outcome`: `success` or `denied`.
- `from` inclusive and `to` exclusive: ISO timestamps with timezone; from must precede to.

Returns `{ items, nextBeforeId }` ordered by descending event ID. A null boundary means no further page. New events do not shift the next page; pages are not a frozen snapshot across requests.

Each event contains only `id`, `actorId`, `action`, `clinicId`, `targetType`, `targetId`, `outcome`, and `eventTime`. Nullable IDs represent absent context. Actor names/emails and target values are deliberately not returned. Outcomes are derived from known actions, never untrusted detail fields. Display event time in Asia/Hebron and localize action/outcome labels in the UI.

Only allowlisted administrative/authentication events without a patient subject are exposed. Clinical events, unknown actions, lookup events, patient IDs, detail JSON, fields/values, clinical text, and secrets are excluded. Malformed target IDs become null. This is an administrative feed, not a complete clinical audit history.

Network administrators may see all permitted events. Clinic administrators see only events whose recorded clinic matches their current clinic; null-clinic events are excluded. Requesting another clinic returns 403. Every page reauthorizes. No-store responses and read-only authentication prevent cache/session-refresh side effects. No audit records or seed tables are modified.

The existing doctor-only `/api/audit` route and response remain unchanged.

Contract source: `docs/admin-audit-contract.json`, composed into `lib/api-spec/openapi.yaml`.
