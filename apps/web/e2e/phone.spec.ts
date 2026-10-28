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
