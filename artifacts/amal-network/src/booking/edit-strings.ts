import { i18n } from '../i18n';

const en = {
  action: 'Edit or reschedule', title: 'Edit appointment', eyebrow: 'Appointment {{id}}', close: 'Close editor',
  loading: 'Loading the latest appointment from the server…',
  loadError: 'Could not load the latest appointment. Nothing was changed.', reload: 'Reload appointment',
  missing: 'This appointment is no longer in this clinic calendar. It may have been moved or removed elsewhere.',
  notEditable: 'Only booked appointments can be rescheduled. Current status: {{status}}.',
  sourceUnsupported: 'This appointment has a booking source that cannot be rescheduled here.',
  fixture: 'Demonstration calendar: editing is disabled.',
  fixed: 'Fixed for this appointment', patient: 'Patient', patientId: 'Patient #{{id}}', doctor: 'Doctor', clinic: 'Clinic', source: 'Source', version: 'Version {{v}}',
  current: 'Currently', proposed: 'New time', unchanged: 'Change the date, time or duration to reschedule.',
  save: 'Save changes', saving: 'Saving…',
  sources: { phone: 'Phone', 'walk-in': 'Walk-in', online: 'Online', import: 'Imported', calendar_app: 'Calendar application', in_person: 'In person', unknown: 'Other' },
  offline: 'You are offline. Saving is disabled until the connection returns.',
  authLost: 'Your session could not be verified. Sign in again before saving.',
  saved: 'Appointment rescheduled.',
  stale: 'Someone else changed this appointment since you opened it. Your new time is kept. Reload the latest version, review it, then save again.',
  staleReload: 'Reload latest version',
  reloaded: 'Latest version loaded (version {{v}}). Your proposed time was kept and is being re-checked.',
  uncertain: 'The save was not confirmed. It may or may not have been applied. The form stays locked: retry the exact same request to get a definitive answer from the server. Retrying never creates a second change.',
  uncertainRetry: 'Retry same request',
  uncertainClose: 'Resolve the unconfirmed save before closing.',
  rejected: 'The server rejected this time. The original appointment is unchanged.',
  holdNote: 'The new slot is held for you for {{s}} seconds.',
};
const ar: typeof en = {
  action: 'تعديل أو إعادة جدولة', title: 'تعديل الموعد', eyebrow: 'الموعد {{id}}', close: 'إغلاق المحرر',
  loading: 'جارٍ تحميل أحدث نسخة من الموعد من الخادم…',
  loadError: 'تعذّر تحميل أحدث نسخة من الموعد. لم يتغير شيء.', reload: 'إعادة تحميل الموعد',
  missing: 'لم يعد هذا الموعد في تقويم هذه العيادة. ربما نُقل أو أُزيل من مكان آخر.',
  notEditable: 'يمكن إعادة جدولة المواعيد المحجوزة فقط. الحالة الحالية: {{status}}.',
  sourceUnsupported: 'مصدر حجز هذا الموعد لا يسمح بإعادة جدولته هنا.',
  fixture: 'تقويم تجريبي: التعديل معطّل.',
  fixed: 'ثابت لهذا الموعد', patient: 'المريض', patientId: 'المريض رقم {{id}}', doctor: 'الطبيب', clinic: 'العيادة', source: 'المصدر', version: 'النسخة {{v}}',
  current: 'الحالي', proposed: 'الموعد الجديد', unchanged: 'غيّر التاريخ أو الوقت أو المدة لإعادة الجدولة.',
  save: 'حفظ التغييرات', saving: 'جارٍ الحفظ…',
  sources: { phone: 'هاتف', 'walk-in': 'حضور مباشر', online: 'عبر الإنترنت', import: 'مستورد', calendar_app: 'تطبيق التقويم', in_person: 'حضوري', unknown: 'آخر' },
  offline: 'أنت غير متصل. الحفظ معطّل حتى يعود الاتصال.',
  authLost: 'تعذّر التحقق من جلستك. سجّل الدخول مرة أخرى قبل الحفظ.',
  saved: 'تمت إعادة جدولة الموعد.',
  stale: 'قام شخص آخر بتعديل هذا الموعد منذ فتحه. تم الاحتفاظ بالوقت الجديد. أعد تحميل أحدث نسخة وراجعها ثم احفظ مرة أخرى.',
  staleReload: 'إعادة تحميل أحدث نسخة',
  reloaded: 'تم تحميل أحدث نسخة (النسخة {{v}}). تم الاحتفاظ بالوقت المقترح ويجري التحقق منه مجددًا.',
  uncertain: 'لم يتم تأكيد الحفظ وقد يكون طُبّق أو لا. يبقى النموذج مقفلًا: أعد إرسال الطلب نفسه تمامًا للحصول على رد نهائي من الخادم. إعادة الإرسال لا تُنشئ تغييرًا ثانيًا.',
  uncertainRetry: 'إعادة إرسال الطلب نفسه',
  uncertainClose: 'احسم الحفظ غير المؤكد قبل الإغلاق.',
  rejected: 'رفض الخادم هذا الوقت. الموعد الأصلي لم يتغير.',
  holdNote: 'الموعد الجديد محجوز لك لمدة {{s}} ثانية.',
};
let done = false;
export function registerEditStrings(): void {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { ed: en }, true, false);
  i18n.addResourceBundle('ar', 'translation', { ed: ar }, true, false);
}
registerEditStrings();
