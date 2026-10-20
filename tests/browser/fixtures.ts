import { createServer } from "node:http";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { documentHtml } from "./document";
import { messages, type Locale } from "./resources";

/** A real loopback server, not route.fulfill: offline must block actual network. */
export const test = base.extend<{ example: { page: Page; locale: Locale; text: typeof messages[Locale] } }>({
  example: async ({ page, locale }, use) => {
    const language: Locale = locale === "ar" ? "ar" : "en";
    const server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", request.url === "/probe" ? "text/plain" : "text/html; charset=utf-8");
      response.end(request.url === "/probe" ? "ok" : documentHtml(language));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    try {
      await page.clock.setFixedTime(new Date("2026-09-08T05:00:00Z"));
      await page.goto(`http://127.0.0.1:${address.port}`);
      await use({ page, locale: language, text: messages[language] });
    } finally {
      await page.context().setOffline(false);
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  },
});
export { expect };

export async function withOffline(context: BrowserContext, run: () => Promise<void>) {
  await context.setOffline(true);
  try { await run(); } finally { await context.setOffline(false); }
}

export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  // IDs/impact only; avoid persisting DOM, input values or patient information.
  expect(results.violations.map(({ id, impact }) => ({ id, impact }))).toEqual([]);
}

export async function expectStableScreenshot(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("example.png", { fullPage: true, caret: "hide" });
}
