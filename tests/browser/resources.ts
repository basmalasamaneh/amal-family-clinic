export const messages = {
  ar: {
    title: "مثال اختبار مستقل", heading: "فحص أدوات الاختبار",
    description: "هذه بيانات اصطناعية وليست سجلات مرضى.",
    label: "اسم المثال", value: "مثال", button: "تحقق من الاتصال",
    online: "متصل", offline: "غير متصل", footer: "صفحة اختبار فقط",
  },
  en: {
    title: "Isolated test example", heading: "Test harness check",
    description: "This is synthetic data, not patient records.",
    label: "Example name", value: "Example", button: "Check connection",
    online: "Online", offline: "Offline", footer: "Test-only page",
  },
} as const;
export type Locale = keyof typeof messages;
