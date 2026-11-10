import { expect, test } from '@playwright/test';
import { createIdentity, conversationKey, encryptMessage } from '../src/lib/crypto.js';

const password = 'My strong test passphrase 123';
async function createAccount(request, prefix) {
  const username = prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const identity = await createIdentity(password);
  const response = await request.post('/api/auth/register', {
    data: { username, email: username + '@example.test', authKey: identity.authKey, encryption: identity.encryption },
  });
  expect(response.status()).toBe(201);
  return { username, password, ...identity, ...(await response.json()).user };
}
async function login(page, account) {
  await page.goto('/login');
  await page.getByLabel('Username or email', { exact: true }).fill(account.username);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
}
async function choose(page, account) {
  const back = page.getByRole('button', { name: 'Back to people' });
  if (await back.isVisible()) await back.click();
  await page.getByLabel('Search usernames').fill(account.username);
  await page.getByRole('button', { name: account.username, exact: true }).click();
  await expect(page.getByRole('heading', { name: account.username, exact: true })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
}
async function send(page, text) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
}

test('login is required even with a forged saved token, and API access is protected', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('token', 'forged-token'));
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Chat', exact: true })).toHaveCount(0);
  expect((await request.get('/api/users')).status()).toBe(401);
  await page.getByRole('link', { name: 'Register', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
});

test('registration confirms passwords, then login and logout update the navigation', async ({ page }) => {
  const username = 'ui' + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  await page.goto('/register');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Email', { exact: true }).fill(username + '@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill('a different password');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Passwords do not match.');
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  const requestBodies = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/')) requestBodies.push(request.postData() || '');
  });
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Account created successfully');
  await login(page, { username, password });
  expect(requestBodies.join('')).not.toContain(password);
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/chat');
  await expect(page).toHaveURL(/\/login$/);
});

test('real independent browsers exchange encrypted text and recover history on another device', async ({ page, browser, request }) => {
  const [alice, bob, eve] = await Promise.all(['alice', 'bob', 'eve'].map((prefix) => createAccount(request, prefix)));
  const bobContext = await browser.newContext({ viewport: page.viewportSize() });
  const eveContext = await browser.newContext({ viewport: page.viewportSize() });
  // Explicit URLs are needed for manually created contexts.
  const bobPage = await bobContext.newPage();
  const evePage = await eveContext.newPage();
  const base = new URL(test.info().project.use.baseURL || 'http://127.0.0.1:5174');
  // Set baseURL on the contexts via full URL navigation helpers below.
  async function otherLogin(target, account) {
    await target.goto(new URL('/login', base).href);
    await target.getByLabel('Username or email', { exact: true }).fill(account.username);
    await target.getByLabel('Password', { exact: true }).fill(account.password);
    await target.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(target).toHaveURL(/\/chat$/);
  }
  try {
    await Promise.all([login(page, alice), otherLogin(bobPage, bob), otherLogin(evePage, eve)]);
    await Promise.all([choose(page, bob), choose(bobPage, alice), choose(evePage, alice)]);
    const payloads = [];
    page.on('request', (request) => { if (request.url().endsWith('/api/messages')) payloads.push(request.postData()); });
    const text = '<img src=x onerror="alert(1)"> Hello 👋 नमस्ते';
    await send(page, '  ' + text + '  ');
    await expect(bobPage.locator('.message p')).toHaveText([text]);
    await expect(page.locator('.message p')).toHaveText([text]);
    await expect(evePage.locator('.message')).toHaveCount(0);
    expect(payloads.join('')).not.toContain('Hello');
    await expect(bobPage.getByRole('log').locator('img,script')).toHaveCount(0);
    await send(bobPage, 'Reply from another device');
    await expect(page.locator('.message p')).toHaveText([text, 'Reply from another device']);
    await page.getByText('Verify safety number', { exact: true }).click();
    await bobPage.getByText('Verify safety number', { exact: true }).click();
    expect(await page.locator('.safety-details code').textContent()).toBe(await bobPage.locator('.safety-details code').textContent());
    await bobPage.reload();
    await expect(bobPage).toHaveURL(/\/login$/);
    await otherLogin(bobPage, bob);
    await choose(bobPage, alice);
    await expect(bobPage.locator('.message p')).toHaveText([text, 'Reply from another device']);
    await bobContext.close();
    const newDevice = await browser.newContext({ viewport: page.viewportSize() });
    try {
      const newPage = await newDevice.newPage();
      await otherLogin(newPage, bob);
      await choose(newPage, alice);
      await expect(newPage.locator('.message p')).toHaveText([text, 'Reply from another device']);
    } finally { await newDevice.close(); }
  } finally {
    await bobContext.close();
    await eveContext.close();
  }
});

test('input rejects blanks, preserves literal text, scrolls, wraps and sends distinct repeated messages', async ({ page, request }) => {
  const [alice, bob] = await Promise.all(['layouta', 'layoutb'].map((prefix) => createAccount(request, prefix)));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, alice);
  await choose(page, bob);
  const input = page.getByLabel('Message', { exact: true });
  await input.fill('   ');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.locator('.message-form').evaluate((form) => form.requestSubmit());
  await expect(page.locator('.message')).toHaveCount(0);
  await send(page, 'x'.repeat(2000));
  await expect(input).toBeFocused();
  for (let index = 0; index < 12; index += 1) {
    await input.fill('Same message');
    await input.press('Enter');
    await expect(input).toHaveValue('');
  }
  await expect(page.locator('.message')).toHaveCount(13);
  const area = page.getByRole('log');
  await expect.poll(() => area.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(2);
  expect(await area.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(input).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('chat.png') });
  expect(errors).toEqual([]);
});

