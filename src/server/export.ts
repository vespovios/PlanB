// Portable, editor-independent handoff: plan.json + plan.md + assets/ + storyboards/ in one ZIP,
// built from a single saved revision. No credentials or app URLs are embedded.
import fs from 'node:fs';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { filmSlot, outcomeBox } from '../shared/checklist.js';
import { PLAN_SCHEMA_VERSION, formatTime, outcomeCounts, outcomeSummary, type ShotOutcome, sceneNumber, sceneStarts, totalSeconds, type Episode } from '../shared/model.js';
import { STORYBOARD_SCHEMA_VERSION, describeObjects } from '../shared/storyboard.js';
import { CUT_TYPES, SHOT_ANGLES, SHOT_MOVEMENTS, SHOT_SIZES, term } from '../shared/vocab.js';
import type { AssetStore } from './assets.js';

export const EXPORT_FORMAT = 'planb.plan';

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .slice(0, 50) || 'episode';

const ext = (mime: string) => (mime === 'image/png' ? 'png' : 'jpg');

export function buildExport(episode: Episode, assets: AssetStore, appVersion: string): { filename: string; zip: Uint8Array } {
  const root = `planb-${slug(episode.title)}-r${episode.revision}`;
  const files: Zippable = {};
  const starts = sceneStarts(episode);
  const missing: string[] = [];

  const addAsset = (assetId: string, relPath: string): boolean => {
    const row = assets.get(assetId);
    if (!row || row.episode_id !== episode.id) {
      missing.push(assetId);
      return false;
    }
    try {
      files[`${root}/${relPath}`] = [fs.readFileSync(assets.filePath(row)), { level: 0 }];
      return true;
    } catch {
      missing.push(assetId);
      return false;
    }
  };

  const scenes = episode.scenes.map((scene, i) => {
    const attachments = scene.attachments.map((a) => {
      if (a.kind === 'link') return { id: a.id, kind: 'link' as const, label: a.label, caption: a.caption, url: a.url, external: true };
      const path = `assets/${a.assetId}.${ext(a.mime)}`;
      const ok = addAsset(a.assetId, path);
      return {
        id: a.id,
        kind: 'image' as const,
        label: a.label,
        caption: a.caption,
        assetId: a.assetId,
        file: ok ? path : null,
        mime: a.mime,
        bytes: a.bytes,
        width: a.width,
        height: a.height,
      };
    });
    let storyboard = null;
    if (scene.storyboard) {
      const sb = scene.storyboard;
      const base = `storyboards/${scene.id}-${sb.id}`;
      const bg = sb.backgroundAttachmentId ? attachments.find((a) => a.id === sb.backgroundAttachmentId) : null;
      const document = {
        format: 'planb.storyboard',
        schemaVersion: STORYBOARD_SCHEMA_VERSION,
        storyboardId: sb.id,
        sceneId: scene.id,
        savedRevision: sb.savedRevision,
        width: sb.width,
        height: sb.height,
        background: bg && bg.kind === 'image' ? { attachmentId: bg.id, file: bg.file ? `../${bg.file}` : null, fit: 'contain' } : null,
        description: sb.description,
        objects: sb.objects,
      };
      files[`${root}/${base}.json`] = strToU8(JSON.stringify(document, null, 2));
      const previewOk = addAsset(sb.previewAssetId, `${base}.png`);
      storyboard = {
        id: sb.id,
        document: `${base}.json`,
        preview: previewOk ? `${base}.png` : null,
        savedRevision: sb.savedRevision,
        backgroundAttachmentId: sb.backgroundAttachmentId,
        description: sb.description,
        summary: describeObjects(sb.objects),
      };
    }
    const counts = outcomeCounts(scene.shots);
    return {
      id: scene.id,
      number: sceneNumber(i),
      order: i,
      title: scene.title,
      startSeconds: starts[i],
      durationSeconds: scene.durationSeconds,
      status: scene.status,
      description: scene.description,
      purpose: scene.purpose,
      notes: scene.notes,
      voiceover: scene.voiceover,
      audio: scene.audio,
      location: scene.location,
      thumbnailAttachmentId: scene.thumbnailAttachmentId,
      cutToNext: scene.cutToNext ?? null,
      filmDay: scene.filmDay ?? null,
      filmStop: scene.filmStop ?? null,
      capturedShots: counts.filmed,
      skippedShots: counts.skipped,
      openShots: counts.open,
      totalShots: counts.total,
      shots: scene.shots.map((s, j) => ({ ...s, size: s.size ?? null, angle: s.angle ?? null, movement: s.movement ?? null, gear: s.gear ?? [], order: j })),
      attachments,
      storyboard,
    };
  });

  const plan = {
    format: EXPORT_FORMAT,
    schemaVersion: PLAN_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: `PlanB ${appVersion}`,
    notes:
      'Canonical PlanB planning data. Paths are relative to this file. Shot "outcome": "open" = no outcome yet, "filmed" = the creator reported filming it (footage not reviewed), "skipped" = deliberately dropped, so no footage exists (see skipReason and journalRefs). "captured" mirrors outcome === "filmed". This is not a native editor project.',
    episode: {
      id: episode.id,
      revision: episode.revision,
      savedAt: episode.updatedAt,
      title: episode.title,
      brief: episode.brief,
      outline: episode.outline,
      notes: episode.notes,
      status: episode.status,
      targetSeconds: episode.targetSeconds,
      totalSeconds: totalSeconds(episode),
    },
    gear: (episode.gear ?? []).map(({ id, name, kind, notes }) => ({ id, name, kind, notes })),
    scenes,
    missingAssets: missing,
  };
  files[`${root}/plan.json`] = strToU8(JSON.stringify(plan, null, 2));
  files[`${root}/plan.md`] = strToU8(planMarkdown(plan));
  return { filename: `${root}.zip`, zip: zipSync(files, { level: 6 }) };
}

