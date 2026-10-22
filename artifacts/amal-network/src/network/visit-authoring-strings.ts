import { i18n } from '../i18n';
const en = {
  revalidation: 'Permission could not be refreshed. Your draft is still here. Retry verification when connected.',
  verify: 'Retry permission check',
  conflict: 'This request conflicts with a previous operation. Its outcome is not resolved; the original request stays locked. Retry the exact request or ask your administrator to reconcile it.',
  discard: 'Discard this unsaved note? It will not be saved anywhere.',
  create: 'New visit note', append: 'Add a correction or additional note', title: 'Record a doctor visit',
  appendTitle: 'Additional note', description: 'Saved notes cannot be edited. Corrections are added to the history without changing the original.',
  date: 'Date and time · Hebron', note: 'Clinical note', save: 'Save note', saving: 'Saving…', cancel: 'Cancel',
  offline: 'An online connection is required. This draft stays only in memory and is never queued.',
  checking: 'Verifying your permission to save…', invalid: 'Enter a note and a valid Hebron date and time, no more than 5 minutes in the future.',
  unknown: 'The save outcome is unknown. The note is locked. Retry the exact request to safely check or complete this save. Do not create another note.',
  retry: 'Retry exact save', saved: 'Note saved.', failed: 'Permission could not be verified. The draft has been cleared.',
  additional: 'Additional note', linked: 'Linked to the selected appointment. Its status will not change.',
};
const ar: typeof en = {
  revalidation: 'تعذر تحديث الصلاحية. لا تزال مسودتك هنا. أعد التحقق عند الاتصال.',
  verify: 'إعادة التحقق من الصلاحية',
  conflict: 'يتعارض هذا الطلب مع عملية سابقة. لم تُحسم النتيجة؛ يبقى الطلب الأصلي مقفلاً. أعد إرسال الطلب نفسه أو اطلب من المسؤول التحقق منه.',
  discard: 'هل تريد تجاهل هذه الملاحظة غير المحفوظة؟ لن تُحفظ في أي مكان.',
  create: 'ملاحظة زيارة جديدة', append: 'إضافة تصحيح أو ملاحظة إضافية', title: 'تسجيل زيارة طبيب',
  appendTitle: 'ملاحظة إضافية', description: 'لا يمكن تعديل الملاحظات المحفوظة. تُضاف التصحيحات إلى السجل دون تغيير الأصل.',
  date: 'التاريخ والوقت · الخليل', note: 'الملاحظة السريرية', save: 'حفظ الملاحظة', saving: 'جارٍ الحفظ…', cancel: 'إلغاء',
  offline: 'يلزم الاتصال بالإنترنت. تبقى المسودة في الذاكرة فقط ولا تُضاف إلى قائمة مزامنة.',
  checking: 'جارٍ التحقق من صلاحية الحفظ…', invalid: 'أدخل ملاحظة وتاريخًا ووقتًا صحيحين بتوقيت الخليل، لا يتجاوزان الوقت الحالي بأكثر من ٥ دقائق.',
  unknown: 'نتيجة الحفظ غير معروفة. تم قفل الملاحظة. أعد إرسال الطلب نفسه للتحقق من الحفظ أو إكماله بأمان. لا تنشئ ملاحظة أخرى.',
  retry: 'إعادة محاولة الحفظ نفسه', saved: 'تم حفظ الملاحظة.', failed: 'تعذر التحقق من الصلاحية. تم مسح المسودة.',
  additional: 'ملاحظة إضافية', linked: 'مرتبطة بالموعد المحدد. لن تتغير حالة الموعد.',
};
i18n.addResourceBundle('en', 'translation', { visitAuthor: en }, true, false);
i18n.addResourceBundle('ar', 'translation', { visitAuthor: ar }, true, false);
