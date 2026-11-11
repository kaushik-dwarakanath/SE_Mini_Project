import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Issue #49 — Sync Chat navigation with the login session.
// The /login API is mocked per test with page.route(); the Socket.IO test
// server accepts tokens that start with "ui-test-".

const navbar = (page) => page.getByRole("banner");
const chatLink = (page) => navbar(page).getByRole("link", { name: "Chat", exact: true });
const logoutButton = (page) => navbar(page).getByRole("button", { name: "Logout" });

async function expectSignedOutNavbar(page) {
  await expect(navbar(page).getByRole("link", { name: "Login", exact: true })).toBeVisible();
  await expect(navbar(page).getByRole("link", { name: "Register", exact: true })).toBeVisible();
  await expect(chatLink(page)).toHaveCount(0);
  await expect(logoutButton(page)).toHaveCount(0);
}

async function expectSignedInNavbar(page) {
  await expect(chatLink(page)).toBeVisible();
  await expect(logoutButton(page)).toBeVisible();
  await expect(navbar(page).getByRole("link", { name: "Login", exact: true })).toHaveCount(0);
  await expect(navbar(page).getByRole("link", { name: "Register", exact: true })).toHaveCount(0);
}

// Answers POST /login like the backend; page loads of /login are not affected.
async function mockLogin(page, respond) {
  const requests = [];
  await page.route("**/login", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postDataJSON());
    return respond(route);
  });
  return requests;
}

const loginSucceeds = (token) => (route) =>
  route.fulfill({ status: 200, json: { message: "Login successful", token, user: { username: "alice" } } });

const loginFails = (route) =>
  route.fulfill({ status: 401, json: { message: "Invalid username/email or password" } });

async function submitLogin(page, identifier = "alice", password = "correct-password") {
  await page.getByLabel("Username or email").fill(identifier);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
}

// Puts a token in storage once, before the first page load only (unlike
// addInitScript, which would restore it on every reload).
async function signInBeforeLoad(page, token) {
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("token", value);
    }
  }, token);
}

// A token shaped like the backend's JWT, with the given expiry.
function fakeJwt(expiresInSeconds) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ userId: "u1", exp })}.signature`;
}

// Fails the test if the document is reloaded after this call.
async function markDocument(page) {
  await page.evaluate(() => { window.__sameDocument = true; });
  return () => page.evaluate(() => window.__sameDocument === true);
}

test("signed-out visitors see Login and Register but not Chat", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expectSignedOutNavbar(page);
});

test("a successful login shows Chat and Logout immediately, without reloading", async ({ page }) => {
  const token = `ui-test-${randomUUID()}`;
  const requests = await mockLogin(page, loginSucceeds(token));
  await page.goto("/");
  const stillSameDocument = await markDocument(page);

  await submitLogin(page);

  await expect(page).toHaveURL(/\/chat$/);
  await expectSignedInNavbar(page);
  await expect(page.getByRole("status")).toHaveText("Connected to server.");
  expect(await stillSameDocument()).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBe(token);
  expect(requests).toEqual([{ identifier: "alice", password: "correct-password" }]);
});

test("a failed login leaves the user signed out with Chat hidden", async ({ page }) => {
  await mockLogin(page, loginFails);
  await page.goto("/");

  await submitLogin(page, "alice", "wrong-password");

  await expect(page.getByRole("alert")).toHaveText("Invalid username/email or password");
  await expect(page).toHaveURL(/\/login$/);
  await expectSignedOutNavbar(page);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
});

test("a login response without a token leaves the user signed out", async ({ page }) => {
  await mockLogin(page, (route) => route.fulfill({ status: 200, json: { message: "Login successful" } }));
  await page.goto("/");

  await submitLogin(page);

  await expect(page.getByRole("alert")).toHaveText("Login failed. Please try again.");
  await expectSignedOutNavbar(page);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
});

test("an unreachable server during login leaves the user signed out", async ({ page }) => {
  await mockLogin(page, (route) => route.abort());
  await page.goto("/");

  await submitLogin(page);

  await expect(page.getByRole("alert")).toContainText("Unable to connect to the server.");
  await expectSignedOutNavbar(page);
});

test("a failed attempt followed by a successful login shows Chat", async ({ page }) => {
  const token = `ui-test-${randomUUID()}`;
  let attempt = 0;
  await mockLogin(page, (route) => (++attempt === 1 ? loginFails(route) : loginSucceeds(token)(route)));
  await page.goto("/");

  await submitLogin(page, "alice", "wrong-password");
  await expect(page.getByRole("alert")).toBeVisible();
  await expectSignedOutNavbar(page);

  await submitLogin(page);
  await expect(page).toHaveURL(/\/chat$/);
  await expectSignedInNavbar(page);
});

test("refreshing while signed in keeps Chat visible", async ({ page }) => {
  await signInBeforeLoad(page, `ui-test-${randomUUID()}`);
  await page.goto("/chat");
  await expectSignedInNavbar(page);

  await page.reload();

  await expect(page).toHaveURL(/\/chat$/);
  await expectSignedInNavbar(page);
  await expect(page.getByRole("status")).toHaveText("Connected to server.");
});

test("the session is initialised from storage when the app loads", async ({ page }) => {
  await signInBeforeLoad(page, `ui-test-${randomUUID()}`);

  await page.goto("/");

  await expectSignedInNavbar(page);
  await chatLink(page).click();
  await expect(page.getByRole("heading", { name: "Chat Room" })).toBeVisible();
});

test("an expired saved session is cleared when the app loads", async ({ page }) => {
  await signInBeforeLoad(page, fakeJwt(-60));

  await page.goto("/");

  await expectSignedOutNavbar(page);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
});

test("a saved session that has not expired is kept", async ({ page }) => {
  const token = fakeJwt(3600);
  await signInBeforeLoad(page, token);

  await page.goto("/");

  await expectSignedInNavbar(page);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBe(token);
});

test("logout hides Chat immediately and clears the session", async ({ page }) => {
  await signInBeforeLoad(page, `ui-test-${randomUUID()}`);
  await page.goto("/chat");
  await expectSignedInNavbar(page);
  const stillSameDocument = await markDocument(page);

  await logoutButton(page).click();

  await expect(page).toHaveURL(/\/login$/);
  await expectSignedOutNavbar(page);
  expect(await stillSameDocument()).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("token"))).toBeNull();
});

test("logging out and in again in the same tab updates the navbar each time", async ({ page }) => {
  const token = `ui-test-${randomUUID()}`;
  await mockLogin(page, loginSucceeds(token));
  await page.goto("/");

  for (let round = 0; round < 2; round++) {
    await submitLogin(page);
    await expect(page).toHaveURL(/\/chat$/);
    await expectSignedInNavbar(page);

    await logoutButton(page).click();
    await expect(page).toHaveURL(/\/login$/);
    await expectSignedOutNavbar(page);
  }
});

test("logging out in another tab hides Chat in this tab", async ({ context }) => {
  const token = `ui-test-${randomUUID()}`;
  const first = await context.newPage();
  await signInBeforeLoad(first, token);
  await first.goto("/");
  await expectSignedInNavbar(first);

  const second = await context.newPage();
  await second.goto("/chat");
  await expectSignedInNavbar(second);
  await logoutButton(second).click();
  await expectSignedOutNavbar(second);

  await expectSignedOutNavbar(first);
});
