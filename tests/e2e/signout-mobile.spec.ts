// Coordinated sign-out on a phone: tab bar and More sheet, checked against server data and the old cookie.
import { expect, test, type Page, type PlaywrightWorkerArgs } from '@playwright/test';
import { apiAsAgent, createEpisode, login, waitSaved } from './helpers';

async function sessionProbe(page: Page, playwright: PlaywrightWorkerArgs['playwright']) {
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const origin = new URL(page.url()).origin;
  return async () => {
    const ctx = await playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { cookie } });
    const status = (await ctx.get('/api/auth/me')).status();
    await ctx.dispose();
    return status;
  };
}
/** Inside an episode the phone's Sign out is in the More sheet. */
async function signOutFromMore(page: Page) {
  await page.getByRole('button', { name: 'More' }).tap();
  const button = page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: 'Sign out' });
  await button.scrollIntoViewIfNeeded();
  await button.tap();
}
const expectSignedOut = (page: Page) => expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });

test('phone: an edit typed just before Sign out in the More sheet is saved first, then the session is revoked', async ({ page, playwright }) => {
  await login(page);
  const id = await createEpisode(page, 'Phone sign-out save');
  await waitSaved(page);
  const probe = await sessionProbe(page, playwright);
  await page.getByLabel('Episode title').fill('Renamed on the phone');
  await signOutFromMore(page);
  await expectSignedOut(page);
  expect((await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.title).toBe('Renamed on the phone');
  expect(await probe()).toBe(401);
});

test('phone: sign-out from the More sheet while saves fail (503) is blocked; Stay keeps the edit; discard signs out', async ({ page, playwright }) => {
  await login(page);
  const id = await createEpisode(page, 'Phone sign-out offline');
  await waitSaved(page);
  const probe = await sessionProbe(page, playwright);
  await page.route('**/api/episodes/*/changes', (route) => route.fulfill({ status: 503, body: 'Service Unavailable' }));
  await page.getByLabel('Episode title').fill('Typed offline on the phone');
  await expect(page.locator('.save-status').first()).toContainText('Not saved', { timeout: 10_000 });
  await signOutFromMore(page);
  const blocked = page.getByRole('dialog', { name: 'Not everything is saved' });
  await expect(blocked).toContainText('until the connection returns');
  const box = (await blocked.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await blocked.getByRole('button', { name: 'Stay' }).tap();
  await expect(page.getByLabel('Episode title')).toHaveValue('Typed offline on the phone');
  expect(await probe()).toBe(200);

  await signOutFromMore(page);
  await blocked.getByRole('button', { name: 'Sign out without saving…' }).tap();
  await page.getByRole('dialog', { name: 'Sign out without saving?' }).getByRole('button', { name: 'Discard and sign out' }).tap();
  await expectSignedOut(page);
  expect(await probe()).toBe(401);
  // Discarded only locally; whatever had not reached the server stays unsaved.
  expect((await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.title).toBe('Phone sign-out offline');
});
