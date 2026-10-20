import { i18n } from '../i18n';

const en = {
  lede: 'Demo controls for the operational dataset. Simulate a clinic API outage or reset all demo data for the next walkthrough.',
  generation: 'Data generation', live: 'Live status, checked every few seconds', stale: 'Status could not be refreshed. Showing the last known values; they may be out of date.',
  outage: {
    title: 'Simulated clinic outage',
    desc: 'Makes the selected clinic\'s API calls fail as if its server were unreachable. This is not browser offline mode. Restoring it does not prove the internet connection works.',
    clinic: 'Operational clinic', pick: 'Choose a clinic', none: 'No operational clinics are available.',
    statusLabel: 'Current state', on: 'Outage simulated', off: 'Operating normally', unknown: 'Unknown',
    enable: 'Simulate outage', restore: 'Restore clinic', enabling: 'Enabling…', restoring: 'Restoring…',
    enabled: 'Outage simulation is on for {{clinic}}.', restored: 'The simulated outage was removed for {{clinic}}. Real connectivity is not checked here.',
    changedElsewhere: 'Status changed in another tab or by another admin. The latest values are shown; review and try again.',
    ambiguous: 'The server did not confirm the change. The status below is refreshed from the server; check it before trying again.',
  },
  reset: {
    title: 'Reset demo data', desc: 'Restores every clinic to the original demo dataset.',
    warn1: 'All changes in every clinic are permanently discarded: appointments, patients, consents, imports and admin edits.',
    warn2: 'Offline changes waiting to sync on any device are discarded and will never be sent.',
    warn3: 'Everyone, including you, is signed out and must sign in again.',
    start: 'Reset all demo data', confirmTitle: 'Reset the whole demo?',
    typeLabel: 'Type {{phrase}} to confirm', typeMismatch: 'The confirmation text does not match.',
    confirm: 'Reset everything', running: 'Resetting…',
    offline: 'You are offline. Reset is never queued; reconnect to run it.',
    pendingTitle: 'Reset result unknown',
    pendingBody: 'A reset request was sent but no answer was received. It may have completed. A new reset is blocked until this one is resolved.',
    checking: 'Checking the server for this request…', check: 'Check again', replay: 'Retry the same request',
    notFound: 'The server has no receipt for this request yet. That does not prove it failed; it may still be in flight. Check again, or retry the same request safely.',
    supersededTitle: 'The demo data already changed',
    superseded: 'The data generation changed, but not through this request. Its outcome is closed and no data was cleared by this page.',
    dismiss: 'Dismiss', requestId: 'Request',
    doneTitle: 'Demo data reset', done: 'Reset completed at {{time}}. All sessions were ended, so you need to sign in again.',
    cleanupFailed: 'Reset completed, but this browser could not finish clearing its old local data. Sign in again to retry the cleanup.',
    signIn: 'Sign in again',
    conflict: 'The demo data changed since this page loaded. Nothing was reset. Review the latest status and try again.',
  },
  err: {
    disabled: 'Developer tools are turned off on this server.',
    scoped: 'Developer tools need a network-wide administrator. Clinic-scoped admin accounts cannot use them.',
    load: 'Developer status could not be loaded.',
  },
};

