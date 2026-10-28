import { defineConfig } from "@playwright/test";

// Chromium comes pre-installed in some environments (PLAYWRIGHT_BROWSERS_PATH); CI runs
// `npx playwright install chromium`. WEILO_E2E_CHROMIUM points at a specific binary.
const executablePath = process.env.WEILO_E2E_CHROMIUM || undefined;

export default defineConfig({
  testDir: ".",
  outputDir: "./.results",
  globalSetup: "./global-setup.ts",
  // One host for the whole run, and the tests share it: run them one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    browserName: "chromium",
    launchOptions: { executablePath },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "first-run", testMatch: "first-run.spec.ts", use: { viewport: { width: 1280, height: 800 } } },
    { name: "desktop", testMatch: "desktop.spec.ts", dependencies: ["first-run"], use: { viewport: { width: 1280, height: 800 } } },
    {
      name: "phone",
      testMatch: "phone.spec.ts",
      dependencies: ["first-run"],
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
    },
  ],
});
