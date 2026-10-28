# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: first-run.spec.ts >> pair this browser with a code and finish first run
- Location: e2e/first-run.spec.ts:3:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Pair this device' })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('heading', { name: 'Pair this device' }) with timeout 15000ms
  - waiting for getByRole('heading', { name: 'Pair this device' })

```

```yaml
- status: Can't reach your Weilo computer. Trying again…
- status
```

# Test source

```ts
  1  | import { deviceState, expect, pairingCode, test } from "./fixtures";
  2  | 
  3  | test("pair this browser with a code and finish first run", async ({ page }) => {
  4  |   await page.goto("/");
  5  |   // Not paired yet: the app sends us to the pair page.
> 6  |   await expect(page.getByRole("heading", { name: "Pair this device" })).toBeVisible();
     |                                                                         ^ Error: expect(locator).toBeVisible() failed
  7  |   await expect(page).toHaveURL(/\/pair/);
  8  | 
  9  |   await page.getByLabel("Code").fill("WRONG-CODE");
  10 |   await page.getByRole("button", { name: "Pair" }).click();
  11 |   await expect(page.getByRole("alert")).toHaveText("That code didn't work. Check it and try again.");
  12 | 
  13 |   await page.getByLabel("Code").fill(pairingCode());
  14 |   await page.getByRole("button", { name: "Pair" }).click();
  15 | 
  16 |   // Step 1: pick the AI. Echo is under "Other AI apps".
  17 |   await expect(page.getByText("Step 1 of 3")).toBeVisible();
  18 |   await expect(page.getByRole("heading", { name: "Connect your AI" })).toBeVisible();
  19 |   await page.getByRole("button", { name: "Other AI apps" }).click();
  20 |   await page.getByRole("listitem").filter({ hasText: "Echo" }).getByRole("button", { name: "Use" }).click();
  21 | 
  22 |   // Step 2: keep awake. Step 3: phone.
  23 |   await expect(page.getByText("Step 2 of 3")).toBeVisible();
  24 |   await page.getByRole("button", { name: "Not now" }).click();
  25 |   await expect(page.getByText("Step 3 of 3")).toBeVisible();
  26 |   await expect(page.getByRole("heading", { name: "Get Ava on your phone" })).toBeVisible();
  27 |   await page.getByRole("button", { name: "Skip" }).click();
  28 | 
  29 |   // Home: Ava's chat with the sidebar.
  30 |   await expect(page.getByRole("heading", { level: 1, name: "Ava" })).toBeVisible();
  31 |   await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
  32 |   await expect(page.getByText("Say hi to Ava.")).toBeVisible();
  33 | 
  34 |   // Still paired after a reload, and first run doesn't come back.
  35 |   await page.reload();
  36 |   await expect(page.getByRole("heading", { level: 1, name: "Ava" })).toBeVisible();
  37 |   await expect(page.getByText("Step 1 of 3")).toHaveCount(0);
  38 | 
  39 |   await page.context().storageState({ path: deviceState! });
  40 | });
  41 | 
```