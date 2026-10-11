import { devices, expect, test } from '@playwright/test';
import { apiAsAgent, createEpisode, login, samplePngFile, waitSaved } from './helpers';

const blocks = (page: import('@playwright/test').Page) => page.locator('.timeline-track .block');
const titles = async (page: import('@playwright/test').Page) => (await page.locator('.timeline-track .block .block-title').allTextContents()).map((t) => t.trim());

test('timeline editing, reorder, resize and synchronised cards (acceptance 1–3, 13)', async ({ page, browser }) => {
  await login(page);
  const id = await createEpisode(page, 'Desktop timeline test');
  await expect(page.locator('.runtime strong')).toHaveText('02:45');

  // Change packing from 45 to 60 seconds via the field: total 03:00 and later scenes shift by 15 s.
  const seconds = page.getByLabel('Seconds');
  await seconds.fill('60');
  await seconds.blur();
  await expect(page.locator('.runtime strong')).toHaveText('03:00');
  await blocks(page).nth(1).click();
  await expect(page.locator('.scene-meta')).toContainText('01:00–01:30');
  await waitSaved(page);

  // Tick a captured shot in "Loading the trailer", then drag that block to the end of the timeline.
  await page.getByLabel(/Captured: Straps tightening/).check();
  await waitSaved(page);
  const loadingId = (await page.locator('.scene-meta code').textContent())!;
  await page.locator('.timeline-track').scrollIntoViewIfNeeded();
  const from = (await blocks(page).nth(1).boundingBox())!;
  const end = (await page.locator('.timeline-track').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 40, from.y + 40, { steps: 4 });
  await page.mouse.move(end.x + end.width - 5, from.y + from.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => titles(page)).toEqual(['Packing for the ride', 'The road to the mountains', 'Fuel and coffee stop', 'Loading the trailer']);
  await waitSaved(page);

  // Resize "The road…" by dragging its right edge to the left (shorter).
  const road = (await blocks(page).nth(1).boundingBox())!;
  const handle = blocks(page).nth(1).locator('.block-handle');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - road.width / 3, hb.y + hb.height / 2, { steps: 8 });
  await page.mouse.up();
  await waitSaved(page);
  const roadDuration = Number(await page.getByLabel('Seconds').inputValue());
  expect(roadDuration).toBeLessThan(60);
  expect(roadDuration).toBeGreaterThan(20);

  // Keyboard controls do the same: select and lengthen by 5 s with Shift+].
  await blocks(page).nth(1).focus();
  await page.keyboard.press('Shift+BracketRight');
  await expect(page.getByLabel('Seconds')).toHaveValue(String(roadDuration + 5));

  // Cards view shows the same order and the captured count travelled with the scene.
  await page.getByRole('radio', { name: 'Cards' }).click();
  const cardTitles = await page.locator('.cards .card-title').allTextContents();
  expect(cardTitles).toEqual(['Packing for the ride', 'The road to the mountains', 'Fuel and coffee stop', 'Loading the trailer']);
  await expect(page.locator('.cards .card').nth(3)).toContainText('1/3 captured');
  // Reorder in Cards with a button; the timeline follows.
  await page.getByRole('button', { name: 'Move Loading the trailer earlier' }).click();
  await page.getByRole('radio', { name: 'Timeline' }).click();
  await expect.poll(() => titles(page)).toEqual(['Packing for the ride', 'The road to the mountains', 'Loading the trailer', 'Fuel and coffee stop']);
  await blocks(page).nth(2).click();
  await expect(page.locator('.scene-meta code')).toHaveText(loadingId);
  await expect(page.getByLabel(/Captured: Straps tightening/)).toBeChecked();
  await expect(page.locator('.status-row [aria-checked="true"]')).toHaveText('Draft'); // capture never changes planning status
  await waitSaved(page);

  // Another browser (separate session) sees the same saved plan.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await login(page2);
  await page2.goto(`/#/e/${id}`);
  await expect.poll(() => titles(page2)).toEqual(['Packing for the ride', 'The road to the mountains', 'Loading the trailer', 'Fuel and coffee stop']);
  await ctx2.close();
});

