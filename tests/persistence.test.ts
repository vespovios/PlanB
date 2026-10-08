// Restart persistence, backup/restore of database + assets together, and the portable export.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { asAgent, asUser, login, multipartBody, samplePng, startApp, PASSWORD } from './helpers.js';

const cli = (dataDir: string, ...args: string[]) =>
  execFileSync('npx', ['tsx', 'src/server/cli.ts', ...args], { env: { ...process.env, PLANB_DATA_DIR: dataDir }, encoding: 'utf8' });

async function seed(dataDir?: string) {
  const { app, dataDir: dir } = await startApp(dataDir);
  const user = await app.services.auth.createUser('keep@example.com', 'Keeper', PASSWORD);
  const token = app.services.auth.createAgentToken(user.id, 'Exporter').token;
  const cookie = await login(app, 'keep@example.com');
  let ep = (await app.inject({ method: 'POST', url: '/api/episodes', headers: asUser(cookie), payload: { title: 'Persist me', withExample: true } })).json().episode;
  const { payload, contentType } = multipartBody('ref.jpg', await samplePng(400, 300));
  const assetId = (await app.inject({ method: 'POST', url: `/api/episodes/${ep.id}/assets`, headers: { ...asUser(cookie), 'content-type': contentType }, payload })).json().asset.id;
  ep = (
    await app.inject({
      method: 'POST',
      url: `/api/episodes/${ep.id}/changes`,
      headers: asUser(cookie),
      payload: {
        baseRevision: ep.revision,
        operations: [
          { op: 'addImage', sceneId: ep.scenes[0].id, assetId, id: 'at_bgimage0001', label: 'Garage' },
          { op: 'addLink', sceneId: ep.scenes[0].id, label: 'Packing list', url: 'https://example.com/list' },
          {
            op: 'saveStoryboard',
            sceneId: ep.scenes[0].id,
            storyboard: { backgroundAttachmentId: 'at_bgimage0001', objects: [{ id: 't', type: 'text', x: 50, y: 50, text: 'Bags here', color: '#111827', size: 40 }] },
          },
          { op: 'updateEpisode', fields: { outline: 'Setup: early start' } },
        ],
      },
    })
  ).json().episode;
  return { app, dataDir: dir, cookie, token, ep };
}

describe('persistence', () => {
  it('saved data survives a restart', async () => {
    const { app, dataDir, ep } = await seed();
    await app.close();
    const { app: again } = await startApp(dataDir);
    const cookie = await login(again, 'keep@example.com');
    const res = await again.inject({ method: 'GET', url: `/api/episodes/${ep.id}`, headers: asUser(cookie) });
    expect(res.json().episode).toEqual(ep);
    const preview = await again.inject({ method: 'GET', url: `/api/assets/${ep.scenes[0].storyboard.previewAssetId}`, headers: asUser(cookie) });
    expect(preview.statusCode).toBe(200);
    await again.close();
  });

  it('backs up and restores database and assets together', async () => {
    const { app, dataDir, ep } = await seed();
    await app.close();
    const archive = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'planb-bk-')), 'backup.tar.gz');
    cli(dataDir, 'backup', '--out', archive);
    expect(fs.existsSync(archive)).toBe(true);

    // Restore into a brand-new data directory (e.g. a new VPS).
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'planb-restore-target-'));
    cli(fresh, 'restore', '--from', archive, '--yes');
    expect(cli(fresh, 'verify')).toContain('All asset files present');
    const { app: restored } = await startApp(fresh);
    const cookie = await login(restored, 'keep@example.com');
    const got = (await restored.inject({ method: 'GET', url: `/api/episodes/${ep.id}`, headers: asUser(cookie) })).json().episode;
    expect(got).toEqual(ep);
    for (const id of [ep.scenes[0].storyboard.previewAssetId, ep.scenes[0].attachments[0].assetId]) {
      const r = await restored.inject({ method: 'GET', url: `/api/assets/${id}`, headers: asUser(cookie) });
      expect(r.statusCode).toBe(200);
    }
    // History needed for undo is restored too.
    const revs = (await restored.inject({ method: 'GET', url: `/api/episodes/${ep.id}/revisions`, headers: asUser(cookie) })).json().revisions;
    expect(revs.length).toBe(ep.revision);
    await restored.close();
  }, 60_000);
});

describe('portable export (acceptance 16)', () => {
  it('produces plan.json, plan.md, assets and editable storyboards with relative paths and no secrets', async () => {
    const { app, ep, token, cookie } = await seed();
    const res = await app.inject({ method: 'GET', url: `/api/episodes/${ep.id}/export.zip`, headers: asAgent(token) });
    expect(res.statusCode).toBe(200);
    const files = unzipSync(new Uint8Array(res.rawPayload));
    const names = Object.keys(files);
    const root = names[0].split('/')[0];
    const plan = JSON.parse(strFromU8(files[`${root}/plan.json`]));
    expect(plan.schemaVersion).toBe(1);
    expect(plan.episode.revision).toBe(ep.revision);
    expect(plan.episode.outline).toBe('Setup: early start');
    expect(plan.scenes.map((s: { id: string }) => s.id)).toEqual(ep.scenes.map((s: { id: string }) => s.id));
    expect(plan.scenes.map((s: { durationSeconds: number }) => s.durationSeconds)).toEqual([45, 30, 60, 30]);
    expect(plan.scenes.map((s: { startSeconds: number }) => s.startSeconds)).toEqual([0, 45, 75, 135]);

    // Every relative path resolves inside the bundle.
    const referenced: string[] = [];
    for (const s of plan.scenes) {
      for (const a of s.attachments) if (a.kind === 'image') referenced.push(a.file);
      if (s.storyboard) referenced.push(s.storyboard.document, s.storyboard.preview);
    }
    expect(referenced).toHaveLength(3);
    for (const rel of referenced) expect(files[`${root}/${rel}`], rel).toBeDefined();
    const doc = JSON.parse(strFromU8(files[`${root}/${plan.scenes[0].storyboard.document}`]));
    expect(doc.objects[0].text).toBe('Bags here');
    expect(files[`${root}/storyboards/${doc.background.file.replace('../', '')}`] ?? files[`${root}/${doc.background.file.replace('../', '')}`]).toBeDefined();
    // Scenes without artwork are handled normally; external links stay external.
    expect(plan.scenes[1].storyboard).toBeNull();
    expect(plan.scenes[0].attachments[1]).toMatchObject({ kind: 'link', external: true, url: 'https://example.com/list' });

    const md = strFromU8(files[`${root}/plan.md`]);
    expect(md).toContain('# Persist me');
    expect(md).toContain(`](${plan.scenes[0].storyboard.preview})`);

    // No credentials, tokens or app URLs anywhere in the bundle.
    const all = Object.values(files).map((f) => Buffer.from(f).toString('latin1')).join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain(cookie.split('=')[1]);
    expect(all).not.toMatch(/planb_[A-Za-z0-9_-]{20,}/);
    expect(all).not.toContain('/api/assets/');
    expect(all).not.toContain('scrypt$');
    await app.close();
  });
});
