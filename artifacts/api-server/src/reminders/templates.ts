import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod/v4";

const templateInput = z.object({
  clinicDisplayName: z.string().trim().min(1).max(500),
  startsAt: z.date(),
}).strict();
/** Only configuration display name and appointment instant can enter text. */
export function renderReminder(raw: { clinicDisplayName: string; startsAt: Date }) {
  const input = templateInput.parse(raw);
  const date = formatInTimeZone(input.startsAt, "Asia/Hebron", "yyyy-MM-dd");
  const time = formatInTimeZone(input.startsAt, "Asia/Hebron", "HH:mm");
  return {
    ar: `العيادة: ${input.clinicDisplayName}\nالتاريخ: ${date}\nالوقت: ${time}`,
    en: `Clinic: ${input.clinicDisplayName}\nDate: ${date}\nTime: ${time}`,
  };
}
