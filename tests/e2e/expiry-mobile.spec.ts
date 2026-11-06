// Session expiry on a phone: the overlay is usable and the edit survives.
import { expect, test } from '@playwright/test';
import { apiAsAgent, CREATOR, createEpisode, login, waitSaved } from './helpers';

test('phone: a session revoked elsewhere pauses the page; signing in again saves the edit', async ({ page, playwright }) => {
  await login(page);
  const id = await createEpisode(page, 'Phone expiry');
  await waitSaved(page);
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const ctx = await playwright.request.newContext({ baseURL: new URL(page.url()).origin, extraHTTPHeaders: { cookie, 'x-planb-csrf': '1' } });
  await ctx.post('/api/auth/logout');
  await ctx.dispose();
  await page.getByLabel('Episode title').fill('Renamed after expiry');
  await page.getByLabel('Episode title').blur();
  const dialog = page.getByRole('dialog', { name: 'Sign in again to keep working' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await dialog.getByLabel('Password').fill(CREATOR.password);
  await dialog.getByRole('button', { name: 'Sign in' }).tap();
  await expect(dialog).toHaveCount(0);
  await waitSaved(page);
  expect((await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.title).toBe('Renamed after expiry');
});
