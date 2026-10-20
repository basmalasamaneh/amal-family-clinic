export class ApiError extends Error {
  constructor(public status: number, public code: string, public key: string, public params: Record<string, number> = {}) {
    super(code);
  }
}
export const fail = (status: number, code: string, key: string, params = {}) => new ApiError(status, code, key, params);
export const translations = {
  en: {
    clinicLeft: "This clinic has left the network. Rejoining is not available.",
    lifecycleRetry: "The clinic changed concurrently. Refresh and try again.",
    exportLimitExceeded: "The clinic export exceeds the download limit.",
    exportTimeout: "The export timed out. Try again.",
    exportResourceUnavailable: "Export is temporarily unavailable. Try again.",
    invalidCursor: "This sync cursor is invalid. Start synchronization again.",
    cursorScopeChanged: "Your access changed. Clear the previous local snapshot and synchronize again.",
    patientReferenced: "This patient has protected records and cannot be deleted.",
    deviceUntrusted: "This device is not registered or its access was revoked. Ask your clinic administrator to register it.",
    validation: "Check the submitted information.", unauthorized: "Sign in to continue.",
    forbidden: "You do not have access.", csrf: "Refresh the page and try again.",
    reauthRequired: "Enter your PIN again.", notFound: "Not found.", conflict: "The request conflicts with existing data.",
    pinLocked: "PIN access is temporarily locked.", rateLimited: "Too many attempts. Try again later.", internal: "An unexpected error occurred.",
  },
  ar: {
    clinicLeft: "غادرت هذه العيادة الشبكة. إعادة الانضمام غير متاحة.",
    lifecycleRetry: "تغيّرت حالة العيادة بالتزامن. حدّث الصفحة وحاول مجددًا.",
    exportLimitExceeded: "تجاوز تصدير العيادة الحد المسموح للتنزيل.",
    exportTimeout: "انتهت مهلة التصدير. حاول مجددًا.",
    exportResourceUnavailable: "التصدير غير متاح مؤقتًا. حاول مجددًا.",
    invalidCursor: "مؤشر المزامنة غير صالح. ابدأ المزامنة من جديد.",
    cursorScopeChanged: "تغيّرت صلاحياتك. امسح النسخة المحلية السابقة وأعد المزامنة.",
    patientReferenced: "لدى هذا المريض سجلات محمية ولا يمكن حذفه.",
    deviceUntrusted: "هذا الجهاز غير مسجّل أو تم إلغاء وصوله. اطلب من مسؤول العيادة تسجيله.",
    validation: "تحقق من المعلومات المدخلة.", unauthorized: "سجّل الدخول للمتابعة.",
    forbidden: "ليس لديك صلاحية الوصول.", csrf: "حدّث الصفحة وحاول مجددًا.",
    reauthRequired: "أدخل رمز الدخول مجددًا.", notFound: "غير موجود.", conflict: "يتعارض الطلب مع البيانات الموجودة.",
    pinLocked: "تم قفل الدخول بالرمز مؤقتًا.", rateLimited: "محاولات كثيرة. حاول لاحقًا.", internal: "حدث خطأ غير متوقع.",
  },
};
