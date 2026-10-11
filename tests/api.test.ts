import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sceneStarts, totalSeconds, type Episode } from '../src/shared/model.js';
import { asAgent, asUser, multipartBody, samplePng, setup, startApp, login, type TestCtx } from './helpers.js';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => {
  await ctx.app.close();
});

async function createExample(headers: Record<string, string>): Promise<Episode> {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/episodes', headers, payload: { title: 'Heading for the mountains', withExample: true } });
  expect(res.statusCode).toBe(201);
  return res.json().episode;
}
async function change(headers: Record<string, string>, ep: { id: string; revision: number }, operations: unknown[], summary?: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/episodes/${ep.id}/changes`,
    headers,
    payload: { baseRevision: ep.revision, operations, summary },
  });
}
async function read(headers: Record<string, string>, id: string): Promise<Episode> {
  const res = await ctx.app.inject({ method: 'GET', url: `/api/episodes/${id}`, headers });
  expect(res.statusCode).toBe(200);
  return res.json().episode;
}

describe('authentication', () => {
  it('rejects unauthenticated requests', async () => {
    for (const url of ['/api/episodes', '/api/episodes/ep_abcdefabcdef', '/api/assets/as_abcdefabcdef']) {
      expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    const mcp = await ctx.app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(mcp.statusCode).toBe(401);
  });

  it('rejects wrong passwords and requires the CSRF header for cookie writes', async () => {
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'alice@example.com', password: 'nope-nope-nope' } });
    expect(bad.statusCode).toBe(401);
    const noHeader = await ctx.app.inject({ method: 'POST', url: '/api/episodes', headers: { cookie: ctx.cookieA }, payload: { title: 'x' } });
    expect(noHeader.statusCode).toBe(403);
  });

  it('agent tokens cannot manage tokens and revoked tokens stop working', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/tokens', headers: asAgent(ctx.tokenA) })).statusCode).toBe(403);
    const created = await ctx.app.inject({ method: 'POST', url: '/api/tokens', headers: asUser(ctx.cookieA), payload: { label: 'temp' } });
    const { id, token } = created.json();
    expect((await ctx.app.inject({ method: 'GET', url: '/api/episodes', headers: asAgent(token) })).statusCode).toBe(200);
    await ctx.app.inject({ method: 'DELETE', url: `/api/tokens/${id}`, headers: asUser(ctx.cookieA) });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/episodes', headers: asAgent(token) })).statusCode).toBe(401);
  });

  it('throttles repeated failed logins', async () => {
    const { app } = await startApp();
    await app.services.auth.createUser('carol@example.com', '', 'correct horse battery');
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const email = ' '.repeat(i % 3) + 'carol@example.com' + ' '.repeat(i % 2); // padding must not reset the limit
      last = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'wrong-password' } })).statusCode;
    }
    expect(last).toBe(429);
    await app.close();
  });
});

describe('planning (acceptance 1–3, 10, 11, 13)', () => {
  it('creates the example opening and computes timing', async () => {
    const ep = await createExample(asUser(ctx.cookieA));
    expect(ep.scenes.map((s) => s.title)).toEqual(['Packing for the ride', 'Loading the trailer', 'The road to the mountains', 'Fuel and coffee stop']);
    expect(totalSeconds(ep)).toBe(165);
    // Another "browser" (new session) sees the same plan.
    const other = await login(ctx.app, 'alice@example.com');
    expect((await read(asUser(other), ep.id)).scenes.map((s) => s.id)).toEqual(ep.scenes.map((s) => s.id));
  });

  it('changing packing from 45 to 60 s moves later scenes by 15 s and keeps shots', async () => {
    const ep = await createExample(asUser(ctx.cookieA));
    const before = sceneStarts(ep);
    const packing = ep.scenes[0];
    const res = await change(asUser(ctx.cookieA), ep, [{ op: 'updateScene', sceneId: packing.id, fields: { durationSeconds: 60 } }]);
    expect(res.statusCode).toBe(200);
    const after = res.json().episode as Episode;
    expect(totalSeconds(after)).toBe(180);
    expect(sceneStarts(after).slice(1)).toEqual(before.slice(1).map((s) => s + 15));
    expect(after.scenes[0].shots).toEqual(packing.shots);
  });

  it('reordering keeps IDs, descriptions, shots and captured flags attached', async () => {
    let ep = await createExample(asUser(ctx.cookieA));
    const loading = ep.scenes[1];
    ep = (await change(asUser(ctx.cookieA), ep, [{ op: 'updateShot', sceneId: loading.id, shotId: loading.shots[1].id, fields: { captured: true } }])).json().episode;
    ep = (await change(asUser(ctx.cookieA), ep, [{ op: 'moveScene', sceneId: loading.id, index: 3 }])).json().episode;
    const moved = ep.scenes[3];
    expect(moved.id).toBe(loading.id);
    expect(moved.description).toBe(loading.description);
    expect(moved.shots.map((s) => s.id)).toEqual(loading.shots.map((s) => s.id));
    expect(moved.shots[1].captured).toBe(true);
    expect(moved.status).toBe('draft'); // captured does not change planning status
  });

  it('outline is optional, starter is free text and scenes are unconstrained', async () => {
    const created = await ctx.app.inject({ method: 'POST', url: '/api/episodes', headers: asUser(ctx.cookieA), payload: { title: 'Blank' } });
    let ep = created.json().episode as Episode;
    expect(ep.outline).toBe('');
    ep = (await change(asUser(ctx.cookieA), ep, [{ op: 'updateEpisode', fields: { status: 'ready' } }])).json().episode;
    expect(ep.status).toBe('ready'); // blank outline does not block readiness
    const ops = Array.from({ length: 7 }, (_, i) => ({ op: 'addScene', scene: { title: `Scene ${i + 1}`, durationSeconds: 10 + i } }));
    ep = (await change(asUser(ctx.cookieA), ep, [{ op: 'updateEpisode', fields: { outline: 'Setup: x\nDesire:\nConflict:\nChange:\nResult:' } }, ...ops])).json().episode;
    expect(ep.scenes).toHaveLength(7);
    expect(totalSeconds(ep)).toBe(7 * 10 + 21);
  });

  it('rejects invalid input with readable messages', async () => {
    const ep = await createExample(asUser(ctx.cookieA));
    const res = await change(asUser(ctx.cookieA), ep, [{ op: 'updateScene', sceneId: ep.scenes[0].id, fields: { durationSeconds: 2.5 } }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/whole seconds/);
    for (const title of ['', '   ']) {
      const res2 = await change(asUser(ctx.cookieA), ep, [{ op: 'addScene', scene: { title, durationSeconds: 10 } }]);
      expect(res2.statusCode).toBe(400);
    }
    // A removed item's ID cannot be reused in the same batch (it would inherit its identity).
    const reuse = await change(asUser(ctx.cookieA), ep, [
      { op: 'deleteShot', sceneId: ep.scenes[0].id, shotId: ep.scenes[0].shots[0].id },
      { op: 'addShot', sceneId: ep.scenes[0].id, id: ep.scenes[0].shots[0].id, shot: { description: 'x' } },
    ]);
    expect(reuse.statusCode).toBe(400);
  });

  it('validates shot size/angle/movement and scene cut vocabulary', async () => {
    const ep = await createExample(asUser(ctx.cookieA));
    const sc = ep.scenes[0];
    const ok = await change(asAgent(ctx.tokenA), ep, [
      { op: 'updateShot', sceneId: sc.id, shotId: sc.shots[0].id, fields: { size: 'ews', angle: 'aerial', movement: 'aerial' } },
      { op: 'addShot', sceneId: sc.id, shot: { description: 'Buckle detail', size: 'ins', movement: 'static' } },
      { op: 'updateScene', sceneId: sc.id, fields: { cutToNext: 'lcut' } },
    ]);
    expect(ok.statusCode).toBe(200);
    const s0 = ok.json().episode.scenes[0];
    expect(s0.shots[0]).toMatchObject({ size: 'ews', angle: 'aerial', movement: 'aerial' });
    expect(s0.shots[3]).toMatchObject({ size: 'ins', angle: null, movement: 'static' });
    expect(s0.cutToNext).toBe('lcut');
    const bad = await change(asAgent(ctx.tokenA), ok.json().episode, [{ op: 'updateShot', sceneId: sc.id, shotId: sc.shots[0].id, fields: { size: 'huge' } }]);
    expect(bad.statusCode).toBe(400);
  });

  it('kit list: add gear, assign to shots, reject unknown gear, removal strips shots', async () => {
    let ep = await createExample(asUser(ctx.cookieA));
    const sc = ep.scenes[0];
    let res = await change(asAgent(ctx.tokenA), ep, [
      { op: 'addGear', id: 'ge_camera00001', item: { name: 'Action camera', kind: 'camera', notes: '3 batteries' } },
      { op: 'addGear', id: 'ge_tripod00001', item: { name: 'Mini tripod', kind: 'support' } },
      { op: 'updateShot', sceneId: sc.id, shotId: sc.shots[0].id, fields: { gear: ['ge_camera00001', 'ge_tripod00001'] } },
    ]);
    expect(res.statusCode).toBe(200);
    ep = res.json().episode;
    expect(ep.gear.map((g: { name: string }) => g.name)).toEqual(['Action camera', 'Mini tripod']);
    expect(ep.scenes[0].shots[0].gear).toEqual(['ge_camera00001', 'ge_tripod00001']);
    const unknown = await change(asAgent(ctx.tokenA), ep, [{ op: 'updateShot', sceneId: sc.id, shotId: sc.shots[1].id, fields: { gear: ['ge_drone000001'] } }]);
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error).toMatch(/not in the kit list/);
    res = await change(asUser(ctx.cookieA), ep, [{ op: 'removeGear', gearId: 'ge_tripod00001' }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().episode.scenes[0].shots[0].gear).toEqual(['ge_camera00001']);
  });

  it('deleted scenes can be restored with their shots', async () => {
    let ep = await createExample(asUser(ctx.cookieA));
    const victim = ep.scenes[2];
    ep = (await change(asUser(ctx.cookieA), ep, [{ op: 'deleteScene', sceneId: victim.id }])).json().episode;
    expect(ep.scenes.find((s) => s.id === victim.id)).toBeUndefined();
    ep = (await change(asUser(ctx.cookieA), ep, [{ op: 'restoreDeletedScene', sceneId: victim.id, index: 2 }])).json().episode;
    expect(ep.scenes[2]).toEqual(victim);
  });
});

describe('agent writes and revision protection (acceptance 5–7)', () => {
  it('rejects a stale agent write and preserves the newer human edit', async () => {
    const ep = await createExample(asUser(ctx.cookieA));
    const agentRead = await read(asAgent(ctx.tokenA), ep.id);
    const human = await change(asUser(ctx.cookieA), ep, [{ op: 'updateScene', sceneId: ep.scenes[0].id, fields: { title: 'Packing (human edit)' } }]);
    expect(human.statusCode).toBe(200);
    const stale = await change(asAgent(ctx.tokenA), agentRead, [{ op: 'updateScene', sceneId: ep.scenes[0].id, fields: { title: 'Agent title' } }]);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('stale_revision');
    expect(stale.json().newerRevisions[0].authorLabel).toBe('Alice');
    expect((await read(asUser(ctx.cookieA), ep.id)).scenes[0].title).toBe('Packing (human edit)');
  });

  it('records the agent as author and restores through a new revision', async () => {
    let ep = await createExample(asUser(ctx.cookieA));
    const loading = ep.scenes[1];
    const agent = await change(asAgent(ctx.tokenA), ep, [{ op: 'addShot', sceneId: loading.id, shot: { description: 'Agent shot' } }], 'Add coverage');
    ep = agent.json().episode;
    const agentRev = ep.revision;
    // A later human edit.
    ep = (await change(asUser(ctx.cookieA), ep, [{ op: 'updateEpisode', fields: { notes: 'Observed: rain' } }])).json().episode;
    const revs = (await ctx.app.inject({ method: 'GET', url: `/api/episodes/${ep.id}/revisions`, headers: asUser(ctx.cookieA) })).json().revisions;
    expect(revs.find((r: { revision: number }) => r.revision === agentRev).authorLabel).toBe('Agent: Claude');

    // Undoing the agent revision would also revert the human edit: refused until acknowledged.
    const refused = await ctx.app.inject({
      method: 'POST',
      url: `/api/episodes/${ep.id}/restore`,
      headers: asUser(ctx.cookieA),
      payload: { targetRevision: agentRev - 1, baseRevision: ep.revision },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('later_revisions');
    expect(refused.json().revertedRevisions).toHaveLength(2);
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/api/episodes/${ep.id}/restore`,
      headers: asUser(ctx.cookieA),
      payload: { targetRevision: agentRev - 1, baseRevision: ep.revision, acknowledgeLaterRevisions: true },
    });
    expect(ok.statusCode).toBe(200);
    const restored = ok.json().episode as Episode;
    expect(restored.revision).toBe(ep.revision + 1);
    expect(restored.scenes[1].shots.some((s) => s.description === 'Agent shot')).toBe(false);
    expect(restored.notes).toBe('');
    // History is kept, so the human edit can itself be recovered.
    const snap = await ctx.app.inject({ method: 'GET', url: `/api/episodes/${ep.id}/revisions/${ep.revision}`, headers: asUser(ctx.cookieA) });
    expect(snap.json().revision.notes).toBe('Observed: rain');
  });

  it('an acknowledgement only covers the revisions that were shown', async () => {
    let ep = await createExample(asUser(ctx.cookieA));
    ep = (await change(asUser(ctx.cookieA), ep, [{ op: 'updateEpisode', fields: { notes: 'a' } }])).json().episode;
    ep = (await change(asUser(ctx.cookieA), ep, [{ op: 'updateEpisode', fields: { notes: 'b' } }])).json().episode;
    const shownAt = ep.revision;
    // While the confirmation is open, the agent saves another revision.
    await change(asAgent(ctx.tokenA), ep, [{ op: 'updateEpisode', fields: { outline: 'agent, unseen' } }]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/episodes/${ep.id}/restore`,
      headers: asUser(ctx.cookieA),
      payload: { targetRevision: shownAt - 2, baseRevision: shownAt, acknowledgeLaterRevisions: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('stale_revision');
    expect((await read(asUser(ctx.cookieA), ep.id)).outline).toBe('agent, unseen');
  });

  it('undoing the latest revision needs no acknowledgement', async () => {
    let ep = await createExample(asUser(ctx.cookieA));
    ep = (await change(asAgent(ctx.tokenA), ep, [{ op: 'updateEpisode', fields: { outline: 'Agent outline' } }])).json().episode;
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/api/episodes/${ep.id}/restore`,
      headers: asAgent(ctx.tokenA),
      payload: { targetRevision: ep.revision - 1, baseRevision: ep.revision },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().episode.outline).toBe('');
  });
});

