import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

let token;

test.beforeEach(async ({ page }) => {
  token = `ui-test-${randomUUID()}`;
  await page.addInitScript((value) => localStorage.setItem("token", value), token);
  await page.goto("/chat");
  await expect(page.getByRole("status")).toHaveText("Connected to server.");
});

async function deliver(request, messages) {
  const response = await request.post("/api/test/messages", {
    params: { token },
    data: messages,
  });
  expect(response.ok()).toBe(true);
}

function message(username, text) {
  return { senderId: username, username, text, timestamp: "2026-11-05T05:00:00.000Z" };
}

test("shows incoming messages with the correct sender, content and time without refreshing", async ({ page, request }) => {
  let navigations = 0;
  page.on("framenavigated", () => { navigations += 1; });
  const input = page.getByLabel("Message", { exact: true });
  await input.fill("Unsent draft");
  await deliver(request, [message("Alice", "Hello everyone"), message("Bob", "Hi Alice")]);

  await expect(page.locator(".message-sender")).toHaveText(["Alice", "Bob"]);
  await expect(page.locator(".message p")).toHaveText(["Hello everyone", "Hi Alice"]);
  await expect(page.locator(".message-own")).toHaveCount(0);
  await expect(page.locator(".message time").first()).toHaveAttribute("datetime", "2026-11-05T05:00:00.000Z");
  await expect(page.locator(".message time").first()).not.toBeEmpty();
  await expect(page.locator(".empty-message")).toHaveCount(0);
  await expect(input).toHaveValue("Unsent draft");
  await expect(input).toBeFocused();
  expect(navigations).toBe(0);
});

test("keeps local previews and rapid incoming messages in arrival order", async ({ page, request }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => {
    if (entry.type() === "error") errors.push(entry.text());
  });
  await page.getByLabel("Message", { exact: true }).fill("Local preview");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const incoming = Array.from({ length: 20 }, (_, index) =>
    message(index % 2 ? "Bob" : "Alice", index < 2 ? "Same message" : `Message ${index}`)
  );
  await deliver(request, incoming);
  await expect(page.locator(".message p")).toHaveText(["Local preview", ...incoming.map((item) => item.text)]);
  await expect(page.locator(".message-sender")).toHaveText(["You", ...incoming.map((item) => item.username)]);
  await expect(page.locator(".message-own")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("renders incoming markup literally and keeps long messages within the scrolling log", async ({ page, request }) => {
  const text = '<img src=x onerror="alert(1)"> Hello 👋 नमस्ते\nSecond line';
  await deliver(request, [
    message("<script>Alice</script>", text),
    message("A".repeat(1000), "x".repeat(2000)),
    ...Array.from({ length: 15 }, (_, index) => message("Bob", `Message ${index}`)),
  ]);
  await expect(page.locator(".message p").first()).toHaveText(text);
  await expect(page.locator(".message-sender").first()).toHaveText("<script>Alice</script>");
  const log = page.getByRole("log", { name: "Chat messages" });
  await expect(log.locator("img, script")).toHaveCount(0);
  await expect(page.locator(".message")).toHaveCount(17);
  await expect.poll(() => log.evaluate((element) =>
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)
  )).toBeLessThanOrEqual(2);
  expect(await log.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await log.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByLabel("Message", { exact: true })).toBeInViewport();
});

test("ignores malformed messages and uses receipt time when the timestamp is missing or invalid", async ({ page, request }) => {
  await deliver(request, [
    null, {}, "invalid", { username: "Alice" }, { text: "Missing sender" },
    { username: {}, text: "Invalid sender" }, { username: "Alice", text: {} },
    { username: "   ", text: "Blank sender" }, { username: "Alice", text: "   " },
    { username: "Alice", text: "No timestamp" },
    { username: "Bob", text: "Invalid timestamp", timestamp: "not-a-date" },
    message("Carol", "Still connected"),
  ]);
  await expect(page.locator(".message p")).toHaveText(["No timestamp", "Invalid timestamp", "Still connected"]);
  for (const timestamp of await page.locator(".message time").evaluateAll((times) =>
    times.map((time) => time.dateTime)
  )) {
    expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
  }
  await expect(page.getByRole("status")).toHaveText("Connected to server.");
});

test("receives each message once after reconnecting and returning to chat", async ({ page, request }) => {
  await deliver(request, [message("Alice", "Before reconnect")]);
  await expect(page.locator(".message")).toHaveCount(1);
  const dropped = await request.post("/api/test/drop", { params: { token } });
  expect(dropped.ok()).toBe(true);
  await expect.poll(async () => {
    const response = await request.get("/api/test/connections", { params: { token } });
    return (await response.json()).count;
  }).toBe(1);
  await expect(page.getByRole("status")).toHaveText("Connected to server.");
  await deliver(request, [message("Bob", "After reconnect")]);
  await expect(page.locator(".message p")).toHaveText(["Before reconnect", "After reconnect"]);

  await page.getByRole("link", { name: "SimpleChat" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Connected to server.");
  await expect(page.locator(".message")).toHaveCount(0);
  await deliver(request, [message("Carol", "After returning")]);
  await expect(page.locator(".message p")).toHaveText(["After returning"]);
});
