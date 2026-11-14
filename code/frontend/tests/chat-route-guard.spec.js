import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Issue #50 — Use the login session to guard the Chat route.
// Covers direct navigation, refresh, logout and the browser Back/Forward
// buttons. The Socket.IO test server counts open connections per token.

const chatHeading = (page) => page.getByRole("heading", { name: "Chat Room" });
const loginHeading = (page) => page.getByRole("heading", { name: "Welcome back" });
const navbar = (page) => page.getByRole("banner");

async function connectionCount(request, token) {
  const response = await request.get("/api/test/connections", { params: { token } });
  expect(response.ok()).toBe(true);
  return (await response.json()).count;
}

// Saves a token before the first page load only, so reloads and history
// navigation see what the app itself stored.
async function signInBeforeLoad(page, token = `ui-test-${randomUUID()}`) {
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("token", value);
    }
  }, token);
  return token;
}

async function loginThroughForm(page, token = `ui-test-${randomUUID()}`) {
  await page.route("**/login", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 200, json: { message: "Login successful", token } })
      : route.continue()
  );
  await page.goto("/");
  await page.getByLabel("Username or email").fill("alice");
  await page.getByLabel("Password").fill("correct-password");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(chatHeading(page)).toBeVisible();
  return token;
}

// Records whether the chat page was ever rendered (even for one frame).
async function watchForChat(page) {
  await page.evaluate(() => {
    window.__chatShown = false;
    new MutationObserver(() => {
      if (document.querySelector("#chat-title")) window.__chatShown = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => window.__chatShown);
}

async function expectRedirectedToLogin(page) {
  await expect(page).toHaveURL(/\/login$/);
  await expect(loginHeading(page)).toBeVisible();
  await expect(chatHeading(page)).toHaveCount(0);
}

test.describe("without a session", () => {
  test("opening /chat directly redirects to Login without connecting", async ({ page }) => {
    const socketRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/socket.io/")) socketRequests.push(request.url());
    });

    await page.goto("/chat");

    await expectRedirectedToLogin(page);
    expect(socketRequests).toEqual([]);
  });

  test("an expired saved session cannot open /chat", async ({ page }) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const expired = `${encode({ alg: "HS256" })}.${encode({ userId: "u1", exp: 1 })}.signature`;
    await signInBeforeLoad(page, expired);

    await page.goto("/chat");

    await expectRedirectedToLogin(page);
  });

  test("Back to /chat after logout redirects to Login", async ({ page, request }) => {
    const token = await signInBeforeLoad(page);
    await page.goto("/chat");
    await expect(chatHeading(page)).toBeVisible();
    // Leave the chat with a normal link so /chat stays in the history.
    await navbar(page).getByRole("link", { name: "SimpleChat" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await navbar(page).getByRole("button", { name: "Logout" }).click();
    await expect(navbar(page).getByRole("link", { name: "Login", exact: true })).toBeVisible();
    const chatShown = await watchForChat(page);

    await page.goBack();

    await expectRedirectedToLogin(page);
    expect(await chatShown()).toBe(false);
    await expect.poll(() => connectionCount(request, token)).toBe(0);
  });

  test("logging out on the chat page and pressing Back does not return to the chat", async ({ page, request }) => {
    // History: [/chat (after login)] -> [/login] -> [/chat]
    const token = await loginThroughForm(page);
    await navbar(page).getByRole("link", { name: "SimpleChat" }).click();
    await navbar(page).getByRole("link", { name: "Chat", exact: true }).click();
    await expect(chatHeading(page)).toBeVisible();

    // Logout replaces the current /chat entry with /login.
    await navbar(page).getByRole("button", { name: "Logout" }).click();
    await expectRedirectedToLogin(page);
    const chatShown = await watchForChat(page);

    await page.goBack(); // the earlier /login entry
    await expectRedirectedToLogin(page);
    await page.goBack(); // the first /chat entry
    await expectRedirectedToLogin(page);

    expect(await chatShown()).toBe(false);
    await expect.poll(() => connectionCount(request, token)).toBe(0);
  });

  test("Forward to /chat after logout redirects to Login", async ({ page }) => {
    // History: [/chat] -> [/login] -> [/chat], then back to the first entry.
    await signInBeforeLoad(page);
    await page.goto("/chat");
    await navbar(page).getByRole("link", { name: "SimpleChat" }).click();
    await navbar(page).getByRole("link", { name: "Chat", exact: true }).click();
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(chatHeading(page)).toBeVisible();

    await navbar(page).getByRole("button", { name: "Logout" }).click();
    await expectRedirectedToLogin(page);
    const chatShown = await watchForChat(page);

    await page.goForward(); // the /login entry
    await expectRedirectedToLogin(page);
    await page.goForward(); // the later /chat entry
    await expectRedirectedToLogin(page);
    expect(await chatShown()).toBe(false);
  });

  test("signing out in another tab moves this tab off the chat and closes its connection", async ({ context, request }) => {
    const first = await context.newPage();
    const token = await signInBeforeLoad(first);
    await first.goto("/chat");
    await expect(first.getByRole("status")).toHaveText("Connected to server.");
    await expect.poll(() => connectionCount(request, token)).toBe(1);

    const second = await context.newPage();
    await second.goto("/chat");
    await expect(chatHeading(second)).toBeVisible();
    await navbar(second).getByRole("button", { name: "Logout" }).click();

    await expectRedirectedToLogin(first);
    await expect.poll(() => connectionCount(request, token)).toBe(0);
  });
});

test.describe("with a session", () => {
  test("opening /chat directly reaches the room", async ({ page, request }) => {
    const token = await signInBeforeLoad(page);

    await page.goto("/chat");

    await expect(page).toHaveURL(/\/chat$/);
    await expect(chatHeading(page)).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Connected to server.");
    await expect.poll(() => connectionCount(request, token)).toBe(1);
  });

  test("refreshing /chat stays in the room", async ({ page, request }) => {
    const token = await signInBeforeLoad(page);
    await page.goto("/chat");
    await expect(page.getByRole("status")).toHaveText("Connected to server.");

    await page.reload();

    await expect(page).toHaveURL(/\/chat$/);
    await expect(chatHeading(page)).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Connected to server.");
    await expect.poll(() => connectionCount(request, token)).toBe(1);
  });

  test("after logging in, the Chat link and Back/Forward reach the room", async ({ page }) => {
    await loginThroughForm(page);
    await navbar(page).getByRole("link", { name: "SimpleChat" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(chatHeading(page)).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/login$/);
    await navbar(page).getByRole("link", { name: "Chat", exact: true }).click();
    await expect(chatHeading(page)).toBeVisible();
  });
});
