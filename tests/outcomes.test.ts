import { describe, expect, it } from 'vitest';
import { checklistMarkdown } from '../src/shared/checklist.js';
import { EpisodeDocSchema, normaliseDoc, outcomeCounts, outcomeSummary, type EpisodeDoc } from '../src/shared/model.js';
import { OperationSchema, applyOperations, summariseOperations } from '../src/shared/ops.js';
import { PASSWORD, asAgent, asUser, login, startApp } from './helpers.js';

const base = () =>
  EpisodeDocSchema.parse({
    title: 'Trip',
    scenes: [
      {
        id: 'sc_capexxxx',
        title: 'Cape',
        durationSeconds: 60,
        shots: [
          { id: 'sh_dronexxx', description: 'Drone over the cape' },
          { id: 'sh_widexxxx', description: 'Wide of the riders' },
          { id: 'sh_detailxx', description: 'Gloves detail' },
        ],
      },
    ],
  });
const ctx = { newId: () => 'sh_newxxxxx', nextRevision: 2, now: () => '2026-11-14T10:00:00.000Z' };
const run = (doc: EpisodeDoc, ...ops: unknown[]) => applyOperations(doc, ops.map((o) => OperationSchema.parse(o)), ctx).doc;
const shot = (doc: EpisodeDoc, i: number) => doc.scenes[0].shots[i];
const upd = (shotId: string, fields: object) => ({ op: 'updateShot', sceneId: 'sc_capexxxx', shotId, fields });

describe('shot outcomes', () => {
  it('start open; filmed and skipped are exclusive, reversible and time-stamped', () => {
    let doc = base();
    expect(shot(doc, 0)).toMatchObject({ outcome: 'open', captured: false, skipReason: '', outcomeAt: null, journalRefs: [] });
    doc = run(doc, upd('sh_dronexxx', { outcome: 'skipped', skipReason: 'Wind too strong' }), upd('sh_widexxxx', { outcome: 'filmed' }));
    expect(shot(doc, 0)).toMatchObject({ outcome: 'skipped', captured: false, skipReason: 'Wind too strong', outcomeAt: '2026-11-14T10:00:00.000Z' });
    expect(shot(doc, 1)).toMatchObject({ outcome: 'filmed', captured: true });
    // Reopening clears the reason and the time.
    doc = run(doc, upd('sh_dronexxx', { outcome: 'open' }));
    expect(shot(doc, 0)).toMatchObject({ outcome: 'open', skipReason: '', outcomeAt: null });
    // A reason can be added after skipping without changing the time.
    doc = run(doc, upd('sh_detailxx', { outcome: 'skipped' }));
    doc = applyOperations(doc, [OperationSchema.parse(upd('sh_detailxx', { skipReason: 'Covered by another shot' }))], { ...ctx, now: () => 'later' }).doc;
    expect(shot(doc, 2)).toMatchObject({ outcome: 'skipped', skipReason: 'Covered by another shot', outcomeAt: '2026-11-14T10:00:00.000Z' });
  });

  it('counts skipped as resolved but never as filmed', () => {
    const doc = run(base(), upd('sh_dronexxx', { outcome: 'skipped' }), upd('sh_widexxxx', { outcome: 'filmed' }));
    const c = outcomeCounts(doc.scenes[0].shots);
    expect(c).toEqual({ filmed: 1, skipped: 1, open: 1, total: 3 });
    expect(outcomeSummary(c)).toBe('1 filmed · 1 skipped · 1 open');
  });

  it('keeps the legacy captured flag working both ways', () => {
    let doc = run(base(), upd('sh_widexxxx', { captured: true }));
    expect(shot(doc, 1)).toMatchObject({ outcome: 'filmed', captured: true });
    doc = run(doc, upd('sh_widexxxx', { captured: false }));
    expect(shot(doc, 1)).toMatchObject({ outcome: 'open', captured: false });
    // Plans saved before outcomes existed read captured shots as filmed.
    const old = JSON.parse(JSON.stringify(base())) as EpisodeDoc;
    for (const s of old.scenes[0].shots) delete (s as Partial<typeof s>).outcome;
    old.scenes[0].shots[0].captured = true;
    expect(normaliseDoc(old).scenes[0].shots.map((s) => s.outcome)).toEqual(['filmed', 'open', 'open']);
  });

  it('only keeps a skip reason on skipped shots, and links journal entries', () => {
    const doc = run(base(), upd('sh_widexxxx', { skipReason: 'not skipped' }), upd('sh_dronexxx', { outcome: 'skipped', journalRefs: ['tl_2026-11-14-0932'] }));
    expect(shot(doc, 1).skipReason).toBe('');
    expect(shot(doc, 0).journalRefs).toEqual(['tl_2026-11-14-0932']);
    expect(OperationSchema.safeParse(upd('sh_dronexxx', { outcome: 'lost' })).success).toBe(false);
  });

  it('shows outcomes in the checklist and history', () => {
    const before = base();
    const op = OperationSchema.parse(upd('sh_dronexxx', { outcome: 'skipped', skipReason: 'Wind too strong' }));
    const doc = applyOperations(before, [op, OperationSchema.parse(upd('sh_widexxxx', { outcome: 'filmed' }))], ctx).doc;
    const md = checklistMarkdown(doc);
    expect(md).toContain('- [-] Drone over the cape (essential) — skipped: Wind too strong [sh_dronexxx]');
    expect(md).toContain('- [x] Wide of the riders');
    expect(md).toContain('- [ ] Gloves detail');
    expect(md).toContain('1 filmed · 1 skipped · 1 open');
    expect(summariseOperations(before, [op])).toBe('Marked "Drone over the cape" in "Cape" as skipped (Wind too strong)');
  });
});

