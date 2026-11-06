// Coordinated sign-out (issues #1 and #2): unsaved work is saved first or explicitly discarded,
// and "signed out" is shown only once the server confirmed it. Checked against server data and
// the old session cookie, not just the screen.
import { expect, test, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { apiAsAgent, createEpisode, login, outcome, samplePngFile, waitSaved } from './helpers';

type PW = PlaywrightWorkerArgs['playwright'];

/** Status of /api/auth/me for the session cookie the page has now (replayed outside the browser). */
async function sessionProbe(page: Page, playwright: PW) {
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const origin = new URL(page.url()).origin;
  return async () => {
    const ctx = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { cookie } });
    const status = (await ctx.get('/api/auth/me')).status();
    await ctx.dispose();
    return status;
  };
}
const menuSignOut = (page: Page) => page.locator('.rail-menu').getByRole('button', { name: 'Sign out', exact: true });
/** Desktop: Sign out from the account menu. */
async function clickSignOut(page: Page) {
  if (!(await menuSignOut(page).isVisible())) await page.locator('.rail .avatar').click();
  await menuSignOut(page).click();
}
const expectSignedOut = (page: Page) => expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });
const episode = async (page: Page, id: string) => (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
/** Clicks Sign out even while a full-screen editor covers it (as a later stage's transitions will). */
async function signOutBehindEditor(page: Page) {
  await page.evaluate(() => {
    if (!document.querySelector('.rail-menu')) document.querySelector<HTMLButtonElement>('.rail .avatar')!.click();
  });
  await menuSignOut(page).dispatchEvent('click');
}
const draftKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('planb:storyboard-draft:')));

async function start(page: Page, title: string) {
  await login(page);
  const id = await createEpisode(page, title);
  await waitSaved(page);
  return { id, original: await episode(page, id) };
}

