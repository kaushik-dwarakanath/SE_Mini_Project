import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Issue #46 — Show Chat only after login (parent story of #49 and #50).
// One user journey that walks through every acceptance criterion in order.

test("Chat appears only after login, survives refresh and goes away on sign-out", async ({ page, request }) => {
  const navbar = page.getByRole("banner");
  const chatLink = navbar.getByRole("link", { name: "Chat", exact: true });
  const logout = navbar.getByRole("button", { name: "Logout" });
  const loginLink = navbar.getByRole("link", { name: "Login", exact: true });
  const registerLink = navbar.getByRole("link", { name: "Register", exact: true });
  const chatHeading = page.getByRole("heading", { name: "Chat Room" });
  const token = `ui-test-${randomUUID()}`;

  let attempts = 0;
  await page.route("**/login", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 401, json: { message: "Invalid username/email or password" } })
      : route.fulfill({ status: 200, json: { message: "Login successful", token } });
  });

  await test.step("signed-out visitors see Login and Register", async () => {
    await page.goto("/");
    await expect(loginLink).toBeVisible();
    await expect(registerLink).toBeVisible();
    await expect(chatLink).toHaveCount(0);
    await expect(logout).toHaveCount(0);
  });

  await test.step("opening /chat directly redirects to Login", async () => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login$/);
    await expect(chatHeading).toHaveCount(0);
  });

  await test.step("a failed login leaves the user signed out", async () => {
    await page.getByLabel("Username or email").fill("alice");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid username/email or password");
    await expect(chatLink).toHaveCount(0);
    await expect(loginLink).toBeVisible();
  });

  await test.step("a successful login shows Chat and Logout immediately", async () => {
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.getByLabel("Password").fill("correct-password");
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(chatLink).toBeVisible();
    await expect(logout).toBeVisible();
    await expect(loginLink).toHaveCount(0);
    await expect(chatHeading).toBeVisible();
    expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  });

  await test.step("refreshing with a valid session preserves access", async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(chatHeading).toBeVisible();
    await expect(chatLink).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Connected to server.");
  });

  await test.step("signing out removes Chat", async () => {
    // Leave and re-open the chat with links so /chat is in the history twice:
    // [/chat] -> [/login] -> [/chat]. Logout replaces the last entry.
    await navbar.getByRole("link", { name: "SimpleChat" }).click();
    await chatLink.click();
    await expect(chatHeading).toBeVisible();

    await logout.click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(chatLink).toHaveCount(0);
    await expect(logout).toHaveCount(0);
    await expect(loginLink).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
  });

  await test.step("browser history cannot return to the chat after signing out", async () => {
    await page.goBack(); // the /login entry
    await expect(page).toHaveURL(/\/login$/);
    await page.goBack(); // the earlier /chat entry
    await expect(page).toHaveURL(/\/login$/);
    await expect(chatHeading).toHaveCount(0);
    await expect(chatLink).toHaveCount(0);

    const response = await request.get("/api/test/connections", { params: { token } });
    expect((await response.json()).count).toBe(0);
  });
});