const ar: typeof en = {
  lede: 'أدوات العرض التجريبي لبيانات التشغيل. حاكِ انقطاع واجهة عيادة أو أعد ضبط جميع البيانات التجريبية للعرض التالي.',
  generation: 'جيل البيانات', live: 'حالة مباشرة تُفحص كل بضع ثوانٍ', stale: 'تعذّر تحديث الحالة. تُعرض آخر قيم معروفة وقد تكون قديمة.',
  outage: {
    title: 'محاكاة انقطاع عيادة',
    desc: 'تجعل طلبات واجهة العيادة المختارة تفشل كأن خادمها غير متاح. هذا ليس وضع عدم الاتصال في المتصفح، واستعادتها لا تثبت أن الإنترنت يعمل.',
    clinic: 'العيادة التشغيلية', pick: 'اختر عيادة', none: 'لا توجد عيادات تشغيلية متاحة.',
    statusLabel: 'الحالة الحالية', on: 'الانقطاع مُحاكى', off: 'تعمل بشكل طبيعي', unknown: 'غير معروفة',
    enable: 'محاكاة الانقطاع', restore: 'استعادة العيادة', enabling: 'جارٍ التفعيل…', restoring: 'جارٍ الاستعادة…',
    enabled: 'محاكاة الانقطاع مفعّلة لـ {{clinic}}.', restored: 'أُزيل الانقطاع المُحاكى عن {{clinic}}. لا يُفحص الاتصال الفعلي هنا.',
    changedElsewhere: 'تغيّرت الحالة في تبويب آخر أو من مسؤول آخر. تُعرض أحدث القيم؛ راجعها وحاول مجددًا.',
    ambiguous: 'لم يؤكد الخادم التغيير. حُدّثت الحالة أدناه من الخادم؛ تحقق منها قبل المحاولة مجددًا.',
  },
  reset: {
    title: 'إعادة ضبط البيانات التجريبية', desc: 'تعيد كل العيادات إلى مجموعة البيانات التجريبية الأصلية.',
    warn1: 'تُحذف نهائيًا جميع التغييرات في كل العيادات: المواعيد والمرضى والموافقات والاستيرادات وتعديلات الإدارة.',
    warn2: 'تُحذف التغييرات غير المتصلة المنتظرة للمزامنة على أي جهاز ولن تُرسل أبدًا.',
    warn3: 'يُسجَّل خروج الجميع، بمن فيهم أنت، ويجب تسجيل الدخول مجددًا.',
    start: 'إعادة ضبط كل البيانات التجريبية', confirmTitle: 'إعادة ضبط العرض التجريبي بالكامل؟',
    typeLabel: 'اكتب {{phrase}} للتأكيد', typeMismatch: 'نص التأكيد غير مطابق.',
    confirm: 'إعادة ضبط كل شيء', running: 'جارٍ إعادة الضبط…',
    offline: 'أنت غير متصل. لا تُوضع إعادة الضبط في قائمة انتظار أبدًا؛ أعد الاتصال لتنفيذها.',
    pendingTitle: 'نتيجة إعادة الضبط غير معروفة',
    pendingBody: 'أُرسل طلب إعادة ضبط دون وصول رد. ربما اكتمل. يُمنع بدء إعادة ضبط جديدة حتى يُحسم هذا الطلب.',
    checking: 'جارٍ التحقق من هذا الطلب لدى الخادم…', check: 'تحقق مجددًا', replay: 'أعد إرسال الطلب نفسه',
    notFound: 'لا يوجد لدى الخادم إيصال لهذا الطلب بعد. هذا لا يثبت فشله؛ فقد يكون قيد التنفيذ. تحقق مجددًا أو أعد إرسال الطلب نفسه بأمان.',
    supersededTitle: 'تغيّرت البيانات التجريبية بالفعل',
    superseded: 'تغيّر جيل البيانات ولكن ليس عبر هذا الطلب. أُغلق هذا الطلب ولم تمسح هذه الصفحة أي بيانات.',
    dismiss: 'إخفاء', requestId: 'الطلب',
    doneTitle: 'أُعيد ضبط البيانات التجريبية', done: 'اكتملت إعادة الضبط في {{time}}. أُنهيت جميع الجلسات، لذا عليك تسجيل الدخول مجددًا.',
    cleanupFailed: 'اكتملت إعادة الضبط، لكن تعذّر على هذا المتصفح إكمال مسح بياناته المحلية القديمة. سجّل الدخول مجددًا لإعادة المحاولة.',
    signIn: 'تسجيل الدخول مجددًا',
    conflict: 'تغيّرت البيانات التجريبية منذ تحميل الصفحة. لم يُعَد ضبط شيء. راجع أحدث حالة وحاول مجددًا.',
  },
  err: {
    disabled: 'أدوات المطوّر معطّلة على هذا الخادم.',
    scoped: 'تتطلب أدوات المطوّر مسؤولًا على مستوى الشبكة. لا يمكن لحسابات الإدارة المقيّدة بعيادة استخدامها.',
    load: 'تعذّر تحميل حالة أدوات المطوّر.',
  },
};

let done = false;
export function registerDeveloperStrings() {
  if (done) return; done = true;
  i18n.addResourceBundle('en', 'translation', { dev: en }, true, false);
  i18n.addResourceBundle('ar', 'translation', { dev: ar }, true, false);
}
registerDeveloperStrings();