test('an edit typed just before signing out is saved first; then the session is revoked', async ({ page, playwright }) => {
  const { id } = await start(page, 'Sign-out immediate');
  const probe = await sessionProbe(page, playwright);
  await page.getByLabel('What happens').fill('Typed right before signing out');
  await clickSignOut(page);
  await expectSignedOut(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Typed right before signing out');
  expect(await probe()).toBe(401);
  await page.reload();
  await expectSignedOut(page);
});

test('a save in flight and an edit queued behind it are both saved before signing out', async ({ page, playwright }) => {
  const { id } = await start(page, 'Sign-out in flight');
  const probe = await sessionProbe(page, playwright);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let sent = 0;
  await page.route('**/api/episodes/*/changes', async (route) => {
    if (sent++ === 0) await held;
    await route.continue();
  });
  await page.getByLabel('What happens').fill('First, held in flight');
  await page.getByLabel('What happens').blur();
  await expect.poll(() => sent).toBe(1);
  await page.getByLabel('Episode title').fill('Second, queued behind it');
  await clickSignOut(page);
  await expect(dialog(page, 'Signing out')).toBeVisible();
  release();
  await expectSignedOut(page);
  const ep = await episode(page, id);
  expect(ep.scenes[0].description).toBe('First, held in flight');
  expect(ep.title).toBe('Second, queued behind it');
  expect(await probe()).toBe(401);
});

test('offline: Stay keeps the edit and the session; Retry saving saves it and signs out', async ({ page, context, playwright }) => {
  const { id } = await start(page, 'Sign-out offline');
  const probe = await sessionProbe(page, playwright);
  await context.setOffline(true);
  await page.getByLabel('What happens').fill('Typed offline');
  await expect(page.locator('.save-status').first()).toContainText('Not saved', { timeout: 10_000 });
  await clickSignOut(page);
  const blocked = dialog(page, 'Not everything is saved');
  await expect(blocked).toContainText('until the connection returns');
  await expect(blocked).toContainText('You are still signed in');
  await blocked.getByRole('button', { name: 'Stay' }).click();
  await expect(blocked).toHaveCount(0);
  await expect(page.getByLabel('What happens')).toHaveValue('Typed offline');
  expect(await probe()).toBe(200);

  await clickSignOut(page);
  await expect(blocked).toBeVisible();
  await context.setOffline(false);
  await blocked.getByRole('button', { name: 'Retry saving' }).click();
  await expectSignedOut(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Typed offline');
  expect(await probe()).toBe(401);
});

test('a server error (500) blocks sign-out until Retry saving succeeds', async ({ page, playwright }) => {
  const { id } = await start(page, 'Sign-out 500');
  const probe = await sessionProbe(page, playwright);
  let fail = true;
  await page.route('**/api/episodes/*/changes', (route) =>
    fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Database is busy.' }) }) : route.continue(),
  );
  await page.getByLabel('What happens').fill('Saved after a server error');
  await page.getByLabel('What happens').blur();
  await expect(page.getByRole('alert').first()).toContainText('press Retry');
  await clickSignOut(page);
  const blocked = dialog(page, 'Not everything is saved');
  await expect(blocked).toContainText('after a server error');
  expect(await probe()).toBe(200);
  fail = false;
  await blocked.getByRole('button', { name: 'Retry saving' }).click();
  await expectSignedOut(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Saved after a server error');
  expect(await probe()).toBe(401);
});

test('503 on save: sign out without saving discards only after confirming, and nothing is sent afterwards', async ({ page, playwright }) => {
  const { id, original } = await start(page, 'Sign-out 503 discard');
  const probe = await sessionProbe(page, playwright);
  let attempts = 0;
  await page.route('**/api/episodes/*/changes', (route) => {
    attempts++;
    return route.fulfill({ status: 503, body: 'Service Unavailable' });
  });
  await page.getByLabel('What happens').fill('Never saved');
  await page.getByLabel('What happens').blur();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await clickSignOut(page);
  const blocked = dialog(page, 'Not everything is saved');
  await expect(blocked).toContainText('until the connection returns');
  await blocked.getByRole('button', { name: 'Sign out without saving…' }).click();
  const confirm = dialog(page, 'Sign out without saving?');
  await expect(confirm).toContainText('cannot be recovered');
  // Back keeps everything.
  await confirm.getByRole('button', { name: 'Back' }).click();
  await expect(blocked).toBeVisible();
  await blocked.getByRole('button', { name: 'Sign out without saving…' }).click();
  await confirm.getByRole('button', { name: 'Discard and sign out' }).click();
  await expectSignedOut(page);
  expect(await probe()).toBe(401);
  expect((await episode(page, id)).scenes[0].description).toBe(original.scenes[0].description);
  // No orphan retry keeps sending the discarded edit.
  const after = attempts;
  await page.waitForTimeout(5000);
  expect(attempts).toBe(after);
});

test('an unresolved conflict blocks sign-out; Stay returns to the Keep mine / Use newer choice', async ({ page, playwright }) => {
  const { id, original } = await start(page, 'Sign-out conflict');
  const probe = await sessionProbe(page, playwright);
  await page.getByLabel('What happens').fill('Human version');
  await apiAsAgent(page, 'POST', `/api/episodes/${id}/changes`, {
    baseRevision: original.revision,
    operations: [{ op: 'updateScene', sceneId: original.scenes[0].id, fields: { description: 'Agent version' } }],
  });
  await expect(page.getByText('Changed elsewhere while you were editing.')).toBeVisible({ timeout: 10_000 });
  await clickSignOut(page);
  const blocked = dialog(page, 'Not everything is saved');
  await expect(blocked).toContainText('Keep mine / Use newer');
  await expect(blocked.getByRole('button', { name: 'Retry saving' })).toHaveCount(0);
  await blocked.getByRole('button', { name: 'Stay' }).click();
  expect(await probe()).toBe(200);
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await waitSaved(page);
  await clickSignOut(page);
  await expectSignedOut(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Human version');
  expect(await probe()).toBe(401);
});

test('an edit the server refused is reported and must be explicitly dismissed by signing out without saving', async ({ page, playwright }) => {
  await start(page, 'Sign-out rejected');
  const probe = await sessionProbe(page, playwright);
  let refuse = true;
  await page.route('**/api/episodes/*/changes', (route) =>
    refuse ? ((refuse = false), route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'That text is too long.' }) })) : route.continue(),
  );
  await page.getByLabel('What happens').fill('Refused');
  await page.getByLabel('What happens').blur();
  await expect(page.getByRole('alert').first()).toContainText('Not saved: That text is too long.');
  await clickSignOut(page);
  const blocked = dialog(page, 'Not everything is saved');
  await expect(blocked).toContainText('That text is too long.');
  await blocked.getByRole('button', { name: 'Sign out without saving…' }).click();
  const confirm = dialog(page, 'Sign out without saving?');
  await expect(confirm).toContainText('are dismissed');
  await confirm.getByRole('button', { name: 'Discard and sign out' }).click();
  await expectSignedOut(page);
  expect(await probe()).toBe(401);
});

