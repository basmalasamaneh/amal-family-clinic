import { i18n } from '../i18n';

for (const [language, search] of Object.entries({
  en: { label: 'Search patients by name or phone', placeholder: 'Search patients by name or phone', short: 'Type at least 2 characters to search.' },
  ar: { label: 'البحث عن المرضى بالاسم أو الهاتف', placeholder: 'ابحث بالاسم أو الهاتف', short: 'اكتب حرفين على الأقل للبحث.' },
})) i18n.addResourceBundle(language, 'translation', { shell: { search } }, true, true);