test('optional fields stay unobtrusive; outline starter never overwrites; delete is undoable', async ({ page }) => {
  await login(page);
  await createEpisode(page, 'Manual plan', false);
  await page.getByRole('button', { name: '+ Scene' }).first().click();
  await expect(page.getByLabel('Scene title')).toHaveValue('New scene');
  // Only title/duration are present as fields; the rest are "+ …" disclosures.
  for (const label of ['+ Location / route', '+ Notes / edit intent', '+ References', '+ Voice-over', '+ Audio / music']) {
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }
  await page.getByLabel('Scene title').fill('Arrival');
  await waitSaved(page);

  if (await page.getByRole('button', { name: '+ Brief, outline & notes' }).isVisible()) await page.getByRole('button', { name: '+ Brief, outline & notes' }).click();
  await page.getByRole('button', { name: '+ Story outline' }).click();
  await page.getByRole('button', { name: /Insert starter/ }).click();
  await expect(page.getByLabel('Story outline')).toHaveValue(/Setup:\nDesire:\nConflict:\nChange:\nResult:/);
  await page.getByLabel('Story outline').fill('Setup: we leave at dawn\nResult: unknown until the trip');
  await expect(page.getByRole('button', { name: /Insert starter/ })).toHaveCount(0); // cannot overwrite existing text
  await waitSaved(page);

  // Add seven more scenes: the outline does not constrain scene count.
  for (let i = 0; i < 6; i++) await page.locator('.sequence-foot').getByRole('button', { name: '+ Scene' }).click();
  await expect(page.locator('.timeline-track .block')).toHaveCount(7);
  await waitSaved(page);

  await page.getByRole('button', { name: 'Delete scene' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete scene' }).click();
  await expect(page.locator('.timeline-track .block')).toHaveCount(6);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.timeline-track .block')).toHaveCount(7);
  await waitSaved(page);
});

test('agent write appears live; stale agent write rejected; undo through History (acceptance 5–7)', async ({ page }) => {
  await login(page);
  const id = await createEpisode(page, 'Agent sync');
  const read = await apiAsAgent(page, 'GET', `/api/episodes/${id}`);
  const ep = read.body.episode;
  const loading = ep.scenes[1];

  // Agent adds a shot; it appears in the open browser without a reload.
  const add = await apiAsAgent(page, 'POST', `/api/episodes/${id}/changes`, {
    baseRevision: ep.revision,
    summary: 'Agent: add reaction shot',
    operations: [{ op: 'addShot', sceneId: loading.id, shot: { description: 'Reaction as the bike clears the ramp', framing: 'Close-up' } }],
  });
  expect(add.status).toBe(200);
  await page.locator('.timeline-track .block').nth(1).click();
  await expect(page.getByLabel('Shot description', { exact: true }).last()).toHaveValue('Reaction as the bike clears the ramp');

  // Human edit after the agent's read → agent write against the old revision is rejected.
  await page.getByLabel('Scene title').fill('Loading up');
  await waitSaved(page);
  const stale = await apiAsAgent(page, 'POST', `/api/episodes/${id}/changes`, {
    baseRevision: add.body.episode.revision,
    operations: [{ op: 'updateScene', sceneId: loading.id, fields: { title: 'Agent title' } }],
  });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('stale_revision');
  await expect(page.getByLabel('Scene title')).toHaveValue('Loading up');

  // Undo the agent revision from History: it would also revert the later human edit, so it asks first.
  await page.getByRole('button', { name: 'History' }).click();
  const agentRow = page.locator('.history li', { hasText: 'Agent: add reaction shot' });
  await agentRow.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Later changes will also be reverted')).toBeVisible();
  await expect(page.locator('.reverted li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Revert all of these' }).click();
  await expect(page.getByText('Later changes will also be reverted')).toBeHidden();
  await expect(page.locator('.history li').first()).toContainText('Restored revision');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByLabel('Shot description', { exact: true })).toHaveCount(3);
  await expect(page.getByLabel('Scene title')).toHaveValue('Loading the trailer');
});

test('concurrent edit to a different field rebases; same field asks', async ({ page }) => {
  await login(page);
  const id = await createEpisode(page, 'Rebase test');
  await waitSaved(page);
  const ep = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
  // Agent changes purpose of scene 1 while the human is typing in the description.
  await page.getByLabel('What happens').fill('Human description');
  const r = await apiAsAgent(page, 'POST', `/api/episodes/${id}/changes`, {
    baseRevision: ep.revision,
    operations: [{ op: 'updateScene', sceneId: ep.scenes[0].id, fields: { purpose: 'Agent purpose' } }],
  });
  expect(r.status).toBe(200);
  await waitSaved(page);
  const after = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
  expect(after.scenes[0].description).toBe('Human description');
  expect(after.scenes[0].purpose).toBe('Agent purpose');

  // Now both change the same field: the human gets an explicit choice.
  await page.getByLabel('What happens').fill('Human v2');
  await apiAsAgent(page, 'POST', `/api/episodes/${id}/changes`, {
    baseRevision: after.revision,
    operations: [{ op: 'updateScene', sceneId: ep.scenes[0].id, fields: { description: 'Agent v2' } }],
  });
  await expect(page.getByText('Changed elsewhere while you were editing.')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await waitSaved(page);
  expect((await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.scenes[0].description).toBe('Human v2');
});

test('references and storyboard: draw, save, reopen, alter, cancel (acceptance 14)', async ({ page, browser }) => {
  await login(page);
  const id = await createEpisode(page, 'Sketch test');
  await page.locator('.timeline-track .block').nth(1).click();

  // Blank-canvas sketch with freehand, arrow, rectangle and text.
  await page.getByRole('button', { name: '✎ Draw / Storyboard' }).click();
  const canvas = page.locator('.sb-canvas');
  const box = (await canvas.boundingBox())!;
  const P = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  const stroke = async (pts: (readonly [number, number])[]) => {
    await page.mouse.move(...pts[0]);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 4 });
    await page.mouse.up();
  };
  await stroke([P(0.1, 0.2), P(0.2, 0.3), P(0.3, 0.25)]);
  await page.getByRole('button', { name: 'Arrow' }).click();
  await stroke([P(0.2, 0.7), P(0.6, 0.5)]);
  await page.getByRole('button', { name: 'Rectangle' }).click();
  await stroke([P(0.65, 0.3), P(0.85, 0.6)]);
  await page.getByRole('button', { name: 'Text' }).click();
  await page.mouse.click(...P(0.15, 0.8));
  await page.locator('#sb-text').fill('Costis enters here');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.fill('#sb-desc', 'Rider arrow towards the trailer');
  await expect(page.locator('.sb-foot')).toContainText('4 objects');
  await page.locator('.sb-head').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.sb-overlay')).toHaveCount(0);
  const preview = page.locator('.storyboard-preview img');
  await expect(preview).toBeVisible();
  const firstSrc = await preview.getAttribute('src');

  // Saved document: editable objects + matching preview revision.
  let ep = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
  let sb = ep.scenes[1].storyboard;
  expect(sb.objects.map((o: { type: string }) => o.type)).toEqual(['freehand', 'arrow', 'rect', 'text']);
  expect(sb.objects[3].text).toBe('Costis enters here');
  expect(sb.savedRevision).toBe(ep.revision);

  // Reopen, alter text (still editable), then Cancel → saved drawing unchanged.
  await page.getByRole('button', { name: '✎ Edit drawing' }).click();
  await page.getByRole('button', { name: 'Select / move' }).click();
  await page.mouse.click(...P(0.17, 0.83));
  await page.mouse.click(...P(0.17, 0.83));
  await page.locator('#sb-text').fill('Changed but cancelled');
  await page.getByRole('button', { name: '← Cancel' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  expect((await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.scenes[1].storyboard).toEqual(sb);

  // Reopen, add an ellipse over an uploaded background image, save.
  await page.getByRole('button', { name: '✎ Edit drawing' }).click();
  const file = await samplePngFile();
  await page.locator('.sb-toolbar input[type=file]').setInputFiles(file);
  await expect(page.locator('#sb-bg')).not.toHaveValue('', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Ellipse' }).click();
  await stroke([P(0.4, 0.1), P(0.55, 0.3)]);
  await page.locator('.sb-head').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.sb-overlay')).toHaveCount(0);
  await expect(preview).not.toHaveAttribute('src', firstSrc!);
  ep = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
  sb = ep.scenes[1].storyboard;
  expect(sb.backgroundAttachmentId).toBe(ep.scenes[1].attachments[0].id);
  expect(sb.objects).toHaveLength(5);

  // Text-only edit keeps the artwork.
  await page.getByLabel('What happens').fill('Bikes go up the ramp.');
  await waitSaved(page);
  expect((await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode.scenes[1].storyboard).toEqual(sb);

  // Another device (phone-sized, separate session) sees the same editable drawing and preview.
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const p2 = await phone.newPage();
  await login(p2);
  await p2.goto(`/#/e/${id}`);
  await p2.locator('.cards .card-main').nth(1).tap();
  await expect(p2.getByRole('dialog').locator('.storyboard-preview img')).toHaveAttribute('src', new RegExp(sb.previewAssetId));
  await p2.getByRole('dialog').getByRole('button', { name: '✎ Edit drawing' }).tap();
  await expect(p2.locator('.sb-foot')).toContainText('5 objects');
  await expect(p2.locator('.sb-canvas text')).toHaveText('Costis enters here');
  await phone.close();

  // Cards view uses the storyboard preview as thumbnail.
  await page.getByRole('radio', { name: 'Cards' }).click();
  await expect(page.locator('.cards .card').nth(1).locator('img')).toHaveAttribute('src', new RegExp(sb.previewAssetId));
  await page.getByRole('radio', { name: 'Timeline' }).click();
});

test('filming checklist and print view (acceptance 8)', async ({ page }) => {
  await login(page);
  await createEpisode(page, 'Checklist test');
  await page.getByLabel(/Captured: Both riders and bikes/).check();
  await waitSaved(page);
  await page.getByRole('link', { name: 'Filming checklist' }).click();
  await expect(page.getByRole('heading', { name: 'Checklist test' })).toBeVisible();
  await expect(page.locator('.checklist-scene')).toHaveCount(4);
  await expect(page.locator('.checklist-scene').first()).toContainText('Two riders pack their bags');
  await expect(page.locator('.checklist-scene').first()).toContainText('Essential');
  await expect(page.locator('.checklist-scene').first()).toContainText('Optional');
  await page.getByText('Group by location').click();
  await expect(page.locator('.group-title')).toHaveText(['📍 Home garage', '📍 On the road', '📍 Fuel station']);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.print-box').first()).toHaveText('☑');
  const pdf = await page.pdf({ format: 'A4' });
  expect(pdf.byteLength).toBeGreaterThan(10_000);
});

test('connection loss: edits and drawings are kept, never shown as saved, then sent', async ({ page, context }) => {
  await login(page);
  const id = await createEpisode(page, 'Offline test');
  await waitSaved(page);
  await context.setOffline(true);
  await page.getByLabel('What happens').fill('Typed while offline');
  await expect(page.locator('.save-status').first()).toContainText('Not saved', { timeout: 10_000 });
  await expect(page.getByRole('alert').first()).toContainText('kept on this page');

  // A drawing save fails without closing the editor or losing the strokes.
  await page.getByRole('button', { name: '✎ Draw / Storyboard' }).click();
  const box = (await page.locator('.sb-canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 200, { steps: 5 });
  await page.mouse.up();
  await page.locator('.sb-head').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.sb-editor .banner.error')).toContainText('Not saved');
  await expect(page.locator('.sb-foot')).toContainText('1 object');

  await context.setOffline(false);
  await page.locator('.sb-head').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.sb-overlay')).toHaveCount(0, { timeout: 15_000 });
  await waitSaved(page);
  const ep = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
  expect(ep.scenes[0].description).toBe('Typed while offline');
  expect(ep.scenes[0].storyboard.objects).toHaveLength(1);
});

test('production pack: cover, shot list with specs, storyboard, breakdown and guides', async ({ page }) => {
  await login(page);
  const id = await createEpisode(page, 'Printable plan');
  // Give one shot a size/angle/movement and plan a cut, through the editor.
  await page.locator('.shot-specs').first().getByLabel('Size').selectOption('ws');
  await page.locator('.shot-specs').first().getByLabel('Angle').selectOption('low');
  await page.locator('.shot-specs').first().getByLabel('Move').selectOption('track');
  await page.getByRole('button', { name: '+ Notes / edit intent' }).click();
  await page.getByLabel('Cut to the next scene').selectOption('jcut');
  await waitSaved(page);
  const ep = (await apiAsAgent(page, 'GET', `/api/episodes/${id}`)).body.episode;
  expect(ep.scenes[0].shots[0]).toMatchObject({ size: 'ws', angle: 'low', movement: 'track' });
  expect(ep.scenes[0].cutToNext).toBe('jcut');

  // A five-line outline appears on the pack cover, linked to scenes.
  await page.getByRole('button', { name: '+ Brief, outline & notes' }).click();
  await page.getByRole('button', { name: '+ Story outline' }).click();
  await page.getByLabel('Story outline').fill('Setup: two riders pack (S01–S02)\nDesire: reach the mountains\nConflict: a long road (S03)\nChange: coffee stop (S04)\nResult: open');
  await waitSaved(page);
  // Kit list: add two items, assign the camera to the first shot.
  await page.getByRole('button', { name: '+ Kit list' }).click();
  await page.getByLabel('New gear name').fill('Action camera');
  await page.getByRole('button', { name: '+ Gear' }).click();
  await page.getByLabel('New gear name').fill('Wireless mic');
  await page.getByLabel('New gear kind').selectOption('audio');
  await page.getByRole('button', { name: '+ Gear' }).click();
  await expect(page.locator('.kit-item')).toHaveCount(2);
  await page.locator('.shot-gear').first().getByLabel('Add gear to shot').selectOption({ label: 'Action camera (Camera)' });
  await expect(page.locator('.shot-gear').first().locator('.gear-chip')).toHaveText(['Action camera ✕']);
  await waitSaved(page);
  await page.getByRole('link', { name: 'Plan document' }).click();
  await expect(page.locator('.pk-cover h1')).toHaveText('Printable plan');
  await expect(page.locator('.pk-kit-table tr')).toHaveCount(2);
  await expect(page.locator('.pk-kit-table').first()).toContainText('Used in 1A');
  await expect(page.locator('.pk-shots tbody tr').first()).toContainText('Action camera');
  await expect(page.locator('.pk-five li')).toHaveCount(5);
  await expect(page.locator('.pk-five li').first()).toContainText('two riders pack');
  await expect(page.locator('.pk-five li').first().locator('.pk-scene-chip')).toHaveText(['S01', 'S02']);
  await expect(page.locator('.pk-facts')).toContainText('02:45');
  await expect(page.locator('.pk-runbar-seg')).toHaveCount(4);
  await expect(page.locator('.pk-scene-block')).toHaveCount(4);
  const first = page.locator('.pk-shots tbody tr').first();
  await expect(first).toContainText('1A');
  await expect(first).toContainText('WS');
  await expect(first).toContainText('LOW');
  await expect(first).toContainText('TRACK');
  await expect(first.locator('svg.shot-icon')).toHaveCount(1);
  await expect(page.locator('.pk-frame')).toHaveCount(4);
  await expect(page.locator('.pk-frame').first()).toContainText('J-cut');
  await expect(page.locator('.pk-breakdown')).toHaveCount(4);
  await expect(page.locator('.pk-size-card.used')).toHaveCount(1);
  await expect(page.locator('.pk-cuts tr.used')).toContainText('S01→S02');

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.pk-options')).toBeHidden();
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  // Cover, shot list, storyboard, breakdown and guide each start a page.
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBeGreaterThanOrEqual(5);
});