describe('account isolation (acceptance 9, 15)', () => {
  it("cannot read or modify another account's episode or assets", async () => {
    const ep = await createExample(asUser(ctx.cookieA));
    const { payload, contentType } = multipartBody('ref.png', await samplePng());
    const up = await ctx.app.inject({ method: 'POST', url: `/api/episodes/${ep.id}/assets`, headers: { ...asUser(ctx.cookieA), 'content-type': contentType }, payload });
    const assetId = up.json().asset.id;
    for (const headers of [asUser(ctx.cookieB), asAgent(ctx.tokenB)]) {
      expect((await ctx.app.inject({ method: 'GET', url: `/api/episodes/${ep.id}`, headers })).statusCode).toBe(404);
      expect((await change(headers, ep, [{ op: 'updateEpisode', fields: { title: 'pwned' } }])).statusCode).toBe(404);
      expect((await ctx.app.inject({ method: 'GET', url: `/api/assets/${assetId}`, headers })).statusCode).toBe(404);
      expect((await ctx.app.inject({ method: 'GET', url: `/api/assets/${assetId}?w=320`, headers })).statusCode).toBe(404);
      expect((await ctx.app.inject({ method: 'GET', url: `/api/episodes/${ep.id}/export.zip`, headers })).statusCode).toBe(404);
      expect((await ctx.app.inject({ method: 'GET', url: `/api/episodes/${ep.id}/revisions`, headers })).statusCode).toBe(404);
      const list = (await ctx.app.inject({ method: 'GET', url: '/api/episodes', headers })).json().episodes;
      expect(list.some((e: { id: string }) => e.id === ep.id)).toBe(false);
    }
    // Bob cannot attach Alice's asset to his own episode either.
    const bobEp = (await ctx.app.inject({ method: 'POST', url: '/api/episodes', headers: asUser(ctx.cookieB), payload: { title: 'Bob', withExample: true } })).json().episode;
    const steal = await change(asUser(ctx.cookieB), bobEp, [{ op: 'addImage', sceneId: bobEp.scenes[0].id, assetId }]);
    expect(steal.statusCode).toBe(400);
    expect((await read(asUser(ctx.cookieA), ep.id)).title).toBe('Heading for the mountains');
  });
});

