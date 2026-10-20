import { listPatientConsent, readPatientAccessHistory, reauthenticatePin, recordPatientConsent, withdrawConsent, setCsrfToken, type ConsentInput } from '@workspace/api-client-react';
import { withAuthReport } from '@/booking/errors';
import { ACCESS_LIMIT, parseAccessPage, parseConsentView, type AccessPage, type ConsentView } from './model';

export interface ConsentApi {
  read(patientId: number, signal: AbortSignal): Promise<ConsentView>;
  record(patientId: number, body: ConsentInput): Promise<unknown>;
  withdraw(consentId: number, body: { clientOpId: string }): Promise<unknown>;
  verifyPin(pin: string): Promise<void>;
  accessHistory(patientId: number, cursor: string | null, signal: AbortSignal): Promise<AccessPage>;
}

export const realConsentApi: ConsentApi = {
  async read(patientId, signal) { return parseConsentView(await withAuthReport(listPatientConsent(patientId, { signal, cache: 'no-store' })), patientId); },
  record: (patientId, body) => withAuthReport(recordPatientConsent(patientId, body)),
  withdraw: (consentId, body) => withAuthReport(withdrawConsent(consentId, body)),
  // Not wrapped: a wrong PIN must not be reported as an expired session.
  async verifyPin(pin) {
    const identity = await reauthenticatePin({ pin });
    setCsrfToken(identity.csrfToken);
  },
  async accessHistory(patientId, cursor, signal) {
    const raw = await withAuthReport(readPatientAccessHistory(patientId, { patientRequestConfirmed: true, limit: ACCESS_LIMIT, ...(cursor ? { cursor } : {}) }, { signal, cache: 'no-store' }));
    return parseAccessPage(raw);
  },
};
