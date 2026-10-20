import type { Page } from '@playwright/test';
import type { AdminClinic, NetworkHealth, AdminAuditEvent } from '@workspace/api-client-react';

// Deliberately unrelated to demo IDs/names. Only the API is mocked; real shell,
// authorization, localization, formatting and frontend request adapters run.
export const exampleClinic = (id = 76543, name = 'عيادة الاختبار Cedar'): AdminClinic => ({
  id, name, city: 'Synthetic city', bookingMethod: 'phone', slotMinutes: 30,
  workingDays: [0, 1, 5], openTime: '07:45', closeTime: '19:15',
  timezone: 'Asia/Hebron', mode: 'full', joinedAt: '2026-10-19T09:00:00Z',
});
export const health = (clinics: AdminClinic[]): NetworkHealth => ({
  generatedAt: '2026-10-20T09:00:00Z', heartbeatTimeoutSeconds: 90,
  clinics: clinics.map(c => ({
    clinicId: c.id, clinicName: c.name, networkMode: c.mode,
    connectivity: 'offline', lastHeartbeatAt: null, lastSuccessfulSyncAt: null,
    serverOpenConflictCount: 0, unsubmittedOperationCount: null,
    queueCoverage: { registeredDeviceCount: 0, trustedDeviceCount: 0, freshDeviceCount: 0,
      staleDeviceCount: 0, unknownDeviceCount: 0, revokedDeviceCount: 0, complete: false },
    devices: [],
  })),
});
export const auditEvent = (id: number, clinicId: number): AdminAuditEvent => ({
  id, clinicId, actorId: 42, action: 'admin.clinic.created', targetType: 'clinic',
  targetId: clinicId, outcome: 'success', eventTime: '2026-10-20T09:00:00Z',
});

export async function bootAdmin(page: Page, opts: { role?: string; locale?: string; theme?: string } = {}) {
  const { role = 'admin', locale = 'en', theme = 'light' } = opts;
  const clinics = [exampleClinic()];
  const writes: { path: string; body: unknown }[] = [];
  await page.addInitScript(p => {
    localStorage.setItem(`amal.tour.v1:account%3A42:${p.role}`, 'dismissed');
    localStorage.setItem(`amal.tour.v1:account:42:${p.role}`, 'dismissed');
    localStorage.setItem('amal.display.v1:account%3A42', JSON.stringify({
      locale: p.locale, theme: p.theme, digitPreference: 'latn',
    }));
  }, { role, locale, theme });
  await page.route('**/api/**', async r => {
    const req = r.request(), url = new URL(req.url()), path = url.pathname;
    if (path === '/api/me') return r.fulfill({ json: {
      id: 42, email: 'synthetic@example.invalid', role, clinicId: null, doctorId: null,
      locale, theme, csrfToken: 'test-only-csrf', device: null,
      session: { expiresAt: '2030-01-01T00:00:00Z', absoluteExpiresAt: null, idleTimeoutSeconds: 1800 },
      reauth: { required: false, validUntil: null },
    } });
    if (req.method() === 'GET') {
      if (path === '/api/admin/clinics') return r.fulfill({ json: { items: clinics, nextCursor: null } });
      if (path === '/api/clinics') return r.fulfill({ json: { items: clinics.map(c => ({
        id: c.id, name: c.name, timezone: c.timezone, mode: c.mode === 'full' ? 'network' : 'lite',
      })), nextCursor: null } });
      if (path === '/api/network/health') return r.fulfill({ json: health(clinics) });
      if (path === '/api/admin/audit') return r.fulfill({ json: { items: [auditEvent(98765, clinics[0].id)], nextBeforeId: null } });
      if (path === '/api/admin/doctors') return r.fulfill({ json: { items: [], nextCursor: null } });
      if (['/api/admin/users', '/api/auth/devices'].includes(path))
        return r.fulfill({ json: { items: [], page: 1, pageSize: 25, total: 0 } });
    }
    if (req.method() === 'POST' && path === '/api/clinics') {
      const body = req.postDataJSON();
      writes.push({ path, body });
      const created = { ...body, id: 98671, joinedAt: '2026-10-20T09:00:00Z' } as AdminClinic;
      clinics.push(created);
      return r.fulfill({ status: 201, json: created });
    }
    return r.fulfill({ status: 503, json: { code: 'INTERNAL', messageKey: 'error.internal', params: {} } });
  });
  return { clinics, writes };
}
