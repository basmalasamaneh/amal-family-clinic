import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAlerts } from "../src/alerts/extract";
import { alertMessages, renderAlert } from "../src/alerts/dictionary";

export const reemNote = "Started on blood pressure medication (Amlodipine 5mg) - review in 3 months";
test("exact acceptance label with verbatim evidence, no inferred condition", () => {
  const [a, ...others] = extractAlerts(reemNote);
  assert(a);
  assert.equal(renderAlert(a.labelKey, a.labelParams), "Blood-pressure medication (Amlodipine 5 mg)");
  assert.equal(a.sourceNoteExcerpt, reemNote);
  assert.equal(reemNote.slice(a.excerptStart, a.excerptEnd), reemNote);
  assert.equal(others.length, 0);
  assert.equal(alertMessages.en["alerts.crossClinic"], "Flag from another clinic: confirm with the patient");
  assert.deepEqual(Object.keys(alertMessages.ar), Object.keys(alertMessages.en));
});

test("English and Arabic dictionary across all kinds, normalization never alters evidence", () => {
  for (const [note, rule] of [
    ["METFORMIN 500mg", "med.metformin"], ["إنْسُولين ١٠ وحدات", "med.insulin"],
    ["أَمْلُودِيبِين ٥ ملغ", "med.amlodipine"], ["Allergic to penicillin", "allergy.penicillin"],
    ["حَسَاسِيَّة من البنسلين", "allergy.penicillin"], ["حساسية تجاه اللاتكس", "allergy.latex"],
    ["Allergy to latex", "allergy.latex"], ["Asthma", "condition.asthma"],
    ["يعاني من الرَّبو", "condition.asthma"], ["السكري", "condition.diabetes"],
    ["Diabetes", "condition.diabetes"], ["ارتفاع ضغط الدم", "condition.hypertension"],
    ["hypertension", "condition.hypertension"],
  ]) {
    const noteWithPrefix = `  ${note}  `;
    const [a] = extractAlerts(noteWithPrefix);
    assert(a, note);
    assert.equal(a.ruleId, rule, note);
    assert.equal(a.sourceNoteExcerpt, note);
    assert.equal(noteWithPrefix.slice(a.excerptStart, a.excerptEnd), note);
  }
});

test("conservative clause exclusions and exact word boundaries", () => {
  for (const note of [
    "No diabetes or asthma", "Patient denies allergy to penicillin", "If asthma consider metformin",
    "Possible hypertension", "Mother has diabetes", "Family history: asthma",
    "لا يعاني من السكري", "ينفي حساسية من البنسلين", "احتمال الربو",
    "إذا ارتفع الضغط أملوديبين 5mg", "الوالدة لديها السكري", "التاريخ العائلي: الربو",
    "nonasthma", "asthmatic", "metforminfoo", "سكريان", "حساسية من المضادات الحيوية",
    "Antibiotics", "Penicillin prescribed", "Asthma?", "الربو؟", "Will start metformin", "Mom has asthma",
  ]) assert.deepEqual(extractAlerts(note), [], note);
  const alerts = extractAlerts("No diabetes; Asthma. Father has hypertension; Metformin");
  assert.deepEqual(alerts.map(a => a.ruleId), ["condition.asthma", "med.metformin"]);
});

test("only explicit adjacent doses, stable deduplication and original offsets", () => {
  for (const note of ["Amlodipine", "5mg before Amlodipine", "Amlodipine then 5mg"]) {
    assert.equal(extractAlerts(note)[0]?.labelParams.doseSuffix, "");
  }
  const note = "  لا سكري؛  Amlodipine 2.5mg; Amlodipine 5mg";
  const alerts = extractAlerts(note);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.labelParams.doseSuffix, " 2.5 mg");
  for (const a of alerts) assert.equal(note.slice(a.excerptStart, a.excerptEnd), a.sourceNoteExcerpt);
});
