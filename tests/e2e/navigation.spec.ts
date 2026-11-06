// Guarded navigation (stage 4): leaving a page never silently drops work. Checked against server data,
// the address bar and the page actually shown.
import { expect, test, type Page } from '@playwright/test';
import { apiAsAgent, CREATOR, createEpisode, login, waitSaved } from './helpers';

const episode = async (page: Page, id: string) => (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
const rail = (page: Page, name: string) => page.locator('.rail').getByRole('link', { name, exact: true });
const leave = (page: Page) => page.getByRole('dialog', { name: 'Leave this page?' });
const confirmLeave = (page: Page) => page.getByRole('dialog', { name: 'Leave without saving?' });
const onList = (page: Page) => expect(page.getByRole('heading', { name: 'Episodes', level: 1 })).toBeVisible();
const onPlan = async (page: Page, id: string) => {
  await expect(page.getByLabel('What happens')).toBeVisible();
  expect(page.url()).toContain(`#/e/${id}/plan`);
};
async function start(page: Page, title: string) {
  await login(page);
  const id = await createEpisode(page, title);
  await waitSaved(page);
  // History: … → episode list → this episode's plan, so Back leaves the episode.
  await rail(page, 'All episodes').click();
  await onList(page);
  await page.goto(`/#/e/${id}/plan`);
  await expect(page.getByLabel('What happens')).toBeVisible();
  return { id, original: await episode(page, id) };
}
function countChanges(page: Page) {
  const sent: string[] = [];
  page.on('request', (r) => r.url().includes('/changes') && sent.push(r.postData() ?? ''));
  return sent;
}

test('an edit typed just before leaving is saved first, then the move happens without asking', async ({ page }) => {
  const { id } = await start(page, 'Nav save first');
  await page.getByLabel('What happens').fill('Saved before leaving');
  await rail(page, 'All episodes').click();
  await onList(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Saved before leaving');
});

test('a save in flight and an edit queued behind it are both saved before Back leaves', async ({ page }) => {
  const { id } = await start(page, 'Nav in flight');
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let n = 0;
  await page.route('**/api/episodes/*/changes', async (route) => {
    if (n++ === 0) await held;
    await route.continue();
  });
  await page.getByLabel('What happens').fill('First');
  await page.getByLabel('What happens').blur();
  await expect.poll(() => n).toBe(1);
  await page.getByLabel('Episode title').fill('Second');
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Saving before you leave' })).toBeVisible();
  // The page being left is still shown, and the address points at it while deciding.
  await expect(page.getByLabel('Episode title')).toHaveValue('Second');
  release();
  await expect(page.getByLabel('What happens')).toHaveCount(0);
  const ep = await episode(page, id);
  expect([ep.scenes[0].description, ep.title]).toEqual(['First', 'Second']);
});

test('offline: Stay keeps the page, the address and the history; Retry saving saves and leaves', async ({ page, context }) => {
  const { id } = await start(page, 'Nav offline');
  const historyLength = await page.evaluate(() => history.length);
  await context.setOffline(true);
  await page.getByLabel('What happens').fill('Typed offline');
  await expect(page.locator('.save-status').first()).toContainText('Not saved', { timeout: 10_000 });
  await rail(page, 'All episodes').click();
  await expect(leave(page)).toContainText('until the connection returns');
  await expect(leave(page)).toContainText('You have not left yet');
  await leave(page).getByRole('button', { name: 'Stay' }).click();
  await onPlan(page, id);
  await expect(page.getByLabel('What happens')).toHaveValue('Typed offline');
  expect(await page.evaluate(() => history.length)).toBe(historyLength);

  // Back: same question; Stay restores the address without adding history.
  await page.goBack();
  await expect(leave(page)).toBeVisible();
  await leave(page).getByRole('button', { name: 'Stay' }).click();
  await onPlan(page, id);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);

  await rail(page, 'All episodes').click();
  await expect(leave(page)).toBeVisible();
  await context.setOffline(false);
  await leave(page).getByRole('button', { name: 'Retry saving' }).click();
  await onList(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Typed offline');
});

test('a server error (500) blocks leaving until Retry saving succeeds', async ({ page }) => {
  const { id } = await start(page, 'Nav 500');
  let fail = true;
  await page.route('**/api/episodes/*/changes', (route) =>
    fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Database is busy.' }) }) : route.continue(),
  );
  await page.getByLabel('What happens').fill('After a server error');
  await page.getByLabel('What happens').blur();
  await expect(page.getByRole('alert').first()).toContainText('press Retry');
  await rail(page, 'Filming checklist').click();
  await expect(leave(page)).toContainText('after a server error');
  fail = false;
  await leave(page).getByRole('button', { name: 'Retry saving' }).click();
  await expect(leave(page)).toHaveCount(0);
  await expect.poll(() => page.url()).toContain(`#/e/${id}/checklist`);
  await expect(page.getByLabel('What happens')).toHaveCount(0);
  expect((await episode(page, id)).scenes[0].description).toBe('After a server error');
});

test('503: Leave without saving discards only after confirming; nothing is sent afterwards; revisiting shows the saved version', async ({ page }) => {
  const { id, original } = await start(page, 'Nav 503 discard');
  let attempts = 0;
  await page.route('**/api/episodes/*/changes', (route) => {
    attempts++;
    return route.fulfill({ status: 503, body: 'Service Unavailable' });
  });
  await page.getByLabel('What happens').fill('Never saved');
  await page.getByLabel('What happens').blur();
  await expect.poll(() => attempts).toBeGreaterThan(0);
  await rail(page, 'All episodes').click();
  await leave(page).getByRole('button', { name: 'Leave without saving…' }).click();
  await expect(confirmLeave(page)).toContainText('cannot be recovered');
  await confirmLeave(page).getByRole('button', { name: 'Back' }).click();
  await expect(leave(page)).toBeVisible();
  await leave(page).getByRole('button', { name: 'Leave without saving…' }).click();
  await confirmLeave(page).getByRole('button', { name: 'Discard and leave' }).click();
  await onList(page);
  const after = attempts;
  await page.waitForTimeout(5000);
  expect(attempts).toBe(after); // no orphan retry
  await page.unroute('**/api/episodes/*/changes');
  await page.getByRole('link', { name: /Nav 503 discard/ }).click();
  await expect(page.getByLabel('Episode title')).toHaveValue('Nav 503 discard');
  await page.goto(`/#/e/${id}/plan`);
  await expect(page.getByLabel('What happens')).toHaveValue(original.scenes[0].description);
  expect((await episode(page, id)).scenes[0].description).toBe(original.scenes[0].description);
});

test('an unresolved conflict and a refused edit block leaving', async ({ page }) => {
  const { id, original } = await start(page, 'Nav conflict');
  await page.getByLabel('What happens').fill('Human version');
  await apiAsAgent(page, 'POST', `/api/episodes/${id}/changes`, {
    baseRevision: original.revision,
    operations: [{ op: 'updateScene', sceneId: original.scenes[0].id, fields: { description: 'Agent version' } }],
  });
  await expect(page.getByText('Changed elsewhere while you were editing.')).toBeVisible({ timeout: 10_000 });
  await rail(page, 'All episodes').click();
  await expect(leave(page)).toContainText('Keep mine / Use newer');
  await leave(page).getByRole('button', { name: 'Stay' }).click();
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await waitSaved(page);

  let refuse = true;
  await page.route('**/api/episodes/*/changes', (route) =>
    refuse ? ((refuse = false), route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'That text is too long.' }) })) : route.continue(),
  );
  await page.getByLabel('What happens').fill('Refused');
  await page.getByLabel('What happens').blur();
  await expect(page.getByRole('alert').first()).toContainText('That text is too long.');
  await rail(page, 'All episodes').click();
  await expect(leave(page)).toContainText('That text is too long.');
  await leave(page).getByRole('button', { name: 'Leave without saving…' }).click();
  await confirmLeave(page).getByRole('button', { name: 'Discard and leave' }).click();
  await onList(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Human version');
});

