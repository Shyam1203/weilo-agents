/**
 * End-to-end tests against the real host (`weilo up`) serving the built web app, with the
 * built-in echo engine. `npm run e2e`. Settings:
 *   WEILO_PG_BIN          Postgres bin folder (else found like the host does; tests skip without it)
 *   WEILO_E2E_REQUIRE_PG  fail instead of skipping when Postgres is missing (CI)
 *   WEILO_E2E_QUIET_BUILD hide cargo and vite build output
 *   WEILO_E2E_KEEP        keep the temp home (logs in host.log) after the run
 *   WEILO_E2E_CHROMIUM    a Chromium binary to use instead of Playwright's
 */
import { defineConfig } from "@playwright/test";

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
