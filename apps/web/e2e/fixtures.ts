/** The host started by global-setup.ts, and a `test` that skips when there is none. */
import { execFileSync } from "node:child_process";
import { test as base, expect, type Page } from "@playwright/test";

export const skipReason = process.env.WEILO_E2E_SKIP;

/** Where the paired browser's cookie is kept between projects. */
export const deviceState = process.env.WEILO_E2E_STATE;

export const test = base.extend<{ hostUp: void }>({
  baseURL: async ({}, use) => {
    await use(process.env.WEILO_E2E_URL);
  },
  hostUp: [
    async ({}, use, testInfo) => {
      testInfo.skip(!!skipReason, skipReason);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/** A fresh one-time code from `weilo pair` (over the host's admin socket). */
export function pairingCode(): string {
  const out = execFileSync(process.env.WEILO_E2E_BIN!, ["pair", "--home", process.env.WEILO_E2E_HOME!], { encoding: "utf8" });
  const code = out
    .split("\n")
    .find((l) => l.startsWith("Your code: "))
    ?.slice("Your code: ".length)
    .trim();
  if (!code) throw new Error(`weilo pair printed no code:\n${out}`);
  return code;
}

/** Asserts the page doesn't scroll sideways. */
export async function expectNoSideScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, "page scrolls sideways").toBeLessThanOrEqual(client);
}