test('a lost send response preserves the draft and retry creates only one message', async ({ page, request }) => {
  const [alice, bob] = await Promise.all(['retrya', 'retryb'].map((prefix) => createAccount(request, prefix)));
  await login(page, alice);
  await choose(page, bob);
  let intercepted = false;
  await page.route('**/api/messages', async (route) => {
    if (!intercepted && route.request().method() === 'POST') {
      intercepted = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByLabel('Message', { exact: true }).fill('Deliver exactly once');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('press Send to retry');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Deliver exactly once');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(page.locator('.message p')).toHaveText(['Deliver exactly once']);
  await page.reload();
  await login(page, alice);
  await choose(page, bob);
  await expect(page.locator('.message p')).toHaveText(['Deliver exactly once']);
});

test('reconnect loads messages sent while offline and restores sending', async ({ page, browser, request }) => {
  const [alice, bob] = await Promise.all(['offlinea', 'offlineb'].map((prefix) => createAccount(request, prefix)));
  const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: page.viewportSize() });
  try {
    const other = await otherContext.newPage();
    await Promise.all([login(page, alice), login(other, bob)]);
    await Promise.all([choose(page, bob), choose(other, alice)]);
    await page.context().setOffline(true);
    await expect(page.getByRole('status')).toContainText('Reconnecting', { timeout: 35000 });
    await send(other, 'Sent while you were offline');
    await page.context().setOffline(false);
    await expect(page.locator('.message p')).toHaveText(['Sent while you were offline'], { timeout: 20000 });
    await send(page, 'Back online');
    await expect(other.locator('.message p')).toHaveText(['Sent while you were offline', 'Back online']);
  } finally {
    await page.context().setOffline(false);
    await otherContext.close();
  }
});

test('loads older encrypted history in order without duplicate messages', async ({ page, request }) => {
  const [alice, bob] = await Promise.all(['historya', 'historyb'].map((prefix) => createAccount(request, prefix)));
  const loginResponse = await request.post('/api/auth/login', { data: { identifier: alice.username, authKey: alice.authKey } });
  const { token } = await loginResponse.json();
  const key = await conversationKey(alice.privateKey, bob.publicKey, alice.id, bob.id);
  for (let index = 0; index < 55; index += 1) {
    const response = await request.post('/api/messages', {
      headers: { Authorization: 'Bearer ' + token },
      data: await encryptMessage(key, 'History ' + index, alice.id, bob.id),
    });
    expect(response.status()).toBe(201);
  }
  await login(page, bob);
  await choose(page, alice);
  await expect(page.locator('.message')).toHaveCount(50);
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(page.locator('.message p')).toHaveText(Array.from({ length: 55 }, (_, index) => 'History ' + index));
  await expect(page.getByRole('button', { name: 'Load older messages' })).toHaveCount(0);
});

test('blocks sending after a remembered recipient key changes until safety verification', async ({ page, request }) => {
  const [alice, bob] = await Promise.all(['keya', 'keyb'].map((prefix) => createAccount(request, prefix)));
  await login(page, alice);
  await page.evaluate(({ aliceId, bobId }) => {
    localStorage.setItem('simplechat:peer:' + aliceId + ':' + bobId, 'a different remembered public key');
  }, { aliceId: alice.id, bobId: bob.id });
  await page.getByLabel('Search usernames').fill(bob.username);
  await page.getByRole('button', { name: bob.username, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('encryption key changed');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'I verified the new safety number' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await send(page, 'Verified conversation');
  await expect(page.locator('.message p')).toHaveText(['Verified conversation']);
});

test('fails locally before sending login credentials when secure browser crypto is unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(crypto, 'subtle', { value: undefined }));
  const authRequests = [];
  page.on('request', (request) => { if (request.url().includes('/api/auth/')) authRequests.push(request.url()); });
  await page.goto('/login');
  await page.getByLabel('Username or email', { exact: true }).fill('legacy');
  await page.getByLabel('Password', { exact: true }).fill('legacy password');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Secure chat needs HTTPS');
  expect(authRequests).toEqual([]);
  await expect(page).toHaveURL(/\/login$/);
});

test('the built application supports login and encrypted sends under its production content policy', async ({ page, request }) => {
  const [alice, bob] = await Promise.all(['builta', 'builtb'].map((prefix) => createAccount(request, prefix)));
  const violations = [];
  await page.addInitScript(() => {
    window.policyViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.policyViolations.push(event.violatedDirective));
  });
  page.on('pageerror', (error) => violations.push(error.message));
  // The temporary backend serves the actual Vite build on its own origin.
  await page.goto('http://127.0.0.1:5001/login');
  await page.getByLabel('Username or email', { exact: true }).fill(alice.username);
  await page.getByLabel('Password', { exact: true }).fill(alice.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5001/chat');
  await choose(page, bob);
  await send(page, 'Message from the built application');
  await expect(page.locator('.message p')).toHaveText(['Message from the built application']);
  expect(await page.evaluate(() => window.policyViolations)).toEqual([]);
  expect(violations).toEqual([]);
});
