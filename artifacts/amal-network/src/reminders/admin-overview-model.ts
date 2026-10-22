import type { ShellIdentity } from '@/shell/identity';
import { formatInstant } from '@/shell/formatting';

export function isGlobalReminderAdmin(identity: Pick<ShellIdentity, 'role' | 'homeClinicId'>): boolean {
  return identity.role === 'admin' && identity.homeClinicId == null;
}

export interface OverviewCounts { scheduledCount: number; sentCount: number; cancelledCount: number }
/** Every returned clinic, including disabled clinics; no log-page projection. */
export function overviewTotals(clinics: readonly OverviewCounts[]): OverviewCounts {
  return clinics.reduce((sum, clinic) => ({
    scheduledCount: sum.scheduledCount + clinic.scheduledCount,
    sentCount: sum.sentCount + clinic.sentCount,
    cancelledCount: sum.cancelledCount + clinic.cancelledCount,
  }), { scheduledCount: 0, sentCount: 0, cancelledCount: 0 });
}

export function overviewInstant(value: string | null, locale: Parameters<typeof formatInstant>[1], digits: Parameters<typeof formatInstant>[2]): string | null {
  if (value === null) return null;
  try { return formatInstant(value, locale, digits); } catch { return null; }
}

export const overviewCopy = {
  en: {
    title: 'Clinic messages overview',
    scope: 'Read-only · All authorized clinics, regardless of the clinic selected above.',
    summary: 'All clinics · All history',
    scheduled: 'Scheduled', sent: 'Sent (trial)', cancelled: 'Cancelled',
    enabled: 'Enabled', disabled: 'Disabled', due: 'Next scheduled · Hebron time',
    none: 'No upcoming messages', asOf: 'Updated', refresh: 'Refresh', refreshing: 'Refreshing',
    loading: 'Loading clinic totals', error: 'Clinic totals are unavailable',
    errorBody: 'No previous totals are shown. Try again to check your current access.',
    offline: 'Connect to view current clinic totals.', retry: 'Try again',
    empty: 'No clinics to display', emptyBody: 'No authorized clinics were returned for this account.',
  },
  ar: {
    title: 'ملخّص رسائل العيادات',
    scope: 'للقراءة فقط · جميع العيادات المصرّح لك بها، بغضّ النظر عن العيادة المختارة أعلاه.',
    summary: 'جميع العيادات · كامل السجل',
    scheduled: 'بانتظار وقت الإرسال', sent: 'أُرسلت (تجريبي)', cancelled: 'أُلغيت',
    enabled: 'مفعّلة', disabled: 'غير مفعّلة', due: 'الموعد القادم · بتوقيت الخليل',
    none: 'لا رسائل قادمة', asOf: 'آخر تحديث', refresh: 'تحديث', refreshing: 'جارٍ التحديث',
    loading: 'جارٍ تحميل إجماليات العيادات', error: 'إجماليات العيادات غير متاحة',
    errorBody: 'لا تُعرض إجماليات سابقة. أعد المحاولة للتحقق من صلاحيتك الحالية.',
    offline: 'اتصل بالإنترنت لعرض إجماليات العيادات الحالية.', retry: 'إعادة المحاولة',
    empty: 'لا توجد عيادات لعرضها', emptyBody: 'لم تُرجع الخدمة عيادات مصرّحًا بها لهذا الحساب.',
  },
};
