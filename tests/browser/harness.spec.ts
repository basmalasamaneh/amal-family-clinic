import { test, expect, withOffline, expectAccessible, expectStableScreenshot } from "./fixtures";

test("localized semantic fixture and isolated context", async ({ example, context }) => {
  const { page, locale, text } = example;
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(text.heading);
  await expect(page.getByLabel(text.label)).toHaveValue(text.value);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse("2026-09-08T05:00:00Z"));
});

test("network disconnection and recovery", async ({ example, context }) => {
  const { page, text } = example;
  const probe = () => page.evaluate(async () => {
    try { return (await fetch("/probe", { cache: "no-store" })).ok; }
    catch { return false; }
  });
  expect(await probe()).toBe(true);
  await withOffline(context, async () => {
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await probe()).toBe(false);
    await page.getByRole("button", { name: text.button }).click();
    await expect(page.getByRole("status")).toHaveText(text.offline);
  });
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  expect(await probe()).toBe(true);
  await page.getByRole("button", { name: text.button }).click();
  await expect(page.getByRole("status")).toHaveText(text.online);
});

test("real accessibility scan @axe", async ({ example }) => {
  await expectAccessible(example.page);
});

test("deterministic locale and theme screenshot @screenshot", async ({ example }) => {
  await expectStableScreenshot(example.page);
});