test('rapid Back presses and a scripted address change ask once; Stay keeps the page; then leaving works', async ({ page, context }) => {
  const { id } = await start(page, 'Nav rapid back');
  await context.setOffline(true);
  await page.getByLabel('What happens').fill('Kept through rapid Back');
  await expect(page.locator('.save-status').first()).toContainText('Not saved', { timeout: 10_000 });
  // Several history steps at once: the episode tab step is instant, leaving the episode asks once.
  await page.evaluate(() => {
    history.back();
    history.back();
    history.back();
  });
  await expect(leave(page)).toBeVisible();
  await page.evaluate(() => {
    history.back();
    history.forward();
  });
  await page.waitForTimeout(500);
  await expect(leave(page)).toHaveCount(1);
  await leave(page).getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByLabel('Episode title')).toHaveValue('Nav rapid back');
  expect(page.url()).toContain(`#/e/${id}`);

  // An address changed by script (or typed): the same question; Stay puts it back.
  await page.evaluate(() => (location.hash = '#/settings'));
  await expect(leave(page)).toBeVisible();
  await leave(page).getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByLabel('Episode title')).toHaveValue('Nav rapid back');
  await expect.poll(() => page.url()).toContain(`#/e/${id}`);

  await context.setOffline(false);
  await rail(page, 'Plan').click();
  await waitSaved(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Kept through rapid Back');
  await rail(page, 'All episodes').click();
  await onList(page);
});