describe('references and storyboards (acceptance 14, 15)', () => {
  it('validates uploads', async () => {
    const ep = await createExample(asUser(ctx.cookieA));
    const fake = multipartBody('x.png', Buffer.from('not an image at all'));
    const res = await ctx.app.inject({ method: 'POST', url: `/api/episodes/${ep.id}/assets`, headers: { ...asUser(ctx.cookieA), 'content-type': fake.contentType }, payload: fake.payload });
    expect(res.statusCode).toBe(415);
    const big = multipartBody('big.png', Buffer.alloc(11 * 1024 * 1024, 1));
    const res2 = await ctx.app.inject({ method: 'POST', url: `/api/episodes/${ep.id}/assets`, headers: { ...asUser(ctx.cookieA), 'content-type': big.contentType }, payload: big.payload });
    expect(res2.statusCode).toBe(413);
    expect(res2.json().error).toMatch(/10 MiB/);
  });

  it('saves drawing + matching preview in one revision, and text edits keep the artwork', async () => {
    let ep = await createExample(asUser(ctx.cookieA));
    const scene = ep.scenes[1];
    const { payload, contentType } = multipartBody('ramp.png', await samplePng(800, 600, '#cc8844'));
    const assetId = (await ctx.app.inject({ method: 'POST', url: `/api/episodes/${ep.id}/assets`, headers: { ...asUser(ctx.cookieA), 'content-type': contentType }, payload })).json().asset.id;
    let res = await change(asUser(ctx.cookieA), ep, [
      { op: 'addImage', sceneId: scene.id, assetId, label: 'Ramp', id: 'at_ramp000001' },
      { op: 'addLink', sceneId: scene.id, label: 'Trailer straps guide', url: 'https://example.com/straps' },
      {
        op: 'saveStoryboard',
        sceneId: scene.id,
        storyboard: {
          backgroundAttachmentId: 'at_ramp000001',
          description: 'Rider pushes bike up the ramp',
          objects: [
            { id: 'f1', type: 'freehand', points: [100, 100, 150, 140, 220, 160], color: '#dc2626', width: 6 },
            { id: 'a1', type: 'arrow', x1: 200, y1: 650, x2: 800, y2: 450, color: '#dc2626', width: 6 },
            { id: 'r1', type: 'rect', x: 900, y: 300, w: 400, h: 260, color: '#2563eb', width: 6 },
            { id: 'e1', type: 'ellipse', x: 300, y: 200, w: 200, h: 120, color: '#16a34a', width: 3 },
            { id: 't1', type: 'text', x: 180, y: 700, text: 'Costis enters here', color: '#111827', size: 48 },
          ],
        },
      },
    ]);
    expect(res.statusCode).toBe(200);
    ep = res.json().episode;
    const sb = ep.scenes[1].storyboard!;
    expect(sb.savedRevision).toBe(ep.revision);
    const preview = await ctx.app.inject({ method: 'GET', url: `/api/assets/${sb.previewAssetId}`, headers: asUser(ctx.cookieA) });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toBe('image/png');
    const sharp = (await import('sharp')).default;
    const meta = await sharp(preview.rawPayload).metadata();
    expect([meta.width, meta.height]).toEqual([1600, 900]);

    // Text-only edit must not replace artwork.
    res = await change(asAgent(ctx.tokenA), ep, [{ op: 'updateScene', sceneId: scene.id, fields: { voiceover: 'New VO', purpose: 'p', audio: 'a' } }]);
    const after = res.json().episode as Episode;
    expect(after.scenes[1].storyboard).toEqual(sb);
    expect(after.scenes[1].attachments).toEqual(ep.scenes[1].attachments);

    // Removing the background image without detaching it is refused with an explanation.
    const blocked = await change(asUser(ctx.cookieA), after, [{ op: 'removeAttachment', sceneId: scene.id, attachmentId: 'at_ramp000001' }]);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toMatch(/Replace or detach/);
    const detached = await change(asUser(ctx.cookieA), after, [
      { op: 'saveStoryboard', sceneId: scene.id, storyboard: { ...sb, backgroundAttachmentId: null } },
      { op: 'removeAttachment', sceneId: scene.id, attachmentId: 'at_ramp000001' },
    ]);
    expect(detached.statusCode).toBe(200);
    const d = detached.json().episode.scenes[1].storyboard;
    expect(d.previewAssetId).not.toBe(sb.previewAssetId);
    expect(d.id).toBe(sb.id);
  });

  it('a stale drawing save publishes no preview and changes nothing', async () => {
    const ep = await createExample(asUser(ctx.cookieA));
    const fresh = (await change(asUser(ctx.cookieA), ep, [{ op: 'updateEpisode', fields: { brief: 'newer' } }])).json().episode;
    const before = ctx.app.services.assets.forEpisode(ep.id).length;
    const res = await change(asUser(ctx.cookieA), ep, [
      { op: 'saveStoryboard', sceneId: ep.scenes[0].id, storyboard: { objects: [{ id: 'x', type: 'rect', x: 1, y: 1, w: 10, h: 10, color: '#111827', width: 3 }] } },
    ]);
    expect(res.statusCode).toBe(409);
    expect(ctx.app.services.assets.forEpisode(ep.id).length).toBe(before);
    expect((await read(asUser(ctx.cookieA), ep.id)).revision).toBe(fresh.revision);
  });
});
