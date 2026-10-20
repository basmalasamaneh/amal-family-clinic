import { i18n } from '@/i18n';

const resources = {
  ar: {
    update: 'يتوفر تحديث للتطبيق. احفظ عملك ثم أغلق جميع علامات تبويب أمل وأعد فتح التطبيق لتطبيقه بأمان.',
    error: 'تعذر تجهيز التطبيق للاستخدام دون اتصال. يمكنك متابعة العمل أثناء الاتصال والمحاولة مجددًا.',
    retry: 'إعادة محاولة تجهيز الاستخدام دون اتصال',
    dismiss: 'إخفاء الإشعار',
  },
  en: {
    update: 'An app update is ready. Save your work, then close all Amal tabs and reopen the app to apply it safely.',
    error: 'The offline shell could not be prepared. You can keep working online and try again.',
    retry: 'Retry offline setup',
    dismiss: 'Dismiss notice',
  },
};

for (const [language, messages] of Object.entries(resources)) {
  i18n.addResourceBundle(language, 'pwa', messages, true, true);
}
