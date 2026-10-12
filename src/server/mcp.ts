// Thin MCP adapter over the same services the REST API uses. Stateless Streamable HTTP:
// each POST /mcp creates a server bound to the authenticated agent principal.
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checklistMarkdown, checklistOrder } from '../shared/checklist.js';
import { formatTime, sceneStarts, totalSeconds, type Episode } from '../shared/model.js';
import { OperationSchema } from '../shared/ops.js';
import { describeObjects } from '../shared/storyboard.js';
import type { Principal } from './auth.js';
import type { Services } from './app.js';
import { HttpError } from './errors.js';
import { storyboardSchemaDocument } from './schema-doc.js';
import { vocabularyForAgents } from '../shared/vocab.js';

const INSTRUCTIONS = `PlanB is the creator's shared episode planner. The saved project is the source of truth for both the creator (in the browser) and you.
Rules: call get_episode before writing and pass its revision as baseRevision to apply_changes. If a change is rejected as stale, read again and reapply only the intended change; never bypass the check.
Group one coherent request into one apply_changes call (it becomes one recoverable revision). Use partial updates; preserve IDs, shot outcomes, human wording, artwork and every field outside the request.
Scenes are timed blocks (whole seconds); shots are an untimed checklist. Each shot has an outcome: "open" (nothing recorded yet, still possible), "filmed" (the creator reports footage was captured; not reviewed) or "skipped" (deliberately dropped; no footage exists; skipReason may say why). Only filmed shots can have footage; never treat open or skipped shots as filmed. An outcome is about footage, not about whether the event happened: lunch can happen without being filmed (skipped or open shot), so take what happened from the creator or the Trip Log, never from shot outcomes or the plan. Record outcomes only when the creator or the trip log reports them. Planning status (draft/ready) is set by the creator; do not set it to ready unless asked.
In loose notes, keep "Planned", "Observed" and "Question" items distinguishable; never invent events, dialogue or outcomes. Call get_workflow_guide for the full conversational workflow.`;

/** Compact agent view: drawings are summarised; use get_storyboard for editable objects. */
export function agentEpisodeView(ep: Episode) {
  const starts = sceneStarts(ep);
  return {
    id: ep.id,
    revision: ep.revision,
    updatedAt: ep.updatedAt,
    title: ep.title,
    brief: ep.brief,
    outline: ep.outline,
    notes: ep.notes,
    status: ep.status,
    /** Kit list: shots refer to these IDs in their gear field. */
    gear: ep.gear ?? [],
    targetSeconds: ep.targetSeconds,
    totalSeconds: totalSeconds(ep),
    totalFormatted: formatTime(totalSeconds(ep)),
    scenes: ep.scenes.map((s, i) => ({
      ...s,
      position: i,
      startSeconds: starts[i],
      // Filming order (independent of story order); null when not planned yet.
      filmDay: s.filmDay ?? null,
      filmStop: s.filmStop ?? null,
      storyboard: s.storyboard
        ? {
            id: s.storyboard.id,
            width: s.storyboard.width,
            height: s.storyboard.height,
            backgroundAttachmentId: s.storyboard.backgroundAttachmentId,
            description: s.storyboard.description,
            summary: describeObjects(s.storyboard.objects),
            objectCount: s.storyboard.objects.length,
            previewAssetId: s.storyboard.previewAssetId,
            savedRevision: s.storyboard.savedRevision,
          }
        : null,
    })),
  };
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const failure = (e: unknown) => {
  if (e instanceof HttpError) {
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message, status: e.status, ...e.details }, null, 2) }] };
  }
  throw e;
};
async function run<T>(fn: () => T | Promise<T>) {
  try {
    return json(await fn());
  } catch (e) {
    return failure(e);
  }
}