test('sign-out request fails on the network: "Could not confirm", session still valid, Try again signs out', async ({ page, playwright }) => {
  await start(page, 'Sign-out network failure');
  const probe = await sessionProbe(page, playwright);
  let fail = true;
  await page.route('**/api/auth/logout', (route) => (fail ? route.abort('internetdisconnected') : route.continue()));
  await clickSignOut(page);
  const unconfirmed = dialog(page, 'Could not confirm sign-out');
  await expect(unconfirmed).toContainText('may still be signed in');
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  expect(await probe()).toBe(200);
  fail = false;
  await unconfirmed.getByRole('button', { name: 'Try again' }).click();
  await expectSignedOut(page);
  expect(await probe()).toBe(401);
});

test('sign-out answered 503: Stay keeps the page working, a later sign-out succeeds', async ({ page, playwright }) => {
  const { id } = await start(page, 'Sign-out 503 logout');
  const probe = await sessionProbe(page, playwright);
  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 503, body: 'Service Unavailable' }));
  await clickSignOut(page);
  const unconfirmed = dialog(page, 'Could not confirm sign-out');
  await expect(unconfirmed).toBeVisible();
  await unconfirmed.getByRole('button', { name: 'Stay' }).click();
  await page.getByLabel('What happens').fill('Still editing after a failed sign-out');
  await waitSaved(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Still editing after a failed sign-out');
  await page.unroute('**/api/auth/logout');
  await clickSignOut(page);
  await expectSignedOut(page);
  expect(await probe()).toBe(401);
});

test('sign-out applied by the server but the answer was lost: unconfirmed, then Try again confirms it', async ({ page, playwright }) => {
  await start(page, 'Sign-out lost answer');
  const probe = await sessionProbe(page, playwright);
  let lose = true;
  await page.route('**/api/auth/logout', async (route) => {
    if (!lose) return route.continue();
    lose = false;
    await route.fetch(); // the server revokes the session…
    await route.abort('connectionreset'); // …but the browser never hears back
  });
  await clickSignOut(page);
  const unconfirmed = dialog(page, 'Could not confirm sign-out');
  await expect(unconfirmed).toBeVisible();
  expect(await probe()).toBe(401);
  await unconfirmed.getByRole('button', { name: 'Try again' }).click();
  await expectSignedOut(page);
});

test('repeated clicks send one sign-out request', async ({ page }) => {
  await start(page, 'Sign-out repeated clicks');
  let logouts = 0;
  page.on('request', (r) => r.url().endsWith('/api/auth/logout') && logouts++);
  await page.locator('.rail .avatar').click();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('.rail-menu button')].find((x) => x.textContent?.trim() === 'Sign out')!;
    b.click();
    b.click();
    b.click();
  });
  await expectSignedOut(page);
  expect(logouts).toBe(1);
});

test('a drawing being saved finishes before signing out', async ({ page, playwright }) => {
  const { id } = await start(page, 'Sign-out drawing save');
  const probe = await sessionProbe(page, playwright);
  await page.getByRole('button', { name: '✎ Draw / Storyboard' }).click();
  const box = (await page.locator('.sb-canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 200, { steps: 5 });
  await page.mouse.up();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/episodes/*/changes', async (route) => {
    if (route.request().postData()?.includes('saveStoryboard')) await held;
    await route.continue();
  });
  await page.locator('.sb-head').getByRole('button', { name: 'Save' }).click();
  await signOutBehindEditor(page);
  await expect(dialog(page, 'Signing out')).toBeVisible();
  release();
  await expectSignedOut(page);
  expect((await episode(page, id)).scenes[0].storyboard.objects).toHaveLength(1);
  expect(await probe()).toBe(401);
});

test('an image upload in progress is waited for and linked; the drawing it was for is never saved automatically', async ({ page, playwright }) => {
  const { id } = await start(page, 'Sign-out upload');
  const probe = await sessionProbe(page, playwright);
  await page.getByRole('button', { name: '✎ Draw / Storyboard' }).click();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/episodes/*/assets', async (route) => {
    await held;
    await route.continue();
  });
  const uploaded = page.waitForRequest('**/api/episodes/*/assets');
  await page.locator('.sb-toolbar input[type=file]').setInputFiles(await samplePngFile());
  await uploaded;
  await signOutBehindEditor(page);
  await expect(dialog(page, 'Signing out')).toBeVisible();
  release();
  // The upload and its link are saved; the drawing now has an unsaved background and blocks.
  const blocked = dialog(page, 'Not everything is saved');
  await expect(blocked).toContainText('The drawing for', { timeout: 15_000 });
  const ep = await episode(page, id);
  expect(ep.scenes[0].attachments.filter((a: { kind: string }) => a.kind === 'image')).toHaveLength(1);
  expect(ep.scenes[0].storyboard ?? null).toBeNull();
  expect(await probe()).toBe(200);
});

