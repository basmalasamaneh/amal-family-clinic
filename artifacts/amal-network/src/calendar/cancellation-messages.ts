import { i18n } from '../i18n';
i18n.addResourceBundle('en', 'cancellation', {
  title: 'Cancel this appointment?', description: 'The booking stays on the server for 10 seconds. You can undo during that time. Leaving the account or reloading discards unsent cancellation; a request already sent cannot be undone.',
  confirm: 'Cancel appointment', keep: 'Keep appointment', close: 'Close', pending: 'Pending cancellation · {{seconds}} seconds to undo',
  undo: 'Undo', sending: 'Sending cancellation…', failed: 'Cancellation was not confirmed. The calendar has been refreshed. Retry the same request or dismiss this message and check the appointment.',
  retry: 'Retry cancellation', dismiss: 'Dismiss message', success: 'Appointment cancelled.',
  appointment: 'Appointment {{id}}', fixture: 'Demonstration calendar: cancellation writes are disabled.',
  unavailable: 'Cancellation is unavailable for this appointment.', pendingBadge: 'Pending cancellation',
  action: 'Cancel appointment {{id}}', region: 'Appointment cancellations',
  created: 'Appointment booked.', simulated: 'Simulation complete. No appointment was saved.',
}, true, true);
i18n.addResourceBundle('ar', 'cancellation', {
  title: 'إلغاء هذا الموعد؟', description: 'يبقى الموعد على الخادم لمدة 10 ثوانٍ ويمكنك التراجع خلالها. تسجيل الخروج أو إعادة تحميل الصفحة يلغي طلب الإلغاء غير المرسل؛ لا يمكن التراجع عن طلب أُرسل بالفعل.',
  confirm: 'إلغاء الموعد', keep: 'الاحتفاظ بالموعد', close: 'إغلاق', pending: 'بانتظار الإلغاء · {{seconds}} ثوانٍ للتراجع',
  undo: 'تراجع', sending: 'جارٍ إرسال الإلغاء…', failed: 'لم يتم تأكيد الإلغاء. تم تحديث التقويم. أعد إرسال الطلب نفسه أو أغلق الرسالة وتحقق من الموعد.',
  retry: 'إعادة محاولة الإلغاء', dismiss: 'إغلاق الرسالة', success: 'تم إلغاء الموعد.',
  appointment: 'الموعد {{id}}', fixture: 'تقويم تجريبي: إرسال طلبات الإلغاء معطّل.',
  unavailable: 'الإلغاء غير متاح لهذا الموعد.', pendingBadge: 'بانتظار الإلغاء',
  action: 'إلغاء الموعد {{id}}', region: 'إلغاء المواعيد',
  created: 'تم حجز الموعد.', simulated: 'اكتملت المحاكاة. لم يُحفظ أي موعد.',
}, true, true);
