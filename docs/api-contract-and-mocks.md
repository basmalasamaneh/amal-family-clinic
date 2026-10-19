# API contract and development mocks

## Source and implementation boundary

`lib/api-spec/openapi.yaml` is the canonical OpenAPI 3.1 document. Its JSON
serialization is valid YAML 1.2. The public URL is `/docs/openapi.yaml`;
operations keep the `/api` base and `Api` title. `build-contract.mjs` is an
authoring helper; it is not run at server startup. Changes must be reflected
in the canonical document, then regenerated with:

```sh
node lib/api-spec/build-contract.mjs
pnpm --filter @workspace/api-spec validate
pnpm --filter @workspace/api-spec codegen
pnpm --filter @workspace/api-server test:contract
```

The helper does not read/write any database. Validation uses OpenAPI validation
plus JSON Schema 2020-12 validation of every component, body, response and
parameter example. Tests exercise all 36 operations, generated Zod bodies and
success responses, all error scenarios, and allowed/denied mock role matrices.
Generated consumers remain in the existing `api-client-react` and `api-zod`
packages. Do not edit generated files.

**Real in P1-02:** health, password/PIN login, logout, current identity,
PIN re-entry and administrator device provisioning/revocation.
Password login is **doctor/admin only**. Front-desk password login is rejected,
including on trusted devices; reception must use the four-digit PIN endpoint
on a trusted registered reception device. Doctor/admin cannot use reception PIN
login. Mock login follows the selected `X-Mock-Role` for this allowed/denied
matrix; PIN calls must select `X-Mock-Role: front-desk`.
See [auth-contract-shapes.md](auth-contract-shapes.md) and
[auth-security.md](auth-security.md) for the real authentication behavior.
Device labels are localization keys, not user-entered names.

**Contract and mocks only:** clinics, doctors, appointments, conflict preview,
patients, network lookup, consent, sync, imports, KPIs, audit browsing,
network health, duplicates and merge. These are not registered as real
business services by this work. The mock does not authenticate anyone,
enforce real consent, write audits, retain sessions, change records, import,
merge, or synchronize a database. Never use it to test real security guarantees.

## Start the isolated mock explicitly

Install workspace development dependencies, then in a separate terminal:

```sh
NODE_ENV=development AMAL_MOCK=1 MOCK_PORT=4010 \
MOCK_FRONTEND_ORIGIN=http://localhost:5173 \
pnpm --filter @workspace/api-server mock
```

The entry is `artifacts/api-server/src/mock/server.mjs`, not `app.ts` or the real
server build. It binds to `127.0.0.1`; no `DATABASE_URL` or real credentials
are needed. Both development mode and opt-in are required. Production and
missing opt-in fail before listening. Real production routes never fall back
to mocks. Set the origin to the exact frontend origin; credentials are allowed
only for that origin. Do not expose this unauthenticated simulator publicly.

For a locally running browser frontend, call
`setBaseUrl("http://127.0.0.1:4010")` from the existing client package before
using generated hooks. Generated paths already contain `/api`, so do not add
it to the base URL. A hosted HTTPS frontend must use an explicitly configured
development proxy to this listener, not an HTTP mixed-content URL. Do not
change the production proxy or real API target to enable mocks.

Every HTTP mock response has `X-Amal-Mock: true` and `Cache-Control: no-store`.
The mock also serves the identical canonical document at `/docs/openapi.yaml`.
There are no real login credentials: syntactically valid synthetic bodies
produce a fixed identity only for roles allowed on that authentication endpoint,
and no credential is echoed. Device trust itself remains simulated, not enforced
as real authentication. The sample
`csrfToken` is an obvious synthetic noncredential.

```sh
curl 'http://127.0.0.1:4010/api/network/lookup?q=Synthetic' \
  -H 'X-Mock-Role: doctor' -H 'X-Mock-Consent: clinical'
curl 'http://127.0.0.1:4010/api/me' -H 'X-Mock-Role: front-desk'
curl 'http://127.0.0.1:4010/api/me' -H 'X-Mock-Scenario: unauthorized'
```