test('a drawing edited moments before: no false claim of a local copy; discard deletes it only after a confirmed sign-out', async ({ page, playwright }) => {
  const { id } = await start(page, 'Sign-out drawing draft');
  const probe = await sessionProbe(page, playwright);
  await page.getByRole('button', { name: '✎ Draw / Storyboard' }).click();
  const box = (await page.locator('.sb-canvas').boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 3 });
  await page.mouse.up();
  // Within the 300 ms before the browser copy is written.
  await signOutBehindEditor(page);
  const blocked = dialog(page, 'Not everything is saved');
  await expect(blocked).toContainText('The drawing for');
  await expect(blocked).not.toContainText('kept in this browser');
  await blocked.getByRole('button', { name: 'Stay' }).click();
  await expect.poll(() => draftKeys(page)).toHaveLength(1);

  await signOutBehindEditor(page);
  await expect(blocked).toContainText('a copy is kept in this browser');
  let fail = true;
  await page.route('**/api/auth/logout', (route) => (fail ? route.abort('internetdisconnected') : route.continue()));
  await blocked.getByRole('button', { name: 'Sign out without saving…' }).click();
  const confirm = dialog(page, 'Sign out without saving?');
  await expect(confirm).toContainText('deleted too');
  await confirm.getByRole('button', { name: 'Discard and sign out' }).click();
  const unconfirmed = dialog(page, 'Could not confirm sign-out');
  await expect(unconfirmed).toContainText('have not been discarded');
  // A failed sign-out deletes nothing.
  expect(await draftKeys(page)).toHaveLength(1);
  await expect(page.locator('.sb-foot')).toContainText('1 object');
  fail = false;
  await unconfirmed.getByRole('button', { name: 'Try again' }).click();
  await expectSignedOut(page);
  expect(await draftKeys(page)).toHaveLength(0);
  expect(await probe()).toBe(401);
  // Nothing was saved to the server.
  await login(page);
  expect((await episode(page, id)).scenes[0].storyboard ?? null).toBeNull();
});

test('typed but unsubmitted input blocks sign-out; a closed skip-reason box does not', async ({ page, playwright }) => {
  const { original } = await start(page, 'Sign-out forms');
  const probe = await sessionProbe(page, playwright);
  const newShot = page.getByLabel('New shot description').first();
  await newShot.fill('A shot I have not added yet');
  await clickSignOut(page);
  const blocked = dialog(page, 'Not everything is saved');
  await expect(blocked).toContainText('A new shot typed');
  await expect(blocked.getByRole('button', { name: 'Retry saving' })).toHaveCount(0);
  await blocked.getByRole('button', { name: 'Stay' }).click();
  await expect(newShot).toHaveValue('A shot I have not added yet');
  await newShot.fill('');

  // Skip a shot, type a reason, then mark it filmed: the hidden box is not an unsaved draft.
  const shot = original.scenes[0].shots[0].description as string;
  const pattern = new RegExp(shot.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  await outcome(page, pattern, 'Skipped').first().click();
  await page.getByLabel('Other reason').first().fill('Too windy');
  await outcome(page, pattern, 'Filmed').first().click();
  await waitSaved(page);
  await clickSignOut(page);
  await expectSignedOut(page);
  expect(await probe()).toBe(401);
});