describe('outcomes through the API', () => {
  it('agents set outcomes; the server stamps the time; restore keeps the kit list', async () => {
    const { app } = await startApp();
    const user = await app.services.auth.createUser('trip@example.com', 'Trip', PASSWORD);
    const token = app.services.auth.createAgentToken(user.id, 'Journal').token;
    const cookie = await login(app, 'trip@example.com');
    const created = await app.inject({ method: 'POST', url: '/api/episodes', headers: asUser(cookie), payload: { title: 'Trip', withExample: true } });
    let ep = created.json().episode;
    const post = (ops: unknown[]) =>
      app.inject({ method: 'POST', url: `/api/episodes/${ep.id}/changes`, headers: asAgent(token), payload: { baseRevision: ep.revision, operations: ops } });
    let res = await post([{ op: 'addGear', id: 'ge_dronexxx', item: { name: 'Drone', kind: 'camera' } }]);
    ep = res.json().episode;
    const s = ep.scenes[1];
    res = await post([
      { op: 'updateShot', sceneId: s.id, shotId: s.shots[0].id, fields: { outcome: 'skipped', skipReason: 'Wind too strong', journalRefs: ['tl_42'] } },
    ]);
    expect(res.statusCode).toBe(200);
    ep = res.json().episode;
    const skipped = ep.scenes[1].shots[0];
    expect(skipped).toMatchObject({ outcome: 'skipped', skipReason: 'Wind too strong', captured: false, journalRefs: ['tl_42'] });
    expect(Date.parse(skipped.outcomeAt)).toBeGreaterThan(Date.now() - 60_000);
    const list = (await app.inject({ method: 'GET', url: '/api/episodes', headers: asUser(cookie) })).json().episodes[0];
    expect(list).toMatchObject({ capturedCount: 0, skippedCount: 1 });

    // Restoring an earlier revision brings back that revision's kit list too.
    res = await post([{ op: 'removeGear', gearId: 'ge_dronexxx' }]);
    ep = res.json().episode;
    const restored = await app.inject({
      method: 'POST',
      url: `/api/episodes/${ep.id}/restore`,
      headers: asUser(cookie),
      payload: { targetRevision: ep.revision - 1, baseRevision: ep.revision },
    });
    expect(restored.json().episode.gear.map((g: { id: string }) => g.id)).toEqual(['ge_dronexxx']);
    await app.close();
  });
});
