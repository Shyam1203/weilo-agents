import { deviceState, expect, pairingCode, test } from "./fixtures";

test("pair this browser with a code and finish first run", async ({ page }) => {
  await page.goto("/");
  // Not paired yet: the app sends us to the pair page.
  await expect(page.getByRole("heading", { name: "Pair this device" })).toBeVisible();
  await expect(page).toHaveURL(/\/pair/);

  await page.getByLabel("Code").fill("WRONG-CODE");
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.getByRole("alert")).toHaveText("That code didn't work. Check it and try again.");

  await page.getByLabel("Code").fill(pairingCode());
  await page.getByRole("button", { name: "Pair" }).click();

  // Step 1: pick the AI. Echo is under "Other AI apps".
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect your AI" })).toBeVisible();
  await page.getByRole("button", { name: "Other AI apps" }).click();
  await page.getByRole("listitem").filter({ hasText: "Echo" }).getByRole("button", { name: "Use" }).click();

  // Weilo checks the chosen AI once and shows what it found before moving on.
  const check = page.getByRole("region", { name: "Echo" });
  await expect(check.getByRole("status")).toHaveText("Echo is ready.");
  await check.getByRole("button", { name: "Continue" }).click();

  // Step 2: keep awake. Step 3: phone.
  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Get Ava on your phone" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();

  // Home: Ava's chat with the sidebar.
  await expect(page.getByRole("heading", { level: 1, name: "Ava" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
  await expect(page.getByText("Say hi to Ava.")).toBeVisible();

  // Still paired after a reload, and first run doesn't come back.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Ava" })).toBeVisible();
  await expect(page.getByText("Step 1 of 3")).toHaveCount(0);

  await page.context().storageState({ path: deviceState! });
});