test('Back while signing in again or while sign-out asks: nothing moves, the page and the pause stay', async ({ page, playwright }) => {
  const { id } = await start(page, 'Nav while paused');
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const ctx = await playwright.request.newContext({ baseURL: new URL(page.url()).origin, extraHTTPHeaders: { cookie, 'x-planb-csrf': '1' } });
  await ctx.post('/api/auth/logout');
  await ctx.dispose();
  await page.getByLabel('What happens').fill('Kept while paused');
  await page.getByLabel('What happens').blur();
  const reauth = page.getByRole('dialog', { name: 'Sign in again to keep working' });
  await expect(reauth).toBeVisible();
  await page.goBack();
  await page.goBack();
  await page.waitForTimeout(500);
  await expect(reauth).toBeVisible();
  expect(page.url()).toContain(`#/e/${id}/plan`);
  await expect(page.getByLabel('What happens')).toHaveValue('Kept while paused');
  await reauth.getByLabel('Password').fill(CREATOR.password);
  await reauth.getByRole('button', { name: 'Sign in' }).click();
  await waitSaved(page);
  expect((await episode(page, id)).scenes[0].description).toBe('Kept while paused');

  // Sign-out asking about an unsaved edit: Back does nothing either.
  await page.route('**/api/episodes/*/changes', (route) => route.fulfill({ status: 503, body: 'Service Unavailable' }));
  await page.getByLabel('What happens').fill('Unsaved at sign-out');
  await page.getByLabel('What happens').blur();
  await page.locator('.rail .avatar').click();
  await page.locator('.rail-menu').getByRole('button', { name: 'Sign out', exact: true }).click();
  const blocked = page.getByRole('dialog', { name: 'Some changes are not confirmed as saved' });
  await expect(blocked).toBeVisible();
  await page.goBack();
  await page.waitForTimeout(500);
  await expect(blocked).toBeVisible();
  expect(page.url()).toContain(`#/e/${id}/plan`);
  await blocked.getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByLabel('What happens')).toHaveValue('Unsaved at sign-out');
});