export function createMcpServer(services: Services, principal: Principal, appVersion: string): McpServer {
  const { episodes, assets } = services;
  const server = new McpServer({ name: 'planb', version: appVersion }, { instructions: INSTRUCTIONS });
  const episodeId = z.string().describe('Episode ID, e.g. ep_xxxxxxxxxxxx');

  server.registerTool(
    'list_episodes',
    { title: 'List episodes', description: "List the episodes this account can work on (its own and any shared with it; ownerName is set for shared ones) with revision, scene count and planned runtime.", inputSchema: {} },
    async () => run(() => episodes.list(principal)),
  );

  server.registerTool(
    'get_episode',
    {
      title: 'Read episode',
      description:
        'Read the latest saved episode: revision, brief, optional story outline, loose notes, kit list and every scene in order with status, purpose, description, voice-over, audio/music, notes, location, filming day/stop, shots (each with outcome open|filmed|skipped, skipReason, outcomeAt and journalRefs), references and a storyboard summary.',
      inputSchema: { episodeId },
    },
    async ({ episodeId }) => run(() => agentEpisodeView(episodes.get(principal, episodeId))),
  );

  server.registerTool(
    'create_episode',
    {
      title: 'Create episode',
      description: 'Create a new empty episode (optionally with the illustrative MTA opening sequence). Returns the episode with revision 1 or 2.',
      inputSchema: {
        title: z.string().min(1).max(200),
        brief: z.string().max(20000).optional(),
        withExample: z.boolean().optional().describe('Add the four-scene example opening. Usually false.'),
      },
    },
    async (args) => run(async () => agentEpisodeView(await episodes.create(principal, args))),
  );

  server.registerTool(
    'apply_changes',
    {
      title: 'Apply changes',
      description: `Apply a batch of operations atomically as ONE revision, based on the revision you read. Rejected with stale_revision if the episode changed since; then call get_episode and reapply only the intended change.
Each operation is an object whose "op" key names the operation, for example:
[{"op":"updateEpisode","fields":{"outline":"…"}},{"op":"updateShot","sceneId":"sc_…","shotId":"sh_…","fields":{"size":"ws","angle":"eye","movement":"static"}},{"op":"updateScene","sceneId":"sc_…","fields":{"cutToNext":"jcut"}},{"op":"updateShot","sceneId":"sc_…","shotId":"sh_…","fields":{"outcome":"skipped","skipReason":"Wind too strong","journalRefs":["tl_…"]}}]
Operations: updateEpisode{fields:{title,brief,outline,notes,targetSeconds,status}}, addScene{scene:{title,durationSeconds,...optional fields, shots?}, index?}, updateScene{sceneId,fields}, deleteScene{sceneId}, restoreDeletedScene{sceneId,index?}, moveScene{sceneId,index}, addShot{sceneId,shot:{description,framing?,size?,angle?,movement?,cameraNotes?,gear?,priority?,outcome?,skipReason?,journalRefs?},index?}, updateShot{sceneId,shotId,fields}, deleteShot, moveShot{sceneId,shotId,index}, addLink{sceneId,label,url,caption?}, addImage{sceneId,assetId,label?,caption?} (after upload_image), updateAttachment, removeAttachment, saveStoryboard{sceneId,storyboard} (see get_storyboard_schema), deleteStoryboard{sceneId}.
Only include fields you intend to change. Scene fields: title, durationSeconds (whole seconds), status (draft|ready), description (visible action), purpose (what the viewer should understand or feel), notes (general/edit notes), voiceover (VO intent/text), audio (audio/music intent), location, thumbnailAttachmentId, cutToNext (editing intention into the next scene), filmDay and filmStop (filming order: shooting day 1, 2, … and stop within the day; independent of story order; null clears).
Shot fields: description, framing (free text), size, angle, movement (keys from get_shot_and_cut_guide; null = unspecified), cameraNotes, gear (array of kit-list IDs), priority (essential|optional), outcome (open = nothing recorded yet | filmed = creator reports footage captured, not reviewed | skipped = deliberately dropped, no footage), skipReason (short, e.g. "Wind too strong"; only kept while skipped, so send it with outcome "skipped"; reopening or filming clears it), journalRefs (array of Trip Log entry IDs or URLs about this shot; replaces the whole array, so send existing refs too), captured (legacy boolean: true = filmed, false = open; prefer outcome). outcomeAt is stamped by the server whenever the outcome changes; do not send it. Outcomes describe footage only, not whether an event happened.
Kit list: addGear{id?, item:{name,kind,notes?}} (optional id like "ge_tripod01" goes on the operation, not inside item, so later operations in the same batch can reference it; kind: camera|lens|support|audio|light|power|storage|other), updateGear{gearId,fields}, removeGear{gearId} (also removes it from shots). Only assign gear that is in the episode's kit list; never assume the creator owns gear they have not listed — ask instead.`,
      inputSchema: {
        episodeId,
        baseRevision: z.number().int().min(1).describe('The revision returned by your latest get_episode'),
        summary: z.string().max(500).optional().describe('Short description shown in the revision history'),
        operations: z.array(OperationSchema).min(1).max(200),
      },
    },
    async ({ episodeId, ...body }) =>
      run(async () => {
        const r = await episodes.applyChanges(principal, episodeId, body);
        return { revision: r.episode.revision, createdIds: r.created, episode: agentEpisodeView(r.episode) };
      }),
  );

  server.registerTool(
    'get_filming_checklist',
    {
      title: 'Filming checklist',
      description:
        'The filming checklist derived from the saved scenes and shots. order: "story" (default), "location" (grouped by location) or "filming" (by scene filmDay, then filmStop). None of these change the story order.',
      inputSchema: {
        episodeId,
        order: z.enum(['story', 'location', 'filming']).optional(),
        groupByLocation: z.boolean().optional().describe('Deprecated; same as order "location".'),
      },
    },
    async ({ episodeId, order, groupByLocation }) => {
      try {
        const ep = episodes.get(principal, episodeId);
        return { content: [{ type: 'text' as const, text: `Revision ${ep.revision}\n\n${checklistMarkdown(ep, checklistOrder(order ?? groupByLocation))}` }] };
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    'list_revisions',
    { title: 'Revision history', description: 'Recent revisions with author (creator or agent) and summary.', inputSchema: { episodeId } },
    async ({ episodeId }) => run(() => episodes.revisions(principal, episodeId, 50)),
  );

  server.registerTool(
    'restore_revision',
    {
      title: 'Restore revision',
      description:
        'Undo by restoring the content of an earlier revision as a NEW revision (history is kept). To undo revision N, restore N-1. If later revisions would also be reverted, the call is refused with the list; only pass acknowledgeLaterRevisions after the creator agrees.',
      inputSchema: {
        episodeId,
        targetRevision: z.number().int().min(1),
        baseRevision: z.number().int().min(1),
        acknowledgeLaterRevisions: z.boolean().optional(),
      },
    },
    async ({ episodeId, ...body }) => run(() => agentEpisodeView(episodes.restore(principal, episodeId, body))),
  );

  server.registerTool(
    'get_storyboard_schema',
    { title: 'Storyboard schema', description: 'JSON schema and guidance for storyboard documents used by saveStoryboard.', inputSchema: {} },
    async () => json(storyboardSchemaDocument()),
  );

  server.registerTool(
    'get_storyboard',
    {
      title: 'Read storyboard',
      description: "Full editable storyboard document (objects, canvas, background reference) for one scene. Use get_image with previewAssetId to see it.",
      inputSchema: { episodeId, sceneId: z.string() },
    },
    async ({ episodeId, sceneId }) =>
      run(() => {
        const ep = episodes.get(principal, episodeId);
        const scene = ep.scenes.find((s) => s.id === sceneId);
        if (!scene) throw new HttpError(404, 'Scene not found');
        return { episodeRevision: ep.revision, sceneId, storyboard: scene.storyboard };
      }),
  );

  server.registerTool(
    'get_image',
    {
      title: 'Get image',
      description:
        'Retrieve an image reference or storyboard preview by asset ID (binary content, separate from text reads). Returns a reduced copy by default; maxWidth up to 2048.',
      inputSchema: { assetId: z.string(), maxWidth: z.number().int().min(64).max(2048).optional() },
    },
    async ({ assetId, maxWidth }) => {
      const row = episodes.asset(principal, assetId);
      if (!row) return failure(new HttpError(404, 'Image not found'));
      const sharp = (await import('sharp')).default;
      const data = await sharp(assets.filePath(row))
        .rotate()
        .resize({ width: maxWidth ?? 1024, withoutEnlargement: true })
        .png()
        .toBuffer();
      return {
        content: [
          { type: 'image' as const, data: data.toString('base64'), mimeType: 'image/png' },
          { type: 'text' as const, text: `${row.kind === 'preview' ? 'Storyboard preview' : 'Reference image'} ${row.id}, original ${row.width}×${row.height}` },
        ],
      };
    },
  );

  server.registerTool(
    'upload_image',
    {
      title: 'Upload image',
      description:
        'Store a user-supplied PNG or JPEG (base64, max 10 MiB) for an episode. Returns assetId; attach it with an addImage operation in apply_changes. Do not fetch arbitrary URLs; use addLink for web references.',
      inputSchema: { episodeId, filename: z.string().max(200).optional(), base64: z.string().min(10) },
    },
    async ({ episodeId, filename, base64 }) =>
      run(async () => {
        episodes.ownsEpisode(principal, episodeId);
        const row = await assets.saveUpload(principal.user.id, episodeId, Buffer.from(base64, 'base64'), filename ?? null);
        return { assetId: row.id, mime: row.mime, width: row.width, height: row.height, bytes: row.bytes };
      }),
  );

  server.registerTool(
    'get_shot_and_cut_guide',
    {
      title: 'Shot and cut guide',
      description:
        'The shared vocabulary for shot size, camera angle, camera movement and cut types (keys, abbreviations, definitions and when to use them). Use these keys for shot size/angle/movement and scene cutToNext; the printed plan shows matching pictograms and a cut guide.',
      inputSchema: {},
    },
    async () => json(vocabularyForAgents()),
  );

  server.registerTool(
    'get_workflow_guide',
    { title: 'Workflow guide', description: 'The PlanB external-agent workflow: how to develop, review and revise a plan with the creator.', inputSchema: {} },
    async () => {
      const file = path.resolve('docs/AGENT-WORKFLOW.md');
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : INSTRUCTIONS;
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  return server;
}
