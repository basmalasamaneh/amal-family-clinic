import { i18n } from '../i18n';

i18n.addResourceBundle('en', 'offline', {
  online: 'Browser online',
  offline: 'Browser offline',
  connectivity: 'Browser connectivity only; does not indicate server availability or synchronization.',
  lockedTitle: 'Offline · records locked',
  lockedDescription: 'The app shell is available, but patient records require a verified online session. Reconnect and try again.',
  storage: 'Private offline storage is unavailable. You can continue using the app online.',
  pending: 'Signing out removes private data on this device, including any unsent changes. Cancel to keep them, or continue to discard them and sign out.',
  discard: 'Discard local changes and sign out',
  cancel: 'Cancel',
  cleanupTitle: 'Signed out · device data removal incomplete',
  cleanupDescription: 'Your session has ended, but private records or unsent changes may remain on this device. Do not share this browser yet. Close other Amal tabs and retry. If removal still fails, clear this site’s data in browser settings before using another account.',
  cleanupRetry: 'Retry device data removal',
  cleanupUnknownTitle: 'Device data removal cannot be confirmed',
  cleanupUnknownDescription: 'This browser is blocking the storage needed to check whether private records remain. Private pages and sign-in are locked. Clear this site’s data in browser settings, allow site storage, then reopen Amal. Clearing site data discards any unsent local changes.',
}, true, true);
i18n.addResourceBundle('ar', 'offline', {
  online: 'المتصفح متصل',
  offline: 'المتصفح غير متصل',
  connectivity: 'اتصال المتصفح فقط؛ لا يدل على توفر الخادم أو نجاح المزامنة.',
  lockedTitle: 'غير متصل · السجلات مقفلة',
  lockedDescription: 'واجهة التطبيق متاحة، لكن سجلات المرضى تتطلب جلسة موثقة عبر الإنترنت. أعد الاتصال وحاول مجدداً.',
  storage: 'التخزين المحلي الخاص غير متاح. يمكنك متابعة استخدام التطبيق عبر الإنترنت.',
  pending: 'تسجيل الخروج يحذف البيانات الخاصة على هذا الجهاز، بما فيها التغييرات غير المرسلة. ألغِ للاحتفاظ بها أو تابع لحذفها وتسجيل الخروج.',
  discard: 'حذف التغييرات المحلية وتسجيل الخروج',
  cancel: 'إلغاء',
  cleanupTitle: 'تم إنهاء الجلسة · حذف بيانات الجهاز غير مكتمل',
  cleanupDescription: 'انتهت جلستك، لكن قد تبقى سجلات خاصة أو تغييرات غير مرسلة على الجهاز. لا تشارك هذا المتصفح بعد. أغلق تبويبات أمل الأخرى وأعد المحاولة. إذا استمر الفشل، امسح بيانات هذا الموقع من إعدادات المتصفح قبل استخدام حساب آخر.',
  cleanupRetry: 'إعادة محاولة حذف بيانات الجهاز',
  cleanupUnknownTitle: 'تعذر التأكد من حذف بيانات الجهاز',
  cleanupUnknownDescription: 'يمنع المتصفح التخزين اللازم للتحقق من بقاء سجلات خاصة. الصفحات الخاصة وتسجيل الدخول مقفلان. امسح بيانات هذا الموقع من إعدادات المتصفح، واسمح بتخزين الموقع، ثم افتح أمل مجدداً. مسح بيانات الموقع يحذف أي تغييرات محلية غير مرسلة.',
}, true, true);
