import { expect, test } from "@playwright/test";

// Regression tests for a defect found while testing the chat workflow (issue #18):
// /login and /register are proxied to the backend for API calls, so opening or
// refreshing these pages used to return the backend's 404 instead of the app.

test("opening /login directly shows the login page", async ({ page }) => {
  const response = await page.goto("/login");

  expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("opening /register directly shows the registration page", async ({ page }) => {
  const response = await page.goto("/register");

  expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
});

test("refreshing the login and registration pages keeps them working", async ({ page }) => {
  await page.goto("/login");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  await page.getByRole("link", { name: "Register" }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
});

test("login and registration form submissions still reach the backend", async ({ page }) => {
  const posts = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
  });
  await page.goto("/login");

  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/login");
  await page.getByLabel("Username or email").fill("someone");
  await page.getByLabel("Password").fill("a-password");
  await page.getByRole("button", { name: "Login" }).click();

  // The page-load fix must not affect API calls. The Playwright test server has
  // no /login route and answers with a JSON 404, which shows it was reached.
  expect((await loginResponse).headers()["content-type"]).toContain("application/json");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(posts).toEqual(["/login"]);
});
