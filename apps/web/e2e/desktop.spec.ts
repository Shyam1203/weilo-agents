import { deviceState, expect, test } from "./fixtures";

test.use({ storageState: deviceState });

test("make an agent on Echo, message it and watch the reply come in", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await sidebar.getByRole("button", { name: "New agent" }).click();

  const dialog = page.getByRole("dialog", { name: "New agent" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Researcher");
  await dialog.getByLabel("AI it uses").selectOption({ label: "Echo" });
  await dialog.getByRole("button", { name: "Make agent" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("heading", { level: 1, name: "Researcher" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /Researcher/ })).toBeVisible();
  await expect(page.getByText("Say hi to Researcher.")).toBeVisible();

  // "slow" makes Echo write its reply in about 30 pieces over 3 seconds.
  const message = "slow please read this back to me";
  const box = page.getByRole("textbox", { name: "Message Researcher" });
  await box.fill(message);
  await box.press("Enter");
  await expect(box).toHaveValue("");

  // While it writes: the working line, and only part of the reply.
  await expect(page.getByText("Researcher is working")).toBeVisible();
  await expect(page.getByText(/^You said: slow/)).toBeVisible();
  await expect(page.getByText(`You said: ${message}`)).toHaveCount(0);

  // Then the whole reply, and it's done.
  await expect(page.getByText(`You said: ${message}`)).toBeVisible();
  await expect(page.getByText("Researcher is working")).toBeHidden();

  // The reply is kept: it's still there after a reload.
  await page.reload();
  await expect(page.getByText(`You said: ${message}`)).toBeVisible();
});

test("make a channel, see it in the sidebar, fold and unfold a section", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const channels = sidebar.getByRole("region", { name: "Channels" });
  await expect(channels).toBeVisible();

  await channels.getByRole("button", { name: "New channel" }).click();
  const dialog = page.getByRole("dialog", { name: "New channel" });
  await dialog.getByLabel("Name").fill("Shop launch");
  await expect(dialog.getByText("Shows as #shop-launch")).toBeVisible();
  await dialog.getByRole("button", { name: "Make channel" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole("heading", { level: 1, name: /shop-launch/ })).toBeVisible();
  const row = channels.getByRole("link", { name: /^#\s?shop-launch$/ });
  await expect(row).toBeVisible();

  // Fold Channels: the row goes away; the choice is kept after a reload.
  const header = channels.getByRole("button", { name: /^Channels/ });
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(row).toBeHidden();
  await page.reload();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(row).toBeHidden();

  // Unfold it again.
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: /shop-launch/ })).toBeVisible();
});

test("an approval shows up in Needs you and can be allowed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Ava" })).toBeVisible();
  const box = page.getByRole("textbox", { name: "Message Ava" });
  await box.fill("approve the checks please");
  await box.press("Enter");
  await expect(page.getByText("You said: approve the checks please")).toBeVisible();

  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const needsLink = sidebar.getByRole("link", { name: /Needs you/ });
  await expect(needsLink).toContainText("1");
  await needsLink.click();

  await expect(page.getByRole("heading", { level: 1, name: "Needs you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting on a yes · 1" })).toBeVisible();
  const card = page.getByRole("article", { name: "Run the shop's checks" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Runs a command")).toBeVisible();
  await card.getByRole("button", { name: "Allow" }).click();

  await expect(card).toBeHidden();
  await expect(page.getByRole("heading", { name: "Done today" })).toBeVisible();
  const done = page.getByRole("link", { name: /Run the shop's checks.*You approved/ });
  await expect(done).toBeVisible();

  // Ava carries on.
  await done.click();
  await expect(page.getByRole("heading", { level: 1, name: "Ava" })).toBeVisible();
  await expect(page.getByText("Allowed.", { exact: true })).toBeVisible();
});
