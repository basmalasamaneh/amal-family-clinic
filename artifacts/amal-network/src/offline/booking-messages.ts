import { i18n } from '../i18n';

i18n.addResourceBundle('en', 'localBooking', {
  coverage: 'This time is outside the cached scheduling window. Connect and refresh, or choose a covered date. Your entries have been kept.',
  'doctor-overlap': 'This doctor already has a cached appointment or a pending booking at this time. Choose a different time; overlaps cannot be overridden.',
  'identity-not-cached': 'The selected patient or doctor is not cached for this clinic. Connect and refresh the clinic cache before booking.',
  'stream-not-ready': 'This device is not ready for offline booking. Connect on a registered reception device and refresh.',
  unauthorized: 'Private records are locked. Reconnect and sign in to continue.',
  'stale-context': 'Authorization changed. Reconnect and verify your session before trying again.',
  'invalid-data': 'The booking could not be validated. Check the selected patient, doctor and time before retrying.',
  'storage-failed': 'The booking was not saved on this device. Keep this form open, check device storage, then retry.',
  'storage-quota': 'The booking was not saved because device storage is full. Free space without clearing Amal data, then retry.',
  'storage-unavailable': 'Private device storage is unavailable. Allow storage for Amal and retry; the booking has not been saved.',
  'storage-blocked': 'Another tab is blocking device storage. Close the other Amal tabs, then retry. The booking has not been saved.',
});
i18n.addResourceBundle('ar', 'localBooking', {
  coverage: 'هذا الوقت خارج نطاق الجدول المحفوظ. اتصل وحدّث البيانات أو اختر تاريخاً ضمن النطاق. تم الاحتفاظ بالقيم المدخلة.',
  'doctor-overlap': 'لدى هذا الطبيب موعد محفوظ أو حجز بانتظار المزامنة في هذا الوقت. اختر وقتاً آخر؛ لا يمكن تجاوز التعارض.',
  'identity-not-cached': 'المريض أو الطبيب المحدد غير محفوظ لهذه العيادة. اتصل وحدّث بيانات العيادة قبل الحجز.',
  'stream-not-ready': 'هذا الجهاز غير جاهز للحجز دون اتصال. اتصل من جهاز استقبال مسجّل وحدّث البيانات.',
  unauthorized: 'البيانات الخاصة مقفلة. أعد الاتصال وسجّل الدخول للمتابعة.',
  'stale-context': 'تغيّر تصريح الوصول. أعد الاتصال وتحقق من الجلسة قبل المحاولة مجدداً.',
  'invalid-data': 'تعذّر التحقق من الحجز. راجع المريض والطبيب والوقت المحدد قبل إعادة المحاولة.',
  'storage-failed': 'لم يُحفظ الحجز على هذا الجهاز. أبقِ النموذج مفتوحاً وتحقق من مساحة التخزين ثم أعد المحاولة.',
  'storage-quota': 'لم يُحفظ الحجز لأن مساحة الجهاز ممتلئة. وفّر مساحة دون حذف بيانات أمل ثم أعد المحاولة.',
  'storage-unavailable': 'التخزين الخاص على الجهاز غير متاح. اسمح بالتخزين لأمل وأعد المحاولة؛ لم يُحفظ الحجز.',
  'storage-blocked': 'تبويب آخر يمنع التخزين. أغلق تبويبات أمل الأخرى وأعد المحاولة. لم يُحفظ الحجز.',
});
