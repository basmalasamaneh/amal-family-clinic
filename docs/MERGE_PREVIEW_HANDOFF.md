# Read-only merge preview

P2-07 can call `previewPatientMerge` / `usePreviewPatientMerge` from the generated frontend client.

- `POST /api/patients/merge/preview`, JSON `{ sourceId, targetId }`. `targetId` is the selected survivor.
- Requires authenticated doctor/front-desk, trusted device for front-desk, and CSRF header. Clinic comes only from the session; doctors require trusted grants to both patients.
- Returns source/target IDs and current versions, `canMerge`, `blockers`, and safe reference information.
- Appointment counts are current-clinic only, further restricted to the authenticated doctor's appointments for doctors. They are not global move totals.
- Clinical references are always withheld. Audit history remains attached to the original source. No clinical text, record IDs, consent details, or cross-clinic counts are exposed.
- `MERGE_IDENTITY` means the identity/guardian requirements do not match. `MERGE_RESTRICTED` deliberately hides which protected safety check blocked the merge. Render these codes through UI translations; do not offer a force-merge option.
- Same-record and already-merged selections are blocked. Missing or unauthorized selections both return 404, without a partial preview.
- No writes, session timestamp refresh, audit insert, holds, or merge receipt. The service uses a PostgreSQL repeatable-read, read-only transaction and the HTTP response disables caching.
- Preview is advisory. After explicit confirmation, pass its versions to the existing merge request along with reason and clientOpId. Actual merge independently rechecks authorization, identity, versions, references, visibility, consent, and overlaps under its existing transaction/locks. Handle 409 by refreshing the preview; never treat `canMerge` as a reservation.

Canonical contract: `lib/api-spec/openapi.yaml`; domain fragment: `docs/merge-contract.json`. Generated React client and Zod schemas include this endpoint.
