# Auth wire contract (real API)

All paths below use `/api`. JSON is strict (extra input properties rejected).
Wire roles: `admin`, `doctor`, `front-desk` (DB: administrator, doctor, receptionist).

- `POST /auth/login` body `{email:string,password:string}` → 200 Identity for doctor/admin only; receptionist credentials always receive 401 (even with a registered device).
- `POST /auth/pin` body `{email:string,pin:string}` (exactly four ASCII digits) → 200 Identity; requires trusted device cookie.
- `GET /me` → 200 Identity
- `POST /auth/logout` no body → 204
- `POST /auth/reauth` body `{pin:string}` → 200 Identity; authenticated front-desk only, trusted device in same clinic.
- `POST /auth/devices` body `{clinicId:positive integer,label:string}` → 201 `{id:integer,clinicId:integer,label:string}`; admin only, clinic-scoped admin restricted to own clinic. Installs device credential ONLY in HttpOnly cookie on current browser, never JSON.
- `DELETE /auth/devices/{id}` positive integer ID → 204; admin same scope, revokes associated sessions immediately.

Identity: `{id:number,email:string,role:"admin"|"doctor"|"front-desk",clinicId:number|null,doctorId:number|null,locale:"ar"|"en",theme:"light"|"dark",session:{expiresAt:UTC ISO string,absoluteExpiresAt:UTC ISO string|null,idleTimeoutSeconds:number|null},device:{id:number,clinicId:number}|null,reauth:{required:boolean,validUntil:UTC ISO string|null},csrfToken:string}`.
CSRF token is not a session credential; use `X-CSRF-Token` on authenticated mutations. Session and device credentials are opaque HttpOnly SameSite=Strict cookies, Secure in production. Login/PIN also require an explicitly allowed Origin header (prevents login CSRF). GET /me provides CSRF token after reload.

All errors exactly `{code:string,messageKey:string,params:object}`. Codes / message keys: VALIDATION/error.validation (400), UNAUTHORIZED/error.unauthorized (401), FORBIDDEN/error.forbidden (403), CSRF/error.csrf (403), REAUTH_REQUIRED/error.reauthRequired (403), NOT_FOUND/error.notFound (404), CONFLICT/error.conflict (409), PIN_LOCKED/error.pinLocked (423), RATE_LIMITED/error.rateLimited (429), INTERNAL/error.internal (500). Lock/rate errors may contain `retryAfterSeconds:number`; no credential or account existence details.

No business endpoints implemented here. Admin is NOT a clinical role. Reauthentication freshness: five minutes for front-desk consent changes/withdrawal, import commits, patient merge, sensitive exports; future services must install the exported guard. Reception sessions absolute 8h; doctor/admin idle 30m. PIN lock fifth failure, default 15m configurable; persistent account/device/IP throttles apply independently.
