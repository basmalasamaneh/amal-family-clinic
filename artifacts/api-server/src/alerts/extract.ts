import { dictionary, dictionaryVersion } from "./dictionary";

export interface ExtractedAlert {
  ruleId: string; dictionaryVersion: string; kind: "medication" | "allergy" | "condition";
  labelKey: string; labelParams: Record<string, string>; sourceNoteExcerpt: string;
  excerptStart: number; excerptEnd: number;
}
// Normalization is only for matching. Evidence always slices the original UTF-16
// string at clause boundaries; no normalized-string offset is used on source text.
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660));
}
const boundary = (terms: readonly string[]) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${terms.map(normalize).join("|")})(?![\\p{L}\\p{N}_])`, "u");
// Deliberately reject an entire clause, including coordinated mentions. This
// favours missed flags over turning uncertain or non-patient text into a flag.
const excluded = boundary([
  "no", "not", "denies", "denied", "without", "negative", "never", "nil",
  "possible", "possibly", "suspected", "suspect", "consider", "if", "may", "might",
  "rule out", "rule-out", "screening", "screen", "risk", "query", "discuss", "discussed",
  "family", "fh", "mother", "father", "mom", "dad", "sister", "brother", "parent", "wife", "husband", "son", "daughter",
  "would", "could", "should", "will", "recommend", "recommended", "plan", "planned", "r/o", "ruled out",
  "لا", "ليس", "ليست", "لم", "لن", "ينفي", "تنفي", "نفى", "بدون", "دون",
  "احتمال", "محتمل", "محتملة", "اشتباه", "يشتبه", "قد", "اذا", "لو", "استبعاد", "فحص",
  "عائلي", "عائلية", "العائلي", "العائلة", "الام", "الاب", "والد", "والدة", "الوالد", "الوالدة", "والده", "والدته", "اخ", "اخت", "زوج", "زوجة",
]);
const allergyContext = /(?:allerg(?:y|ic)\s+(?:to\s+)?|حساسي[ةه]\s+(?:(?:من|تجاه|ل)\s*)?)$/u;

export function extractAlerts(note: string): ExtractedAlert[] {
  const results = new Map<string, ExtractedAlert>();
  // Periods within decimal doses are not clause separators.
  for (const part of note.matchAll(/[^;؛!?\n\r。]+/gu)) {
    const segment = part[0];
    for (const sentence of segment.matchAll(/(?:\.(?=\d)|[^.])+/gu)) {
      const raw = sentence[0];
      const start = part.index! + sentence.index! + raw.length - raw.trimStart().length;
      const excerpt = raw.trim();
      const text = normalize(excerpt);
      if (!excerpt || excluded.test(text) || /[?؟]/u.test(excerpt)) continue;
      // A question mark terminating a clause also makes it uncertain.
      const end = start + excerpt.length;
      if (/^[?؟]/u.test(note.slice(end).trimStart())) continue;
      for (const rule of dictionary) {
        const hit = boundary(rule.terms).exec(text);
        if (!hit || results.has(rule.id)) continue;
        if (rule.kind === "allergy" && !allergyContext.test(text.slice(0, hit.index))) continue;
        const params: Record<string, string> = {};
        let labelKey: string = `alerts.${rule.id}`;
        if (rule.kind === "medication") {
          // Only a dose immediately after an explicitly written medicine name.
          const dose = /^\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|units|ملغ|مغ|ملجم|وحدات)(?![\p{L}\p{N}_])/u.exec(text.slice(hit.index + hit[0].length));
          params.name = rule.name;
          params.doseSuffix = dose ? ` ${dose[1]} ${dose[2]}` : "";
          labelKey = boundary(["blood pressure medication", "دواء ضغط الدم"]).test(text)
            ? "alerts.bloodPressureMedication" : "alerts.medication";
        }
        results.set(rule.id, { ruleId: rule.id, dictionaryVersion, kind: rule.kind,
          labelKey, labelParams: params, sourceNoteExcerpt: excerpt, excerptStart: start, excerptEnd: end });
      }
    }
  }
  return [...results.values()];
}
