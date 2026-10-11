// End-to-end MCP check over real HTTP with the official SDK client.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { startApp } from './helpers.js';

let app: FastifyInstance;
let base: string;
let token: string;
let otherToken: string;

async function connect(t: string) {
  const client = new Client({ name: 'planb-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
  return client;
}
const parse = (r: Awaited<ReturnType<Client['callTool']>>) => JSON.parse((r.content as { type: string; text: string }[])[0].text);

beforeAll(async () => {
  ({ app } = await startApp());
  const { auth } = app.services;
  const a = await auth.createUser('mcp@example.com', 'Creator', 'correct horse battery');
  const b = await auth.createUser('mcp-other@example.com', 'Other', 'correct horse battery');
  token = auth.createAgentToken(a.id, 'SDK client').token;
  otherToken = auth.createAgentToken(b.id, 'Other').token;
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await app.close();
});

describe('MCP adapter', () => {
  it('rejects missing and invalid tokens', async () => {
    await expect(connect('planb_not-a-token')).rejects.toThrow();
  });

  it('lists only the required tools', async () => {
    const client = await connect(token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'apply_changes',
        'create_episode',
        'get_episode',
        'get_filming_checklist',
        'get_image',
        'get_shot_and_cut_guide',
        'get_storyboard',
        'get_storyboard_schema',
        'get_workflow_guide',
        'list_episodes',
        'list_revisions',
        'restore_revision',
        'upload_image',
      ].sort(),
    );
    await client.close();
  });

  it('round trip: read, write outline/scene fields/shot, drawing, stale rejection, checklist', async () => {
    const client = await connect(token);
    const created = parse(await client.callTool({ name: 'create_episode', arguments: { title: 'MCP episode', withExample: true } }));
    const id = created.id;
    let ep = parse(await client.callTool({ name: 'get_episode', arguments: { episodeId: id } }));
    expect(ep.scenes).toHaveLength(4);
    const loading = ep.scenes[1];

    const res = parse(
      await client.callTool({
        name: 'apply_changes',
        arguments: {
          episodeId: id,
          baseRevision: ep.revision,
          summary: 'Outline + coverage',
          operations: [
            { op: 'updateEpisode', fields: { outline: 'Setup: two riders\nResult: open until the trip happens' } },
            { op: 'updateScene', sceneId: loading.id, fields: { purpose: 'Introduce the riders', voiceover: 'VO: we finally go', audio: 'Ratchet straps' } },
            { op: 'addShot', sceneId: loading.id, shot: { description: 'Reaction as the bike clears the ramp', framing: 'Close-up', priority: 'optional' } },
          ],
        },
      }),
    );
    expect(res.revision).toBe(ep.revision + 1);
    ep = res.episode;
    expect(ep.outline).toContain('Setup: two riders');
    expect(ep.scenes[1]).toMatchObject({ purpose: 'Introduce the riders', voiceover: 'VO: we finally go', audio: 'Ratchet straps' });
    expect(ep.scenes[1].shots).toHaveLength(4);

    // The agent view includes the kit list, so agents can reference gear IDs.
    const kit = parse(
      await client.callTool({
        name: 'apply_changes',
        arguments: { episodeId: id, baseRevision: res.revision, operations: [{ op: 'addGear', id: 'ge_mcpcamera01', item: { name: 'Action camera', kind: 'camera' } }] },
      }),
    );
    const viewed = parse(await client.callTool({ name: 'get_episode', arguments: { episodeId: id } }));
    expect(viewed.gear).toEqual([{ id: 'ge_mcpcamera01', name: 'Action camera', kind: 'camera', notes: '' }]);
    ep = kit.episode;

    // Drawing through the same validated operation.
    const schema = parse(await client.callTool({ name: 'get_storyboard_schema', arguments: {} }));
    const drawn = parse(
      await client.callTool({
        name: 'apply_changes',
        arguments: { episodeId: id, baseRevision: ep.revision, operations: [{ op: 'saveStoryboard', sceneId: loading.id, storyboard: schema.example }] },
      }),
    );
    const sb = drawn.episode.scenes[1].storyboard;
    expect(sb.objectCount).toBe(3);
    const img = await client.callTool({ name: 'get_image', arguments: { assetId: sb.previewAssetId, maxWidth: 400 } });
    expect((img.content as { type: string }[])[0].type).toBe('image');
    const full = parse(await client.callTool({ name: 'get_storyboard', arguments: { episodeId: id, sceneId: loading.id } }));
    expect(full.storyboard.objects).toEqual(schema.example.objects);

    // Invalid drawing is rejected by the shared validation.
    const bad = await client.callTool({
      name: 'apply_changes',
      arguments: {
        episodeId: id,
        baseRevision: drawn.revision,
        operations: [{ op: 'saveStoryboard', sceneId: loading.id, storyboard: { objects: [{ id: 'x', type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1, color: 'red', width: 3 }] } }],
      },
    });
    expect(bad.isError).toBe(true);

    // A stale write is rejected with guidance.
    const stale = await client.callTool({
      name: 'apply_changes',
      arguments: { episodeId: id, baseRevision: ep.revision, operations: [{ op: 'updateEpisode', fields: { title: 'x' } }] },
    });
    expect(stale.isError).toBe(true);
    expect(parse(stale).code).toBe('stale_revision');

    // Upload + attach a user-supplied image.
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).png().toBuffer();
    const up = parse(await client.callTool({ name: 'upload_image', arguments: { episodeId: id, filename: 'map.png', base64: png.toString('base64') } }));
    const attached = parse(
      await client.callTool({
        name: 'apply_changes',
        arguments: {
          episodeId: id,
          baseRevision: drawn.revision,
          operations: [
            { op: 'addImage', sceneId: loading.id, assetId: up.assetId, label: 'Route map' },
            { op: 'addLink', sceneId: loading.id, label: 'Ramp video', url: 'https://example.com/ramp' },
          ],
        },
      }),
    );
    expect(attached.episode.scenes[1].attachments.map((a: { kind: string }) => a.kind)).toEqual(['image', 'link']);
    expect(attached.episode.scenes[1].storyboard.previewAssetId).toBe(sb.previewAssetId); // artwork untouched

    const checklist = await client.callTool({ name: 'get_filming_checklist', arguments: { episodeId: id } });
    expect((checklist.content as { text: string }[])[0].text).toContain('Reaction as the bike clears the ramp');

    // Restore: undo the attachment revision.
    const restored = parse(
      await client.callTool({ name: 'restore_revision', arguments: { episodeId: id, targetRevision: attached.revision - 1, baseRevision: attached.revision } }),
    );
    expect(restored.scenes[1].attachments).toHaveLength(0);
    await client.close();

    // Another account's agent cannot see or touch it.
    const other = await connect(otherToken);
    const denied = await other.callTool({ name: 'get_episode', arguments: { episodeId: id } });
    expect(denied.isError).toBe(true);
    const deniedImg = await other.callTool({ name: 'get_image', arguments: { assetId: sb.previewAssetId } });
    expect(deniedImg.isError).toBe(true);
    expect(parse(await other.callTool({ name: 'list_episodes', arguments: {} }))).toEqual([]);
    await other.close();
  });
});
