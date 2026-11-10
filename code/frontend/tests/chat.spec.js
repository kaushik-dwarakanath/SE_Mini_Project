import { expect, test } from "@playwright/test";

test("redirects unauthenticated visitors to login", async ({ page }) => {
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("link", { name: "Register", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
});

test.describe("local chat interface", () => {
  test.beforeEach(async ({ page }) => {
    // Exercise the existing client-side route guard, without claiming JWT validation.
    await page.addInitScript(() => localStorage.setItem("token", "ui-test-token"));
    await page.goto("/chat");
    await expect(page.getByRole("status")).toHaveText("Connected to server.");
  });

  test("shows the message area, labelled input and local-preview notice", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Chat Room" })).toBeVisible();
    await expect(page.getByRole("log", { name: "Chat messages" })).toBeVisible();
    await expect(page.getByText("No messages yet.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
    await expect(page.getByText("Local preview:", { exact: false })).toBeVisible();
    await expect(page.locator("#chat-preview-note")).toContainText(
      "clicking Send or pressing Enter only adds your message in this tab."
    );
    await expect(page.getByLabel("Message", { exact: true })).toHaveAccessibleDescription(
      /Your messages are not sent to the server or other users\./
    );
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  });

  test("rejects empty and whitespace-only messages", async ({ page }) => {
    const input = page.getByLabel("Message", { exact: true });
    await input.fill("    ");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await input.press("Enter");
    // Also check the submit handler's guard independently of the disabled button.
    await page.locator(".message-form").evaluate((form) => form.requestSubmit());
    await expect(page.locator(".message")).toHaveCount(0);
  });

  test("sends with click and Enter, trims input, clears and restores focus", async ({ page }) => {
    const input = page.getByLabel("Message", { exact: true });
    await input.fill("  Hello everyone  ");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".message p")).toHaveText(["Hello everyone"]);
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await input.fill("Second message");
    await input.press("Enter");
    await expect(page.locator(".message p")).toHaveText(["Hello everyone", "Second message"]);
    await expect(page.locator(".message-sender")).toHaveText(["You", "You"]);
    const timestamps = await page.locator(".message time").evaluateAll((times) =>
      times.map((time) => ({ datetime: time.getAttribute("datetime"), label: time.textContent }))
    );
    for (const timestamp of timestamps) {
      expect(Number.isNaN(Date.parse(timestamp.datetime))).toBe(false);
      expect(timestamp.label.trim()).not.toBe("");
    }
    await expect(page.getByText("No messages yet.", { exact: false })).toHaveCount(0);
  });

  test("renders markup and Unicode as literal text", async ({ page }) => {
    const text = '<img src=x onerror="alert(1)"> Hello 👋 नमस्ते';
    await page.getByLabel("Message", { exact: true }).fill(text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".message p")).toHaveText(text);
    await expect(page.getByRole("log").locator("img, script")).toHaveCount(0);
  });

  test("wraps long words without horizontal overflow and scrolls to new messages", async ({ page }) => {
    const input = page.getByLabel("Message", { exact: true });
    await input.fill("x".repeat(2000));
    await input.press("Enter");
    for (let index = 0; index < 15; index += 1) {
      await input.fill(`Message ${index}`);
      await input.press("Enter");
    }
    await expect(page.locator(".message")).toHaveCount(16);
    const area = page.getByRole("log");
    await expect.poll(() => area.evaluate((element) =>
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
    )).toBeLessThanOrEqual(2);
    expect(await area.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await area.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(input).toBeInViewport();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
    // The log can be focused and scrolled using a keyboard.
    await area.focus();
    await area.press("Control+Home");
    await expect.poll(() => area.evaluate((element) => element.scrollTop)).toBe(0);
  });

  test("keeps rapid repeated messages distinct without React errors", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const input = page.getByLabel("Message", { exact: true });
    for (let index = 0; index < 10; index += 1) {
      await input.fill("Same message");
      await input.press("Enter");
    }
    await expect(page.locator(".message p")).toHaveText(Array(10).fill("Same message"));
    expect(errors).toEqual([]);
  });

  test("clears local messages on reload and supports logout", async ({ page }) => {
    await page.getByLabel("Message", { exact: true }).fill("Temporary message");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".message")).toHaveCount(1);
    await page.reload();
    await expect(page.locator(".message")).toHaveCount(0);
    await page.getByRole("button", { name: "Logout" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
    await page.getByRole("link", { name: "Login", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });
});
