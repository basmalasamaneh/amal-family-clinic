import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

// NixOS supplies a wrapped browser with its native shared libraries.
const executablePath = process.env.HARNESS_CHROMIUM_PATH ??
  (existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined);

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  outputDir: "generated-artifacts/harness/results",
  reporter: [["list"], ["html", { outputFolder: "generated-artifacts/harness/report", open: "never" }]],
  snapshotPathTemplate: "{testDir}/baselines/{projectName}/{arg}{ext}",
  expect: { toHaveScreenshot: { animations: "disabled", maxDiffPixels: 0 } },
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 960, height: 640 },
    deviceScaleFactor: 1,
    timezoneId: "Asia/Hebron",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: ["ar", "en"].flatMap(locale =>
    (["light", "dark"] as const).map(colorScheme => ({
      name: `${locale}-${colorScheme}`,
      use: { locale, colorScheme },
    })),
  ),
});
