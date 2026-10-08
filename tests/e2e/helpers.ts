import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const CREATOR = { email: 'creator@example.com', password: 'creator-password-1' };
export const SOMEONE = { email: 'someone@example.com', password: 'someone-password-1' };
export const agentToken = () => fs.readFileSync(path.join(os.tmpdir(), 'planb-e2e-token'), 'utf8');

export async function login(page: Page, who = CREATOR) {
  await page.goto('/');
  await page.fill('#email', who.email);
  await page.fill('#password', who.password);
  await page.click('button:has-text("Sign in")');
  await expect(page.getByRole('heading', { name: 'Episodes' })).toBeVisible();
}

export async function createEpisode(page: Page, title: string, example = true) {
  await page.getByRole('button', { name: '+ New episode' }).click();
  await page.fill('#new-title', title);
  if (example) await page.getByText('Start with the example opening sequence').click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByLabel('Episode title')).toHaveValue(title);
  return page.url().split('/e/')[1];
}

export async function waitSaved(page: Page) {
  await expect(page.locator('.save-status').first()).toHaveText(/Saved/, { timeout: 10_000 });
}

export async function apiAsAgent(page: Page, method: string, url: string, data?: unknown) {
  const res = await page.request.fetch(url, {
    method,
    headers: { authorization: `Bearer ${agentToken()}`, 'content-type': 'application/json' },
    data: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: res.status(), body: await res.json() };
}

/** Synthesises a pointer gesture (mouse or touch) on an element, in client coordinates. */
export async function gesture(page: Page, selector: string, points: [number, number][], pointerType: 'mouse' | 'touch' = 'touch') {
  await page.evaluate(
    ({ selector, points, pointerType }) => {
      const el = document.querySelector(selector)!;
      const r = el.getBoundingClientRect();
      const at = (i: number) => ({ clientX: r.left + points[i][0] * r.width, clientY: r.top + points[i][1] * r.height });
      const base = { bubbles: true, cancelable: true, pointerId: 7, pointerType, isPrimary: true, button: 0, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...base, ...at(0) }));
      for (let i = 1; i < points.length; i++) el.dispatchEvent(new PointerEvent('pointermove', { ...base, ...at(i) }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, ...at(points.length - 1) }));
    },
    { selector, points, pointerType },
  );
}

export async function samplePngFile(): Promise<string> {
  const sharp = (await import('sharp')).default;
  const file = path.join(os.tmpdir(), 'planb-e2e-ref.png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#7fb3d5"/><rect x="0" y="420" width="800" height="180" fill="#6b8e23"/><circle cx="650" cy="120" r="60" fill="#f4d03f"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}
