import { i18n } from '../i18n';
const en = {
  online: 'Online', offline: 'Offline', attention: 'Sync needs attention',
  loading: 'Checking local queue…', locked: 'Private status locked', error: 'Queue status unavailable',
  waiting_zero: '{{n}} waiting', waiting_one: '{{n}} waiting', waiting_other: '{{n}} waiting',
  caveat: 'Connectivity does not confirm server availability or synchronization.',
  cached: 'You are viewing cached data. Locally saved bookings await server validation.',
  coverage: 'Cached coverage and freshness may be limited. Check the schedule’s cache notice before relying on it.',
  queue: 'View sync and conflicts',
};
const ar = {
  online: 'متصل', offline: 'غير متصل', attention: 'المزامنة تحتاج إلى انتباه',
  loading: 'جارٍ التحقق من القائمة المحلية…', locked: 'حالة السجلات الخاصة مقفلة', error: 'حالة القائمة غير متاحة',
  waiting_zero: '{{n}} عمليات بانتظار المزامنة', waiting_one: 'عملية واحدة بانتظار المزامنة ({{n}})',
  waiting_two: 'عمليتان بانتظار المزامنة ({{n}})', waiting_few: '{{n}} عمليات بانتظار المزامنة',
  waiting_many: '{{n}} عملية بانتظار المزامنة', waiting_other: '{{n}} عملية بانتظار المزامنة',
  caveat: 'الاتصال لا يؤكد توفر الخادم أو اكتمال المزامنة.',
  cached: 'أنت تعرض بيانات مخزنة على الجهاز. الحجوزات المحفوظة محلياً تنتظر تحقق الخادم.',
  coverage: 'قد تكون تغطية البيانات المخزنة وحداثتها محدودة. تحقق من تنبيه الجدول قبل الاعتماد عليه.',
  queue: 'عرض المزامنة والتعارضات',
};
i18n.addResourceBundle('en', 'connection', en, true, true);
i18n.addResourceBundle('ar', 'connection', ar, true, true);
