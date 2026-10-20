import { i18n } from '../i18n';

i18n.addResourceBundle('en', 'translation', { localBookingUi: {
  loading: 'Preparing authorized records on this device…',
  notReady: 'Local booking records are not ready. Booking is disabled until a valid cache is available.',
  explanation: 'Bookings are saved on this device first and wait for server revalidation. Patient conflicts with other clinics are checked at synchronization. No server hold is claimed.',
  checked: 'No overlap found in the cached clinic records. Server revalidation is still required.',
  noHold: 'No slot is reserved on the server. Save locally to add a waiting-for-sync proposal to the calendar.',
  coverage: 'Cached coverage: {{from}}–{{to}}. Refreshed: {{refreshed}} (Hebron time).',
  refreshFailed: 'Refresh failed. Showing the last authorized cached records; they may be out of date.',
  incomplete: 'This date range is not fully covered by the local cache. The calendar may be incomplete; local booking is limited to cached coverage.',
  notSaved: 'Not saved on this device. Your selections are preserved. Try again or change the details.',
  saving: 'Saving on this device…',
  save: 'Save locally · wait for sync',
  saved: 'Saved on this device for {{time}}. Waiting for sync; not yet confirmed by the server.',
} }, true, false);
i18n.addResourceBundle('ar', 'translation', { localBookingUi: {
  loading: 'جارٍ تجهيز السجلات المصرّح بها على هذا الجهاز…',
  notReady: 'سجلات الحجز المحلية غير جاهزة. الحجز معطّل حتى تتوفر نسخة محلية صالحة.',
  explanation: 'تُحفظ الحجوزات على هذا الجهاز أولاً وتنتظر إعادة التحقق من الخادم. تُفحص تعارضات المريض مع العيادات الأخرى عند المزامنة. لا يُحجز الوقت مؤقتاً على الخادم.',
  checked: 'لم يُعثر على تداخل في سجلات العيادة المحفوظة محلياً. ما زالت إعادة التحقق من الخادم مطلوبة.',
  noHold: 'لم يُحجز الوقت على الخادم. احفظ محلياً لإضافة طلب ينتظر المزامنة إلى التقويم.',
  coverage: 'التغطية المحلية: {{from}}–{{to}}. آخر تحديث: {{refreshed}} (بتوقيت الخليل).',
  refreshFailed: 'تعذر التحديث. تُعرض آخر سجلات محلية مصرّح بها وقد لا تكون محدثة.',
  incomplete: 'هذا النطاق الزمني غير مغطى بالكامل محلياً. قد يكون التقويم غير مكتمل؛ الحجز المحلي متاح فقط ضمن التغطية المحفوظة.',
  notSaved: 'لم يُحفظ على هذا الجهاز. تم الاحتفاظ باختياراتك. حاول مجدداً أو عدّل التفاصيل.',
  saving: 'جارٍ الحفظ على هذا الجهاز…',
  save: 'حفظ محلي · انتظار المزامنة',
  saved: 'حُفظ على هذا الجهاز للساعة {{time}}. بانتظار المزامنة ولم يؤكده الخادم بعد.',
} }, true, false);
