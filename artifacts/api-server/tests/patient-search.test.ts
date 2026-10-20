import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, canonicalPhone, searchScore } from "@workspace/db/patient-search";

test("Unicode normalization: composed/decomposed Arabic, Latin, mixed scripts and idempotence", () => {
  for (const [source, expected] of [
    ["أَحْمَد إِبْرَاهِيم آمال ٱحمد", "احمد ابراهيم امال احمد"],
    ["فاطمة مصطفى", "فاطمه مصطفي"], ["  José\tÉMILIE\nأحمد  ", "jose emilie احمد"],
    ["ا\u0654حمد", "احمد"], ["e\u0301", "e"], ["مـحمد", "محمد"],
    ["ﻻ", "لا"], ["", ""], [" \n\t ", ""], ["\u064e", ""],
  ]) {
    assert.equal(normalizeName(source!), expected);
    assert.equal(normalizeName(normalizeName(source!)), expected);
  }
  assert.equal(normalizeName("ؤ ئ"), "و ي"); // NFKD hamza marks are diacritics.
  assert.notEqual(normalizeName("احمد"), normalizeName("ahmad"));
});
test("phone canonicalization preserves zeros and international prefix, rejects ambiguous input", () => {
  assert.equal(canonicalPhone(" 059-123 (4567) "), "0591234567");
  assert.equal(canonicalPhone("+970 59.123.4567"), "+970591234567");
  assert.notEqual(canonicalPhone("0097059"), canonicalPhone("+97059"));
  for (const value of ["", "abc", "12", "059x123", "٠٥٩١٢٣", "12+345", "1".repeat(21)]) assert.equal(canonicalPhone(value), null);
});
test("deterministic exact, substring, fuzzy tiers and short-query safeguards", () => {
  assert.equal(searchScore("احمد", "أحمد", "0591234"), 0);
  assert.equal(searchScore("059-1234", "Other", "059 1234"), 0);
  assert.equal(searchScore("احمد", "محمد احمد", "0591234"), 100);
  assert.equal(searchScore("احمد", "احمر", "0591234"), 201);
  assert.equal(searchScore("abcdefgh", "abcdxfgh", "0591234"), 201);
  assert.equal(searchScore("abcdefgh", "abcdxygh", "0591234"), 202);
  assert.equal(searchScore("abc", "abd", "0591234"), null);
  assert.equal(searchScore("a", "abc", "0591234"), null);
  assert.equal(searchScore("احمد", "بعيد", "0591234"), null);
  assert.equal(searchScore("   ", "anything", "0591234"), 0);
  for (const query of ["%", "_", "\\", "' OR 1=1--"]) assert.equal(searchScore(query, "احمد", "0591234"), null);
});