test('switching tabs of the same episode: typed input asks, engine edits do not; Stay keeps the text', async ({ page }) => {
  const { id } = await start(page, 'Nav tabs');
  // An engine edit pending: the tab change is instant (the engine stays) and it is saved.
  await page.getByLabel('What happens').fill('Saved across tabs');
  await rail(page, 'Shots').click();
  await expect(page.getByLabel('What happens')).toHaveCount(0);
  await expect.poll(async () => (await episode(page, id)).scenes[0].description).toBe('Saved across tabs');

  await rail(page, 'Plan').click();
  await page.getByLabel('New shot description').first().fill('Not added yet');
  await rail(page, 'Shots').click();
  await expect(leave(page)).toContainText('A new shot typed');
  await expect(leave(page).getByRole('button', { name: 'Retry saving' })).toHaveCount(0);
  await leave(page).getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByLabel('New shot description').first()).toHaveValue('Not added yet');
  await rail(page, 'Shots').click();
  await leave(page).getByRole('button', { name: 'Leave without saving…' }).click();
  await confirmLeave(page).getByRole('button', { name: 'Discard and leave' }).click();
  expect(page.url()).toContain(`#/e/${id}/shots`);
  await expect(page.getByLabel('What happens')).toHaveCount(0);
});

test('revisiting an episode creates one writer: each edit is sent once and nothing old is retried', async ({ page }) => {
  const { id } = await start(page, 'Nav revisit');
  const sent = countChanges(page);
  await page.getByLabel('What happens').fill('Visit one');
  await rail(page, 'All episodes').click();
  await onList(page);
  await page.getByRole('link', { name: /Nav revisit/ }).click();
  await rail(page, 'Plan').click();
  await expect(page.getByLabel('What happens')).toHaveValue('Visit one');
  const before = sent.length;
  await page.getByLabel('What happens').fill('Visit two');
  await page.getByLabel('What happens').blur();
  await waitSaved(page);
  await page.waitForTimeout(1500);
  expect(sent.length - before).toBe(1);
  expect(sent.filter((s) => s.includes('Visit two'))).toHaveLength(1);
  expect((await episode(page, id)).scenes[0].description).toBe('Visit two');
});

test('a drawing being saved finishes before Back leaves the page', async ({ page }) => {
  const { id } = await start(page, 'Nav drawing save');
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
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Saving before you leave' })).toBeVisible();
  release();
  await expect(page.getByLabel('What happens')).toHaveCount(0, { timeout: 15_000 });
  expect((await episode(page, id)).scenes[0].storyboard.objects).toHaveLength(1);
});

test('leaving PlanB with typed input or a save in flight asks the browser to warn', async ({ page }) => {
  await start(page, 'Nav unload');
  await page.getByLabel('New shot description').first().fill('Unsaved input');
  const first = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true }).catch(() => undefined);
  const d = await first;
  expect(d.type()).toBe('beforeunload');
  await d.dismiss();
  await expect(page.getByLabel('New shot description').first()).toHaveValue('Unsaved input');
  await page.getByLabel('New shot description').first().fill('');

  await page.route('**/api/episodes/*/changes', () => new Promise(() => undefined)); // never answers
  await page.getByLabel('What happens').fill('In flight at unload');
  await page.getByLabel('What happens').blur();
  await expect(page.locator('.save-status').first()).toContainText('Saving');
  const second = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true }).catch(() => undefined);
  const d2 = await second;
  expect(d2.type()).toBe('beforeunload');
  await d2.dismiss();
});

test('a clean move stays instant and adds one history entry', async ({ page }) => {
  await start(page, 'Nav clean');
  const length = await page.evaluate(() => history.length);
  await rail(page, 'All episodes').click();
  await onList(page);
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
  await page.goBack();
  await expect(page.getByLabel('What happens')).toBeVisible();
  await page.goForward();
  await onList(page);
  await expect(leave(page)).toHaveCount(0);
});

