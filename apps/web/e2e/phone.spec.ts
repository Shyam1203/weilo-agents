import { deviceState, expect, expectNoSideScroll, test } from "./fixtures";

test.use({ storageState: deviceState });

test("phone home shows the chat and the tab bar, with no sideways scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Ava" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Ava" })).toBeVisible();
  // No desktop sidebar on a phone.
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);

  const tabs = page.getByRole("navigation", { name: "Tabs" });
  await expect(tabs).toBeVisible();
  for (const name of ["Chat", "Channels", "Agents", "You"]) {
    await expect(tabs.getByRole("link", { name })).toBeVisible();
  }
  await expect(tabs.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");

  // The tab bar sits at the bottom of the screen, inside it.
  const bar = await tabs.boundingBox();
  expect(bar).not.toBeNull();
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(844 + 0.5);
  expect(bar!.y + bar!.height).toBeGreaterThan(844 - 60);
  expect(bar!.x).toBeGreaterThanOrEqual(0);
  expect(bar!.x + bar!.width).toBeLessThanOrEqual(390 + 0.5);
  await expectNoSideScroll(page);

  // Another tab works the same way.
  await tabs.getByRole("link", { name: "Channels" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Channels" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Channels" })).toHaveAttribute("aria-current", "page");
  await expectNoSideScroll(page);
});

test("phone: a long chat opens at the newest message", async ({ page }) => {
  // The long chat from the desktop tests, if they ran first; else a few messages here.
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Message Ava" });
  for (let i = 1; i <= 6; i++) {
    await box.fill(`Phone line ${i}\nsecond line\nthird line`);
    // Sent once the box empties (a click while the last reply finishes can be too early).
    await expect(async () => {
      if ((await box.inputValue()) !== "") await page.getByRole("button", { name: /^(Send|Tell now)$/ }).click();
      await expect(box).toHaveValue("", { timeout: 1000 });
    }).toPass();
    await expect(page.getByText(`You said: Phone line ${i}`)).toBeVisible();
  }
  await page.reload();
  await expect(page.getByText("You said: Phone line 6")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Jump to newest" })).toHaveCount(0);
});
