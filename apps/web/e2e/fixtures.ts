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

/**
 * Asserts nothing scrolls sideways: not the page, and not any scroll area in it (swipe
 * carousels, which scroll sideways on purpose, are left out).
 */
export async function expectNoSideScroll(page: Page): Promise<void> {
  const found = await page.evaluate(() => {
    const out: string[] = [];
    const root = document.scrollingElement ?? document.documentElement;
    if (root.scrollWidth > root.clientWidth) out.push(`page: ${root.scrollWidth} > ${root.clientWidth}`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const x = getComputedStyle(el).overflowX;
      if (x !== "auto" && x !== "scroll") continue;
      if (el.closest("[aria-roledescription=carousel]")) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        out.push(`<${el.tagName.toLowerCase()} class="${el.className}">: ${el.scrollWidth} > ${el.clientWidth}`);
      }
    }
    return out;
  });
  expect(found, "these scroll sideways").toEqual([]);
}
