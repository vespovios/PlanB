// Session expiry and revocation (stage 3): the page is paused, nothing is lost, only the same account
// resumes it, and nothing is ever sent for or shown to another account. Checked against server data
// and real cookies.
import { expect, test, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { apiAsAgent, CREATOR, createEpisode, login, SOMEONE, waitSaved } from './helpers';

type PW = PlaywrightWorkerArgs['playwright'];
const EXPIRY = { email: 'expiry@example.com', password: 'expiry-password-1' };

const cookieHeader = async (page: Page) => (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
/** Ends a session on the server from outside the browser, as signing out on another device would. */
async function revokeElsewhere(page: Page, playwright: PW, cookie: string) {
  const ctx = await playwright.request.newContext({ baseURL: new URL(page.url()).origin, extraHTTPHeaders: { cookie, 'x-planb-csrf': '1' } });
  expect((await ctx.post('/api/auth/logout')).status()).toBe(200);
  await ctx.dispose();
}
async function meStatus(page: Page, playwright: PW, cookie: string) {
  const ctx = await playwright.request.newContext({ baseURL: new URL(page.url()).origin, extraHTTPHeaders: { cookie } });
  const status = (await ctx.get('/api/auth/me')).status();
  await ctx.dispose();
  return status;
}
const episode = async (page: Page, id: string) => (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
const reauth = (page: Page) => page.getByRole('dialog', { name: 'Sign in again to keep working' });
async function signInAgain(page: Page, password: string) {
  await reauth(page).getByLabel('Password').fill(password);
  await reauth(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(reauth(page)).toHaveCount(0);
}
async function start(page: Page, title: string, who = CREATOR) {
  await login(page, who);
  const id = await createEpisode(page, title);
  await waitSaved(page);
  return { id, original: await episode(page, id) };
}

test('revoked elsewhere: a pending edit and typed input survive; the same account signs in again and it is saved', async ({ page, playwright }) => {
  const { id } = await start(page, 'Expiry revoked');
  const oldCookie = await cookieHeader(page);
  await page.getByLabel('New shot description').first().fill('Typed before the session ended');
  await revokeElsewhere(page, playwright, oldCookie);
  await page.getByLabel('What happens').fill('Edited after the session ended');
  await page.getByLabel('What happens').blur();
  await expect(reauth(page)).toContainText('no longer accepts this sign-in');
  await expect(reauth(page).getByLabel('E-mail')).toHaveValue(CREATOR.email);
  await expect(reauth(page).getByLabel('E-mail')).not.toBeEditable();
  // Wrong password: still paused, nothing sent.
  await reauth(page).getByLabel('Password').fill('not-the-password');
  await reauth(page).getByRole('button', { name: 'Sign in' }).click();
  await expect(reauth(page).getByRole('alert')).toContainText('incorrect');
  expect((await episode(page, id)).scenes[0].description).not.toBe('Edited after the session ended');

  await signInAgain(page, CREATOR.password);
  await waitSaved(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Edited after the session ended');
  await expect(page.getByLabel('What happens')).toHaveValue('Edited after the session ended');
  await expect(page.getByLabel('New shot description').first()).toHaveValue('Typed before the session ended');
  expect(await meStatus(page, playwright, oldCookie)).toBe(401);
  expect(await meStatus(page, playwright, await cookieHeader(page))).toBe(200);
});

test('a save in flight is refused (401), the agent edits the same field meanwhile: after signing in again the choice is offered', async ({ page, playwright }) => {
  const { id, original } = await start(page, 'Expiry conflict');
  const oldCookie = await cookieHeader(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let first = true;
  await page.route('**/api/episodes/*/changes', async (route) => {
    if (first) {
      first = false;
      await held;
    }
    await route.continue();
  });
  await page.getByLabel('What happens').fill('Mine, sent as the session ended');
  await page.getByLabel('What happens').blur();
  await expect.poll(() => first).toBe(false);
  await revokeElsewhere(page, playwright, oldCookie);
  release();
  await expect(reauth(page)).toBeVisible();
  const r = await apiAsAgent(page, 'POST', `/api/episodes/${id}/changes`, {
    baseRevision: original.revision,
    operations: [{ op: 'updateScene', sceneId: original.scenes[0].id, fields: { description: 'Agent, while signed out' } }],
  });
  expect(r.status).toBe(200);
  await signInAgain(page, CREATOR.password);
  await expect(page.getByText('Changed elsewhere while you were editing.')).toBeVisible({ timeout: 10_000 });
  expect((await episode(page, id)).scenes[0].description).toBe('Agent, while signed out');
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await waitSaved(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Mine, sent as the session ended');
});

test('password changed elsewhere: the open drawing survives; after signing in with the new password it saves', async ({ page, playwright }) => {
  const { id } = await start(page, 'Expiry password', EXPIRY);
  const userId = (await (await page.request.get('/api/auth/me')).json()).user.id as string;
  await page.getByRole('button', { name: '✎ Draw / Storyboard' }).click();
  const box = (await page.locator('.sb-canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 200, { steps: 5 });
  await page.mouse.up();
  // The browser copy is kept for this account only.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('planb:storyboard-draft:'))))
    .toEqual([expect.stringContaining(`planb:storyboard-draft:${userId}:${id}:`)]);

  // Another device changes the password: every session of this account ends.
  const other = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  await other.post('/api/auth/login', { data: EXPIRY });
  const changed = await other.post('/api/auth/password', { data: { currentPassword: EXPIRY.password, newPassword: 'expiry-password-2' }, headers: { 'x-planb-csrf': '1' } });
  expect(changed.status()).toBe(200);
  await other.dispose();

  await page.locator('.sb-head').getByRole('button', { name: 'Save' }).click();
  await expect(reauth(page)).toBeVisible();
  await expect(page.locator('.sb-foot')).toContainText('1 object');
  await signInAgain(page, 'expiry-password-2');
  await expect(page.locator('.sb-foot')).toContainText('1 object');
  await page.locator('.sb-head').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.sb-overlay')).toHaveCount(0, { timeout: 10_000 });
  // This account's own session (the agent token belongs to another account).
  const saved = (await (await page.request.get(`/api/episodes/${id}`)).json()).episode;
  expect(saved.scenes[0].storyboard.objects).toHaveLength(1);
});

test('another tab switched to a different account: nothing is sent for it; leaving discards, and the other account sees nothing', async ({ page, context }) => {
  const { id, original } = await start(page, 'Expiry switched account');
  await page.getByLabel('New shot description').first().fill('Private note for the creator');
  // Another tab signs in as Someone: the browser's shared cookie now belongs to Someone.
  const otherTab = await context.newPage();
  expect((await otherTab.request.post(new URL('/api/auth/login', page.url()).href, { data: SOMEONE })).status()).toBe(200);
  const someoneBefore = (await otherTab.request.get(new URL('/api/episodes', page.url()).href)).json();
  await page.getByLabel('What happens').fill('Creator edit after the switch');
  await page.getByLabel('What happens').blur();
  await expect(reauth(page)).toContainText('signed in to a different account');
  // Nothing was written for either account.
  expect((await episode(page, id)).scenes[0].description).toBe(original.scenes[0].description);
  expect(await (await otherTab.request.get(new URL('/api/episodes', page.url()).href)).json()).toEqual(await someoneBefore);
  await otherTab.close();

  await reauth(page).getByRole('button', { name: 'Leave without saving…' }).click();
  const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(leave).toContainText('the server answered them as signed out');
  await expect(leave).toContainText('A new shot typed');
  await leave.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  // Signing in as the other account shows none of it.
  await page.fill('#email', SOMEONE.email);
  await page.fill('#password', SOMEONE.password);
  await page.click('button:has-text("Sign in")');
  // The address still points at the creator's episode: Someone gets an error, not its content.
  await expect(page.getByRole('link', { name: 'Back to episodes' })).toBeVisible();
  await expect(page.getByLabel('Episode title')).toHaveCount(0);
  await expect(page.getByText('Creator edit after the switch')).toHaveCount(0);
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Episodes', level: 1 })).toBeVisible();
  await expect(page.getByText('Expiry switched account')).toHaveCount(0);
  expect((await page.request.get(`/api/episodes/${id}`)).status()).toBe(404);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('planb:storyboard-draft:')))).toEqual([]);
  await page.waitForTimeout(1500);
  expect((await episode(page, id)).scenes[0].description).toBe(original.scenes[0].description);
});

test('a late 401 for the old session after signing in again does not end the new one; the edit is saved', async ({ page, playwright }) => {
  const { id } = await start(page, 'Expiry late 401');
  const oldCookie = await cookieHeader(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let first = true;
  await page.route('**/api/episodes/*/changes', async (route) => {
    if (!first) return route.continue();
    first = false;
    await held;
    // Sent with the old session's cookie, as it was when the request was made.
    await route.continue({ headers: { ...route.request().headers(), cookie: oldCookie } });
  });
  await page.getByLabel('What happens').fill('Sent just before expiry');
  await page.getByLabel('What happens').blur();
  await expect.poll(() => first).toBe(false);
  await revokeElsewhere(page, playwright, oldCookie);
  await page.getByRole('button', { name: 'History' }).click(); // any request now gets 401
  await expect(reauth(page)).toBeVisible();
  await signInAgain(page, CREATOR.password);
  release(); // the old request is answered 401 only now
  await waitSaved(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Sent just before expiry');
  await expect(reauth(page)).toHaveCount(0);
  expect(await meStatus(page, playwright, await cookieHeader(page))).toBe(200);
});

test('Stay after an unconfirmed sign-out that the server did apply: the next save asks to sign in again and keeps the edit', async ({ page }) => {
  const { id } = await start(page, 'Expiry after unconfirmed sign-out');
  let lose = true;
  await page.route('**/api/auth/logout', async (route) => {
    if (!lose) return route.continue();
    lose = false;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await page.locator('.rail .avatar').click();
  await page.locator('.rail-menu').getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog', { name: 'Could not confirm sign-out' }).getByRole('button', { name: 'Stay' }).click();
  await page.getByLabel('What happens').fill('Typed after Stay');
  await page.getByLabel('What happens').blur();
  await expect(reauth(page)).toBeVisible();
  await expect(page.getByLabel('What happens')).toHaveValue('Typed after Stay');
  await signInAgain(page, CREATOR.password);
  await waitSaved(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Typed after Stay');
});

test('a 401 while signing out pauses instead of losing the edit; after signing in again it is saved and sign-out works', async ({ page, playwright }) => {
  const { id } = await start(page, 'Expiry during sign-out');
  const oldCookie = await cookieHeader(page);
  await revokeElsewhere(page, playwright, oldCookie);
  // Hold the save so its 401 arrives while the sign-out is waiting for it.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let first = true;
  await page.route('**/api/episodes/*/changes', async (route) => {
    if (first) {
      first = false;
      await held;
    }
    await route.continue();
  });
  await page.getByLabel('What happens').fill('Typed, then Sign out');
  await page.locator('.rail .avatar').click();
  await page.locator('.rail-menu').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Signing out' })).toBeVisible();
  release();
  await expect(reauth(page)).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Signing out|not confirmed/ })).toHaveCount(0);
  await signInAgain(page, CREATOR.password);
  await waitSaved(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Typed, then Sign out');
  const newCookie = await cookieHeader(page);
  if (!(await page.locator('.rail-menu').isVisible())) await page.locator('.rail .avatar').click();
  await page.locator('.rail-menu').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await meStatus(page, playwright, newCookie)).toBe(401);
});
