// Guarded navigation on a phone: leaving from the More sheet asks, fits the screen, and Stay keeps the edit.
import { expect, test } from '@playwright/test';
import { apiAsAgent, createEpisode, login, waitSaved } from './helpers';

test('phone: leaving with an edit that cannot be saved asks; Stay keeps it; Leave without saving goes to the list', async ({ page }) => {
  await login(page);
  const id = await createEpisode(page, 'Phone nav guard');
  await waitSaved(page);
  await page.route('**/api/episodes/*/changes', (route) => route.fulfill({ status: 503, body: 'Service Unavailable' }));
  await page.getByLabel('Episode title').fill('Unsaved on the phone');
  await expect(page.locator('.save-status').first()).toContainText('Not saved', { timeout: 10_000 });
  const more = page.getByRole('dialog', { name: 'More' });
  const toList = async () => {
    // After Stay the sheet is still open (nothing moved).
    if (!(await more.isVisible())) await page.getByRole('button', { name: 'More' }).tap();
    await more.getByRole('link', { name: 'All episodes' }).tap();
  };
  await toList();
  const leave = page.getByRole('dialog', { name: 'Leave this page?' });
  await expect(leave).toContainText('until the connection returns');
  const box = (await leave.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await leave.getByRole('button', { name: 'Stay' }).tap();
  await expect(page.getByLabel('Episode title')).toHaveValue('Unsaved on the phone');
  expect(page.url()).toContain(`#/e/${id}`);

  await toList();
  await leave.getByRole('button', { name: 'Leave without saving…' }).tap();
  await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Discard and leave' }).tap();
  await expect(page.getByRole('heading', { name: 'Episodes', level: 1 })).toBeVisible();
  expect((await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.title).toBe('Phone nav guard');
});

test('phone: closing the scene sheet with a typed shot asks; Stay keeps it; discard drops only it, edits stay saved', async ({ page }) => {
  await login(page);
  const id = await createEpisode(page, 'Phone sheet guard');
  await waitSaved(page);
  await page.locator('.cards .card-main').first().tap();
  const sheet = page.getByRole('dialog', { name: /^Scene:/ });
  await sheet.getByLabel('What happens').fill('Edited in the sheet');
  await sheet.getByLabel('New shot description').fill('Typed in the sheet');
  await sheet.getByRole('button', { name: '← Scenes' }).tap();
  const sceneLeave = page.getByRole('dialog', { name: 'Leave this scene?' });
  await expect(sceneLeave).toContainText('A new shot typed');
  await sceneLeave.getByRole('button', { name: 'Stay' }).tap();
  await expect(sheet.getByLabel('New shot description')).toHaveValue('Typed in the sheet');
  await sheet.getByRole('button', { name: '← Scenes' }).tap();
  await sceneLeave.getByRole('button', { name: 'Leave without saving…' }).tap();
  await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Discard and leave' }).tap();
  await expect(sheet).toHaveCount(0);
  await page.locator('.cards .card-main').first().tap();
  await expect(sheet.getByLabel('New shot description')).toHaveValue('');
  await waitSaved(page);
  const ep = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
  expect(ep.scenes[0].description).toBe('Edited in the sheet');
  expect(ep.scenes[0].shots.some((s: { description: string }) => s.description === 'Typed in the sheet')).toBe(false);
});

test('phone: deleting the scene from its sheet with a typed shot asks; Stay keeps scene and text', async ({ page }) => {
  await login(page);
  const id = await createEpisode(page, 'Phone sheet delete');
  await waitSaved(page);
  const before = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.scenes.length;
  await page.locator('.cards .card-main').first().tap();
  const sheet = page.getByRole('dialog', { name: /^Scene:/ });
  await sheet.getByLabel('New shot description').fill('Typed before delete');
  await sheet.getByRole('button', { name: 'Delete scene' }).tap();
  await page.getByRole('dialog', { name: 'Delete scene?' }).getByRole('button', { name: 'Delete scene' }).tap();
  const sceneLeave = page.getByRole('dialog', { name: 'Leave this scene?' });
  await expect(sceneLeave).toContainText('A new shot typed');
  await sceneLeave.getByRole('button', { name: 'Stay' }).tap();
  await page.waitForTimeout(800);
  expect((await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.scenes.length).toBe(before);
  await expect(sheet.getByLabel('New shot description')).toHaveValue('Typed before delete');
});
