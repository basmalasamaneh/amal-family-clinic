import { i18n } from '@/i18n';

i18n.addResourceBundle('en', 'translation', {
  shell: { nav: { coordination: 'Network coordination' } },
  coordination: {
    refresh: 'Refresh', readonly: 'Network overview · Read only',
    explanation: 'Aggregate clinic results support voluntary coordination, not individual doctor rankings. Each clinic chooses its own participation; this view does not require adoption or change clinic settings.',
    period: 'Reporting window', asOf: 'Updated', mode: 'Mode', full: 'Full', lite: 'Lite', membership: 'Membership',
    conflicts: 'Prevented conflicts', lookup: 'Median lookup time', seconds: 'seconds', samples: 'Sample: {{value}}',
    available: 'Available', unavailable: 'Unavailable', partial: 'Partial coverage',
    loading: 'Checking current access…', denied: 'Coordination access is not available', offline: 'Connect to view network coordination',
    error: 'Unable to verify access or load results', private: 'This online-only view requires explicit delegation. No coordination results are saved offline. Reconnect or refresh to check again.',
    empty: 'No clinic results in this window', emptyDescription: 'No results were returned for your authorized network scope.',
    memberships: { active: 'Active', inactive: 'Inactive', left: 'Left', suspended: 'Suspended', pending: 'Pending' },
  },
}, true, true);
i18n.addResourceBundle('ar', 'translation', {
  shell: { nav: { coordination: 'تنسيق الشبكة' } },
  coordination: {
    refresh: 'تحديث', readonly: 'نظرة عامة على الشبكة · للقراءة فقط',
    explanation: 'تدعم النتائج المجمّعة للعيادات التنسيق الطوعي، وليست ترتيباً للأطباء الأفراد. تختار كل عيادة مشاركتها؛ لا يفرض هذا العرض التبنّي ولا يغيّر إعدادات العيادات.',
    period: 'فترة التقرير', asOf: 'آخر تحديث', mode: 'النمط', full: 'كامل', lite: 'خفيف', membership: 'العضوية',
    conflicts: 'التعارضات التي تم منعها', lookup: 'وسيط وقت البحث', seconds: 'ثانية', samples: 'العينة: {{value}}',
    available: 'متاح', unavailable: 'غير متاح', partial: 'تغطية جزئية',
    loading: 'جارٍ التحقق من الصلاحية الحالية…', denied: 'صلاحية تنسيق الشبكة غير متاحة', offline: 'اتصل بالإنترنت لعرض تنسيق الشبكة',
    error: 'تعذّر التحقق من الصلاحية أو تحميل النتائج', private: 'يتطلب هذا العرض تفويضاً صريحاً واتصالاً بالإنترنت. لا تُحفظ نتائج التنسيق دون اتصال. أعد الاتصال أو حدّث للتحقق مجدداً.',
    empty: 'لا توجد نتائج للعيادات في هذه الفترة', emptyDescription: 'لم تُرجع الخدمة نتائج ضمن نطاق الشبكة المصرّح لك به.',
    memberships: { active: 'نشطة', inactive: 'غير نشطة', left: 'منسحبة', suspended: 'معلّقة', pending: 'قيد الانتظار' },
  },
}, true, true);