### Deterministic scenario headers

| Header | Values |
| --- | --- |
| `X-Mock-Role` | `doctor` (default), `front-desk`, `admin`; unknown roles denied |
| `X-Mock-Consent` | `basic` (default), `clinical`, `none`, `withdrawn` |
| `X-Mock-Clinic-Mode` | `network` (default), `lite` |
| `X-Mock-Scenario` | `success` (default), `validation`, `unauthorized`, `forbidden`, `missing`, `conflict`, `locked`, `rate-limit`, `internal` |
| Additional scenarios | `clinical`, `withdrawn`, `reviewed`, `reauth-required`, `csrf`, `duplicate`, `rejected`, `no-conflict` |

Fixtures are synthetic, independent of seed tables, and use a fixed
`2026-09-09T07:00:00Z` clock. They are intentionally stateless:
every response is a function of the current request. A mutation does not
change a later GET. Paging parameters are accepted and validated; fixture
pages always contain the same finite data and end with `nextCursor: null`.
No cursor is a credential. Invalid schema inputs return 400. A different
submitted `clinicId` from the synthetic identity's clinic returns 403.
Error scenarios deliberately bypass normal behavior to exercise error UIs.

For consent withdrawal UI, POST withdraw returns a withdrawn record; select
`X-Mock-Consent: withdrawn` on the subsequent lookup to model its effect.
`no-conflict` returns `{ok:true,conflicts:[]}` from conflict preview; otherwise
the example has a blocking overlap and suggested slots. `duplicate` and
`rejected` select sync outcomes; the default cycles applied/duplicate/conflict
across supplied operations, retaining each supplied `clientOpId`.

## Roles, privacy and future enforcement

| Surface | Contract roles and projection |
| --- | --- |
| Identity, clinic/doctor directory, KPI, network health | All known roles, scoped context |
| Clinic create/update, device enrollment/revocation | Administrator, allowed clinic scope |
| Booking, local patient identity, import, sync, duplicate review | Doctor/front-desk, own clinic |
| Patient detail/network lookup | Doctor/front-desk; admin denied |
| Clinical history | Doctor only, active Clinical consent |
| Consent changes, import commit, merge | Doctor/front-desk; front-desk needs PIN within five minutes |
| Audit metadata | Authorized clinic/patient scope; no clinical payload, including for admin |

Reception's projection has identity and clinic coordination fields only,
never visit history. Doctor Basic consent permits visit date, clinic and doctor
summaries, but no complaints, alerts or medication history. Clinical projection
adds clinical notes and key alerts only for doctors with appropriate consent. None/withdrawn
consent produces no network result. Lite-mode clinics are excluded entirely
from network discovery. Network accesses must be audited by future services.
Withdrawal removes future sharing; it does not erase lawful local records.
An administrator is not a clinical superuser. These requirements are documented
and illustrated by the simulator, not falsely claimed as live domain enforcement.

Session identity supplies clinic/doctor authority. Callers cannot establish
authority by submitting a clinic/device ID. Real authentication uses HttpOnly,
SameSite=Strict cookies (Secure in production), explicit allowed Origin for
login/PIN, and session-bound `X-CSRF-Token` from Identity on authenticated
mutations. PIN is a four-character ASCII string; `"0123"` must remain a string.
Reception has an eight-hour absolute lifetime. Doctor/admin idle expiry is
30 minutes (admin is a conservative policy choice).

## Domain integration semantics

- `clientOpId` is an idempotency key scoped to authenticated clinic and operation.
  Repeating the same payload returns the prior result; changing payload under
  the same key returns 409. Mutation responses are not optimistic server writes
  in mock mode. Appointment edits supply `expectedVersion`; stale writes conflict.
