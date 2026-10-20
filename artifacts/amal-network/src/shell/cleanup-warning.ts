// Only a cleanup target, never an authorization credential or patient projection.
// Persist the warning across reloads; failure to persist cannot suppress the current warning.
const key = 'amal-incomplete-device-cleanup';
export const UNKNOWN_CLEANUP = '__cleanup-status-unavailable__';
export function readCleanupTarget(): string | null {
  // Denied storage is not evidence that the previous user's cleanup succeeded.
  try { return localStorage.getItem(key); } catch { return UNKNOWN_CLEANUP; }
}
export function rememberCleanupTarget(userId: string | null) {
  try {
    if (userId) localStorage.setItem(key, userId);
    else localStorage.removeItem(key);
  } catch { /* In-memory locked state remains authoritative in this tab. */ }
}
