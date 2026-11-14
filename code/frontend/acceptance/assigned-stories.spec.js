import { expect, test } from "@playwright/test";

async function login(page, username = "Alice") {
  await page.goto("/login");
  await page.getByLabel("Username or email").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page.getByRole("status", { name: "Connection status" })).toHaveText("Connected to server.");
}
const input = (page) => page.getByLabel("Message", { exact: true });
const typing = (page) => page.getByRole("status", { name: "Typing status" });

async function twoUsers(browser, page) {
  const context = await browser.newContext();
  const bob = await context.newPage();
  await login(page);
  await login(bob, "Bob");
  return { bob, context };
}

test("typing is private, clears on empty/idle/send, and messages reach both users once", async ({ browser, page }) => {
  const { bob, context } = await twoUsers(browser, page);
  try {
    await input(page).fill("Private draft");
    await expect(typing(bob)).toHaveText("Alice is typing...");
    await expect(typing(page)).toBeEmpty();
    await expect(bob.getByRole("log")).not.toContainText("Private draft");
    await input(page).fill("");
    await expect(typing(bob)).toBeEmpty({ timeout: 750 });
    await input(page).fill("   ");
    await expect(typing(bob)).toBeEmpty();
    await input(page).fill("Going idle");
    await expect(typing(bob)).toHaveText("Alice is typing...");
    await expect(typing(bob)).toBeEmpty({ timeout: 3000 });
    await input(page).fill("Hello Bob 👋");
    await expect(typing(bob)).toHaveText("Alice is typing...");
    await input(page).press("Enter");
    await expect(typing(bob)).toBeEmpty({ timeout: 750 });
    for (const client of [page, bob]) {
      await expect(client.locator(".message p")).toHaveText(["Hello Bob 👋"]);
    }
    await expect(page.locator(".message-own")).toHaveCount(1);
    await expect(bob.locator(".message-own")).toHaveCount(0);
    await input(bob).fill("Hi Alice");
    await bob.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".message p")).toHaveText(["Hello Bob 👋", "Hi Alice"]);
    await expect(typing(page)).toBeEmpty();
  } finally { await context.close(); }
});

test("typing clears on leave, logout and transport loss and resumes after reconnect", async ({ browser, page, request }) => {
  const { bob, context } = await twoUsers(browser, page);
  try {
    await input(page).fill("Leaving chat");
    await expect(typing(bob)).toContainText("Alice");
    await page.getByRole("link", { name: "Profile", exact: true }).click();
    await expect(typing(bob)).toBeEmpty();
    await page.getByRole("link", { name: "Chat", exact: true }).click();
    await expect(page.getByRole("status", { name: "Connection status" })).toHaveText("Connected to server.");
    await input(page).fill("Network draft");
    await expect(typing(bob)).toContainText("Alice");
    await request.post("/api/test/drop/Alice");
    await expect(typing(bob)).toBeEmpty();
    await expect(page.getByRole("status", { name: "Connection status" })).toHaveText("Connected to server.", { timeout: 15000 });
    await expect(input(page)).toHaveValue("Network draft");
    await input(page).fill("Resumed typing");
    await expect(typing(bob)).toContainText("Alice");
    await page.getByRole("button", { name: "Logout" }).click();
    await expect(typing(bob)).toBeEmpty();
    await expect(page).toHaveURL(/\/login$/);
  } finally { await context.close(); }
});

test("same-account tabs never show their own typing and one idle tab does not clear another", async ({ browser, page, context }) => {
  const { bob, context: otherContext } = await twoUsers(browser, page);
  const tab = await context.newPage();
  try {
    await tab.goto("/chat");
    await expect(tab.getByRole("status", { name: "Connection status" })).toHaveText("Connected to server.");
    await input(page).fill("Alice's draft");
    await expect(typing(bob)).toContainText("Alice");
    await expect(typing(tab)).toBeEmpty();
    await tab.close();
    await expect(typing(bob)).toContainText("Alice");
    await input(page).fill("");
    await expect(typing(bob)).toBeEmpty({ timeout: 750 });
  } finally { await otherContext.close(); }
});

test("profile loads signed-in account, survives refresh, is read-only, and logout protects history", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible();
    await expect(page.getByText("Alice", { exact: true })).toBeVisible();
    await expect(page.getByText("alice@example.com", { exact: true })).toBeVisible();
    await expect(page.locator("main input, main textarea, main [contenteditable=true]")).toHaveCount(0);
    if (attempt === 0) await page.reload();
  }
  await page.getByRole("button", { name: "Logout" }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: "Profile", exact: true })).toHaveCount(0);
});

test("profile has a loading state and clear errors for network, server and malformed responses", async ({ page }) => {
  await login(page);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/auth/me", async (route) => { await pending; await route.fulfill({ status: 500, json: { message: "Profile unavailable" } }); });
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByText("Loading profile...")).toBeVisible();
  release();
  await expect(page.getByRole("alert")).toHaveText("Profile unavailable");
  await page.unroute("**/api/auth/me");
  for (const user of [{}, { username: {}, email: "alice@example.com" }, { username: "Alice" }]) {
    await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user } }));
    await page.reload();
    await expect(page.getByRole("alert")).toHaveText("Invalid profile response.");
    await page.unroute("**/api/auth/me");
  }
  await page.route("**/api/auth/me", (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("alert")).not.toBeEmpty();
});

test("expired profile session clears the account and redirects to Login", async ({ page }) => {
  await login(page);
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, body: "" }));
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
});

test("typing emits one status per burst without sending draft text", async ({ page }) => {
  const events = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    if (typeof payload === "string" && payload.startsWith("42[")) {
      events.push(JSON.parse(payload.slice(2)));
    }
  }));
  await login(page);
  await input(page).pressSequentially("My private draft", { delay: 20 });
  await expect.poll(() => events.filter(([event]) => event === "typing").length).toBe(1);
  expect(events.filter(([event]) => event === "typing")).toEqual([["typing", { roomId: "general" }]]);
  await input(page).fill("");
  await expect.poll(() => events.filter(([event]) => event === "stop_typing").length).toBe(1);
});

test("sending while offline keeps the draft and does not create a phantom message", async ({ browser, page, request }) => {
  const { bob, context } = await twoUsers(browser, page);
  try {
    await page.route("**/socket.io/**", (route) => route.abort());
    await request.post("/api/test/drop/Alice");
    await expect(page.getByRole("status", { name: "Connection status" })).not.toHaveText("Connected to server.");
    await input(page).fill("Send after reconnect");
    await input(page).press("Enter");
    await expect(page.getByRole("alert")).toHaveText("You are offline. Reconnect before sending your message.");
    await expect(input(page)).toHaveValue("Send after reconnect");
    await expect(page.locator(".message")).toHaveCount(0);
    await expect(bob.locator(".message")).toHaveCount(0);
    await page.unroute("**/socket.io/**");
    await expect(page.getByRole("status", { name: "Connection status" })).toHaveText("Connected to server.", { timeout: 15000 });
    await input(page).press("Enter");
    await expect(bob.locator(".message p")).toHaveText(["Send after reconnect"]);
  } finally { await context.close(); }
});