- Conflict preview is exactly `{ok, conflicts:[{type,with,severity,suggestedSlots}]}`.
  Blocking doctor overlap prevents booking; patient overlap can be a warning.
  Responses must not expose unrelated patients' identity or clinical information.
- Lists use `cursor` and `limit` (1–100, default 25). `nextCursor: null` means done.
  Sync pull requires opaque `since`; apply a page before persisting its cursor.
  `hasMore` requests another page. Invalid/expired cursors require a new authorized
  bootstrap, never silently omit changes.
- Sync push reports per-operation applied, duplicate, conflict or rejected outcomes.
  Conflicts remain available for explicit discard/reschedule; reschedule requires
  a slot. Atomicity is per operation, not the whole batch.
- Upload currently specifies a bounded JSON transport containing filename,
  `csv`/`ics` format and source content; it is not multipart. A later real service
  may extend transport without silently changing this contract.
- Every one of the **24 import rows requires manual identity review**.
  Three rows have name-only suggestions, not automatic matches; all links start
  null. Phone or DOB verification must precede any link. `map` records explicit
  reviewed link/new-patient/skip decisions; a link requires patientId.
  New patients must be explicitly created with a phone before final linkage.
  Commit with unreviewed rows returns 409 `REVIEW_REQUIRED`.
  The `reviewed` mock scenario models all 24 explicitly skipped, creating zero
  records. It does not approve or import anything. The last row demonstrates
  an overlap conflict. Source text stays data, not translation keys.
- Duplicate suggestions are not identity proof. Different DOB and phone produce
  `not-a-match`, even for the same name. Merge requires explicit human review,
  reason and decision. A future merge retains source redirects and audit/consent
  history; the mock returns `simulated:true` and never performs it.

## Time and localization

API instants are UTC ISO 8601 with an explicit zone. DOB and other date-only
values remain `YYYY-MM-DD`, not midnight instants. Display in Asia/Hebron using
`date-fns-tz` rather than hard-coded UTC offsets:

```ts
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
formatInTimeZone(apiInstant, "Asia/Hebron", "yyyy-MM-dd HH:mm");
// Only newly entered naive local time, NOT an already-normalized seed instant:
fromZonedTime(localDateTime, "Asia/Hebron").toISOString();
```

No timestamp conversion is implemented here, so no new DST conversion test is
claimed. Future input conversion must test DST gaps, overlaps and round trips.
Never apply Asia/Hebron normalization twice to the seed instants. All six seed
tables remain immutable; this code never imports the database package.

Errors have exactly `{code,messageKey,params}`. Translate `messageKey`, never
display server internals. Business/source text remains data. Required error
copy (real auth also carries its own localized resources):

| Key | English | العربية |
| --- | --- | --- |
| `error.validation` | Check the entered values. | يرجى التحقق من القيم المدخلة. |
| `error.unauthorized` | Please sign in. | يرجى تسجيل الدخول. |
| `error.forbidden` | You do not have permission. | ليست لديك صلاحية. |
| `error.csrf` | Refresh and try again. | حدّث الصفحة وحاول مجددًا. |
| `error.reauthRequired` | Re-enter your PIN. | أعد إدخال رمز الدخول. |
| `error.notFound` | Record not found. | لم يتم العثور على السجل. |
| `error.conflict` | Review the conflicting changes. | راجع التغييرات المتعارضة. |
| `error.pinLocked` | PIN access temporarily locked. | تم قفل الدخول بالرمز مؤقتًا. |
| `error.rateLimited` | Too many attempts. Try later. | محاولات كثيرة. حاول لاحقًا. |
| `error.internal` | Unable to complete the request. | تعذر إكمال الطلب. |
| `error.reviewRequired` | Review all import rows first. | راجع جميع صفوف الاستيراد أولًا. |

Status values such as `needs-review`, `withdrawn` and `not-a-match` are stable
machine enums; frontend dictionaries must translate them. No new UI is delivered
here; Arabic RTL, logical CSS, AR/EN and Light/Dark remain consumer requirements.
