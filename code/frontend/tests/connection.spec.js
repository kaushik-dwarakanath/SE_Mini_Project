
// tests/connection.spec.js
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

async function openChat(page, token = `ui-test-${randomUUID()}`) {
  await page.addInitScript((value) => localStorage.setItem("token", value), token);
  await page.goto("/chat");
  return token;
}

async function connectionCount(request, token) {
  const response = await request.get("/api/test/connections", {
    params: { token },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).count;
}

async function mockProfile(page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { username: "TestUser", email: "test@example.com" },
      }),
    })
  );
}

test("connects with the saved token and upgrades through the Vite WebSocket proxy", async ({ page, request }) => {
  const websockets = [];
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/socket.io/") {
      websockets.push(socket);
    }
  });

  const token = await openChat(page);

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connected to server.");

  await expect.poll(() => connectionCount(request, token)).toBe(1);
  await expect.poll(() => websockets.filter((socket) => !socket.isClosed()).length).toBe(1);
  expect(websockets.at(-1).url()).toMatch(/^ws:\/\/127\.0\.0\.1:5174\/socket\.io\//);
});

test("shows a pending connection before the server responds", async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });

  await page.route("**/socket.io/**", async (route) => {
    await pending;
    await route.continue();
  });

  try {
    await openChat(page);
    await expect(
      page.getByRole("status", { name: "Connection status" })
    ).toHaveText("Connecting to server…");
  } finally {
    release();
  }

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connected to server.");
});

test("handles an unavailable server and connects when it becomes reachable", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.route("**/socket.io/**", (route) => route.abort());

  await openChat(page);

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Unable to connect to server. Retrying…");

  await expect(page.getByRole("heading", { name: "Chat Room" })).toBeVisible();
  await page.getByLabel("Message", { exact: true }).fill("Draft while offline");

  await page.unroute("**/socket.io/**");

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connected to server.", { timeout: 15000 });

  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Draft while offline");
  expect(errors).toEqual([]);
});

test("handles authentication rejection without crashing or claiming to retry", async ({ page, request }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const token = await openChat(page, "invalid-token");

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connection rejected. Please log in again.");

  await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
  expect(await connectionCount(request, token)).toBe(0);

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});

test("reconnects after transport loss without duplicating the connection", async ({ page, request }) => {
  const token = await openChat(page);

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connected to server.");

  await page.getByLabel("Message", { exact: true }).fill("Keep this draft");

  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });

  await page.route("**/socket.io/**", async (route) => {
    await pending;
    await route.continue();
  });

  try {
    const response = await request.post("/api/test/drop", {
      params: { token },
    });
    expect(response.ok()).toBe(true);

    await expect(
      page.getByRole("status", { name: "Connection status" })
    ).toHaveText("Disconnected from server. Reconnecting…");
  } finally {
    release();
  }

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connected to server.", { timeout: 15000 });

  await expect.poll(() => connectionCount(request, token)).toBe(1);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Keep this draft");
});

test("handles an explicit server disconnect and reconnects on refresh", async ({ page, request }) => {
  const token = await openChat(page);

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connected to server.");

  const response = await request.post("/api/test/disconnect", {
    params: { token },
  });
  expect(response.ok()).toBe(true);

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Disconnected from server. Refresh to reconnect.");

  await expect.poll(() => connectionCount(request, token)).toBe(0);

  await page.reload();

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connected to server.");

  await expect.poll(() => connectionCount(request, token)).toBe(1);
});

test("closes the connection on navigation and logout", async ({ page, request }) => {
  const token = await openChat(page);

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connected to server.");

  await expect.poll(() => connectionCount(request, token)).toBe(1);

  await mockProfile(page);
  await page.getByRole("link", { name: "Profile", exact: true }).click();

  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible();
  await expect.poll(() => connectionCount(request, token)).toBe(0);

  await page.getByRole("link", { name: "Chat", exact: true }).click();

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Connected to server.");

  await expect.poll(() => connectionCount(request, token)).toBe(1);

  await page.getByRole("button", { name: "Logout" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => connectionCount(request, token)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
});

test("leaving chat cancels pending reconnection attempts", async ({ page }) => {
  let attempts = 0;

  await page.route("**/socket.io/**", (route) => {
    attempts += 1;
    return route.abort();
  });

  await openChat(page);

  await expect(
    page.getByRole("status", { name: "Connection status" })
  ).toHaveText("Unable to connect to server. Retrying…");

  await page.getByRole("link", { name: /profile/i }).click();
await expect(page).toHaveURL(/\/profile$/);

  const attemptsAfterLeaving = attempts;
  await page.waitForTimeout(2000);
  expect(attempts).toBe(attemptsAfterLeaving);
});
