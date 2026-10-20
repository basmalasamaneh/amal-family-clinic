import type { ConflictType } from "./engine";

// Stable keys are mapped from the four-field conflict contract, not extra prose fields.
export const conflictMessageKeys: Record<ConflictType, string> = {
  "doctor-overlap": "conflict.doctorOverlap",
  "patient-overlap": "conflict.patientOverlap",
  "same-day-other-clinic": "conflict.sameDayOtherClinic",
  "outside-hours": "conflict.outsideHours",
  "slot-held": "conflict.slotHeld",
};

export const appointmentMessages = {
  en: {
    "conflict.doctorOverlap": "The doctor already has an appointment during this time.",
    "conflict.patientOverlap": "The patient has an overlapping appointment. A reason is required to continue.",
    "conflict.sameDayOtherClinic": "The patient has an appointment at another clinic on the same day.",
    "conflict.outsideHours": "The full appointment must fit within the clinic's working hours.",
    "conflict.slotHeld": "Another staff member is temporarily holding this time.",
    "error.invalidClinicSettings": "The clinic's scheduling settings are missing or invalid.",
  },
  ar: {
    "conflict.doctorOverlap": "لدى الطبيب موعد آخر خلال هذا الوقت.",
    "conflict.patientOverlap": "لدى المريض موعد متداخل. يجب إدخال سبب للمتابعة.",
    "conflict.sameDayOtherClinic": "لدى المريض موعد في عيادة أخرى في اليوم نفسه.",
    "conflict.outsideHours": "يجب أن تقع مدة الموعد كاملة ضمن ساعات عمل العيادة.",
    "conflict.slotHeld": "يحجز موظف آخر هذا الوقت مؤقتًا.",
    "error.invalidClinicSettings": "إعدادات المواعيد في العيادة مفقودة أو غير صالحة.",
  },
};