type Plan = {
  gear: { id: string; name: string; kind: string; notes: string }[];
  episode: { title: string; revision: number; brief: string; outline: string; notes: string; status: string; targetSeconds: number | null; totalSeconds: number; id: string };
  scenes: {
    id: string;
    number: string;
    title: string;
    startSeconds: number;
    durationSeconds: number;
    status: string;
    description: string;
    purpose: string;
    notes: string;
    voiceover: string;
    audio: string;
    location: string;
    capturedShots: number;
    skippedShots: number;
    openShots: number;
    totalShots: number;
    cutToNext: string | null;
    filmDay: number | null;
    filmStop: number | null;
    shots: { description: string; framing: string; size: string | null; angle: string | null; movement: string | null; gear: string[]; cameraNotes: string; priority: string; captured: boolean; outcome: ShotOutcome; skipReason: string; outcomeAt: string | null; journalRefs: string[]; id: string }[];
    attachments: ({ kind: 'link'; label: string; url: string; caption: string } | { kind: 'image'; label: string; file: string | null; caption: string })[];
    storyboard: { preview: string | null; document: string; description: string; summary: string } | null;
  }[];
};

const quote = (s: string) =>
  s
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

export function planMarkdown(plan: Plan): string {
  const e = plan.episode;
  const out: string[] = [
    `# ${e.title}`,
    '',
    `PlanB episode \`${e.id}\` · revision ${e.revision} · ${e.status === 'ready' ? 'ready for filming' : 'draft'} · planned ${formatTime(e.totalSeconds)}${e.targetSeconds ? ` (target ${formatTime(e.targetSeconds)})` : ''}`,
    '',
  ];
  if (e.brief) out.push('## Brief', '', e.brief, '');
  if (e.outline) out.push('## Story outline', '', e.outline, '');
  if (e.notes) out.push('## Loose notes', '', e.notes, '');
  if (plan.gear.length) {
    out.push('## Kit list', '');
    for (const g of plan.gear) out.push(`- [ ] **${g.name}** (${g.kind})${g.notes ? ` — ${g.notes}` : ''}`);
    out.push('');
  }
  const gearName = new Map(plan.gear.map((g) => [g.id, g.name]));
  out.push('## Scenes', '');
  for (const s of plan.scenes) {
    out.push(`### ${s.number} · ${s.title}`, '');
    out.push(
      `\`${s.id}\` · ${formatTime(s.startSeconds)}–${formatTime(s.startSeconds + s.durationSeconds)} (${formatTime(s.durationSeconds)}) · ${s.status === 'ready' ? 'ready to film' : 'draft'} · ${outcomeSummary({ filmed: s.capturedShots, skipped: s.skippedShots, open: s.openShots, total: s.totalShots })}`,
      '',
    );
    if (s.storyboard?.preview) out.push(`![Storyboard for ${s.title}](${s.storyboard.preview})`, '');
    if (s.storyboard?.description) out.push(`*Storyboard:* ${s.storyboard.description}`, '');
    const field = (label: string, v: string) => v && out.push(`**${label}:**`, '', quote(v), '');
    field('Purpose', s.purpose);
    field('What happens', s.description);
    field('Location / route', s.location);
    field('Filming order', filmSlot(s));
    field('Voice-over', s.voiceover);
    field('Audio / music', s.audio);
    field('Notes', s.notes);
    if (s.shots.length) {
      out.push('**Shots:**', '');
      s.shots.forEach((sh) => {
        const spec = [term(SHOT_SIZES, sh.size)?.abbr, term(SHOT_ANGLES, sh.angle)?.abbr, term(SHOT_MOVEMENTS, sh.movement)?.abbr].filter(Boolean).join(' ');
        const outcome = sh.outcome === 'filmed' ? 'filmed (reported)' : sh.outcome === 'skipped' ? `skipped${sh.skipReason ? `: ${sh.skipReason}` : ''}` : 'open';
        const meta = [spec, sh.framing, sh.priority, outcome].filter(Boolean).join(' · ');
        const kit = sh.gear.map((id) => gearName.get(id)).filter(Boolean).join(', ');
        out.push(`- ${outcomeBox(sh)} ${sh.description} — ${meta}${sh.journalRefs.length ? ` — journal: ${sh.journalRefs.join(', ')}` : ''}${sh.cameraNotes ? ` — ${sh.cameraNotes}` : ''}${kit ? ` — gear: ${kit}` : ''}`);
      });
      out.push('');
    }
    const cut = term(CUT_TYPES, s.cutToNext);
    if (cut) out.push(`**Cut to next scene:** ${cut.label} — ${cut.use}`, '');
    if (s.attachments.length) {
      out.push('**References:**', '');
      for (const a of s.attachments) {
        if (a.kind === 'link') out.push(`- External link: [${a.label}](${a.url})${a.caption ? ` — ${a.caption}` : ''}`);
        else if (a.file) out.push(`- Image: [${a.label || a.file}](${a.file})${a.caption ? ` — ${a.caption}` : ''}`);
        else out.push(`- Image: ${a.label || 'untitled'} (file missing from export)`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}
