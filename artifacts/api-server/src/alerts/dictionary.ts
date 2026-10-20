/** Version changes whenever matching, suppression, or rendered parameters change. */
export const dictionaryVersion = "1.0.0";
export const dictionary = [
  { id: "med.amlodipine", kind: "medication", terms: ["amlodipine", "املوديبين", "أملوديبين"], name: "Amlodipine" },
  { id: "med.metformin", kind: "medication", terms: ["metformin", "ميتفورمين"], name: "Metformin" },
  { id: "med.insulin", kind: "medication", terms: ["insulin", "انسولين", "إنسولين"], name: "Insulin" },
  { id: "allergy.penicillin", kind: "allergy", terms: ["penicillin", "بنسلين", "البنسلين"], name: "Penicillin" },
  { id: "allergy.latex", kind: "allergy", terms: ["latex", "لاتكس", "اللاتكس"], name: "Latex" },
  { id: "condition.diabetes", kind: "condition", terms: ["diabetes", "السكري", "سكري"], name: "Diabetes" },
  { id: "condition.asthma", kind: "condition", terms: ["asthma", "الربو", "ربو"], name: "Asthma" },
  { id: "condition.hypertension", kind: "condition", terms: ["hypertension", "ارتفاع ضغط الدم"], name: "Hypertension" },
] as const;

export const alertMessages = {
  en: {
    "alerts.category.medication": "Medication mention",
    "alerts.category.allergy": "Allergy mention",
    "alerts.category.condition": "Condition mention",
    "alerts.medication": "{name}{doseSuffix}",
    "alerts.bloodPressureMedication": "Blood-pressure medication ({name}{doseSuffix})",
    "alerts.allergy.penicillin": "Penicillin allergy",
    "alerts.allergy.latex": "Latex allergy",
    "alerts.condition.diabetes": "Diabetes mention",
    "alerts.condition.asthma": "Asthma mention",
    "alerts.condition.hypertension": "Hypertension mention",
    "alerts.crossClinic": "Flag from another clinic: confirm with the patient",
    "alerts.unconfirmed": "Unconfirmed source-note information; not a diagnosis, current medication list or medical advice. Keyword coverage is incomplete.",
    "alerts.error.visitNotFound": "Source visit not found",
    "alerts.error.invalidInput": "Invalid extraction input",
    "alerts.error.failed": "Alert extraction failed",
  },
  ar: {
    "alerts.category.medication": "ذكر دواء",
    "alerts.category.allergy": "ذكر حساسية",
    "alerts.category.condition": "ذكر حالة",
    "alerts.medication": "{name}{doseSuffix}",
    "alerts.bloodPressureMedication": "دواء ضغط الدم ({name}{doseSuffix})",
    "alerts.allergy.penicillin": "حساسية البنسلين",
    "alerts.allergy.latex": "حساسية اللاتكس",
    "alerts.condition.diabetes": "ذكر السكري",
    "alerts.condition.asthma": "ذكر الربو",
    "alerts.condition.hypertension": "ذكر ارتفاع ضغط الدم",
    "alerts.crossClinic": "تنبيه من عيادة أخرى: تأكد من المريض",
    "alerts.unconfirmed": "معلومات غير مؤكدة من ملاحظة المصدر؛ ليست تشخيصاً أو قائمة أدوية حالية أو نصيحة طبية. تغطية الكلمات المفتاحية غير كاملة.",
    "alerts.error.visitNotFound": "لم يتم العثور على زيارة المصدر",
    "alerts.error.invalidInput": "مدخلات الاستخراج غير صالحة",
    "alerts.error.failed": "تعذر استخراج التنبيهات",
  },
} as const;

export function renderAlert(key: string, params: Record<string, string>, locale: "en" | "ar" = "en") {
  const messages: Record<string, string> = alertMessages[locale];
  return (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? "");
}
