export class ApiError extends Error {
  constructor(public status: number, public code: string, public key: string, public params: Record<string, number> = {}) {
    super(code);
  }
}
export const fail = (status: number, code: string, key: string, params = {}) => new ApiError(status, code, key, params);
export const translations = {
  en: {
    deviceUntrusted: "This device is not registered or its access was revoked. Ask your clinic administrator to register it.",
    validation: "Check the submitted information.", unauthorized: "Sign in to continue.",
    forbidden: "You do not have access.", csrf: "Refresh the page and try again.",
    reauthRequired: "Enter your PIN again.", notFound: "Not found.", conflict: "The request conflicts with existing data.",
    pinLocked: "PIN access is temporarily locked.", rateLimited: "Too many attempts. Try again later.", internal: "An unexpected error occurred.",
  },
  ar: {
    deviceUntrusted: "هذا الجهاز غير مسجّل أو تم إلغاء وصوله. اطلب من مسؤول العيادة تسجيله.",
    validation: "تحقق من المعلومات المدخلة.", unauthorized: "سجّل الدخول للمتابعة.",
    forbidden: "ليس لديك صلاحية الوصول.", csrf: "حدّث الصفحة وحاول مجددًا.",
    reauthRequired: "أدخل رمز الدخول مجددًا.", notFound: "غير موجود.", conflict: "يتعارض الطلب مع البيانات الموجودة.",
    pinLocked: "تم قفل الدخول بالرمز مؤقتًا.", rateLimited: "محاولات كثيرة. حاول لاحقًا.", internal: "حدث خطأ غير متوقع.",
  },
};
