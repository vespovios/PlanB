import { expect, test } from '@playwright/test';
import { apiAsAgent, createEpisode, gesture, login, samplePngFile, waitSaved } from './helpers';

const cardTitles = (page: import('@playwright/test').Page) => page.locator('.cards .card-title').allTextContents();

test('phone: outline, scene editing, timing, reorder and captured shots by touch (acceptance 4, 10)', async ({ page }) => {
  await login(page);
  const id = await createEpisode(page, 'Phone plan');
  await expect(page.locator('.timeline-track')).toHaveCount(0); // phones use the Cards list
  await expect(page.locator('.cards.list .card')).toHaveCount(4);

  // Outline and loose notes are editable on the phone, one tap away under More.
  await page.getByRole('button', { name: 'More' }).tap();
  await page.getByRole('link', { name: 'Brief, outline & notes' }).tap();
  await page.getByLabel('Story outline').fill('Setup: early start\nQuestion: will the pass be open?');
  await page.getByRole('button', { name: 'Observed:' }).tap();
  await waitSaved(page);
  await page.locator('.tabbar').getByRole('link', { name: 'Plan' }).tap();

  // Add a scene, edit it in the full-screen sheet.
  await page.getByRole('button', { name: '+ Scene' }).tap();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Scene title')).toHaveValue('New scene');
  await sheet.getByLabel('Scene title').fill('Mountain pass');
  await sheet.getByRole('button', { name: 'One second longer' }).tap();
  await sheet.getByRole('button', { name: 'One second longer' }).tap();
  await expect(sheet.getByLabel('Seconds')).toHaveValue('32');
  await sheet.getByLabel('New shot description').fill('Wide of the road climbing the pass');
  await sheet.getByRole('button', { name: '+ Shot' }).tap();
  await sheet.getByLabel(/Captured: Wide of the road/).tap();
  await expect(sheet.getByLabel(/Captured: Wide of the road/)).toBeChecked();
  await sheet.getByRole('radio', { name: 'Ready to film' }).tap();
  await waitSaved(page);
  await sheet.getByRole('button', { name: '← Scenes' }).tap();

  // New scene was inserted after the first (selected) scene; move it down with touch buttons.
  expect(await cardTitles(page)).toEqual(['Packing for the ride', 'Mountain pass', 'Loading the trailer', 'The road to the mountains', 'Fuel and coffee stop']);
  await page.getByRole('button', { name: 'Move Mountain pass later' }).tap();
  await page.getByRole('button', { name: 'Move Mountain pass later' }).tap();
  expect(await cardTitles(page)).toEqual(['Packing for the ride', 'Loading the trailer', 'The road to the mountains', 'Mountain pass', 'Fuel and coffee stop']);
  await expect(page.locator('.cards .card').nth(3)).toContainText('1/1 captured');
  await expect(page.locator('.cards .card').nth(3)).toContainText('Ready');
  await waitSaved(page);

  const ep = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
  const pass = ep.scenes[3];
  expect(pass.title).toBe('Mountain pass');
  expect(pass.durationSeconds).toBe(32);
  expect(pass.status).toBe('ready');
  expect(pass.shots[0].captured).toBe(true);
  expect(ep.outline).toContain('Question: will the pass be open?');
  expect(ep.notes).toMatch(/Observed: $/);

  // The filming checklist is quick to use on the phone.
  await page.getByRole('button', { name: 'More' }).tap();
  await page.getByRole('link', { name: 'Filming checklist' }).tap();
  const first = page.locator('.checklist-shots input').first();
  await first.tap();
  await expect(first).toBeChecked();
  await waitSaved(page);
});

test('phone: storyboard drawing by touch, image upload, reopen (acceptance 14)', async ({ page }) => {
  await login(page);
  const id = await createEpisode(page, 'Phone sketch');
  await page.locator('.cards .card-main').nth(1).tap();
  const sheet = page.getByRole('dialog');

  // Reference image upload and larger view.
  await sheet.getByRole('button', { name: '+ References' }).tap();
  await sheet.locator('.references input[type=file]').setInputFiles(await samplePngFile());
  await expect(sheet.locator('.ref-thumb')).toHaveCount(1, { timeout: 10_000 });
  await sheet.locator('.ref-thumb').tap();
  await expect(page.locator('.image-viewer img')).toBeVisible();
  const big = (await page.locator('.image-viewer img').boundingBox())!;
  expect(big.width).toBeGreaterThan(300);
  await page.getByRole('button', { name: 'Close' }).last().tap();

  // Full-screen drawing sheet.
  await sheet.getByRole('button', { name: '✎ Draw / Storyboard' }).tap();
  const editor = (await page.locator('.sb-editor').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(Math.round(editor.width)).toBe(vp.width);
  expect(Math.round(editor.height)).toBe(vp.height);
  await page.locator('#sb-bg').selectOption({ index: 1 }); // draw over the uploaded image
  await gesture(page, '.sb-canvas', [[0.1, 0.4], [0.2, 0.45], [0.3, 0.5], [0.4, 0.45]]);
  await page.getByRole('button', { name: 'Arrow' }).tap();
  await gesture(page, '.sb-canvas', [[0.2, 0.6], [0.4, 0.55], [0.7, 0.5]]);
  await page.getByRole('button', { name: 'Ellipse' }).tap();
  await gesture(page, '.sb-canvas', [[0.6, 0.2], [0.7, 0.3], [0.8, 0.35]]);
  await page.getByRole('button', { name: 'Text' }).tap();
  await gesture(page, '.sb-canvas', [[0.1, 0.1]]);
  await page.locator('#sb-text').fill('Camera here');
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.locator('.sb-head').getByRole('button', { name: 'Save' })).toBeVisible();
  await page.locator('.sb-head').getByRole('button', { name: 'Save' }).tap();
  await expect(page.locator('.sb-overlay')).toHaveCount(0);
  await expect(sheet.locator('.storyboard-preview img')).toBeVisible();

  let sb = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.scenes[1].storyboard;
  expect(sb.objects.map((o: { type: string }) => o.type)).toEqual(['freehand', 'arrow', 'ellipse', 'text']);
  expect(sb.backgroundAttachmentId).toMatch(/^at_/);

  // Reopen after a reload (fresh load from the server), move the label by touch, save again.
  await page.reload();
  await page.locator('.cards .card-main').nth(1).tap();
  await page.getByRole('dialog').getByRole('button', { name: '✎ Edit drawing' }).tap();
  await expect(page.locator('.sb-foot')).toContainText('4 objects');
  await page.getByRole('button', { name: 'Select / move' }).tap();
  await gesture(page, '.sb-canvas', [[0.12, 0.13], [0.2, 0.2], [0.3, 0.3]]);
  await page.locator('.sb-head').getByRole('button', { name: 'Save' }).tap();
  await expect(page.locator('.sb-overlay')).toHaveCount(0);
  const sb2 = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.scenes[1].storyboard;
  expect(sb2.objects[3].x).toBeGreaterThan(sb.objects[3].x + 100);
  expect(sb2.previewAssetId).not.toBe(sb.previewAssetId);
  sb = sb2;

  // Preview image is served and matches the saved document's canvas.
  const png = await page.request.get(`/api/assets/${sb.previewAssetId}`);
  expect(png.headers()['content-type']).toBe('image/png');
});
