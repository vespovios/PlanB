// Filming checklist derived directly from the saved scenes and shots.
import { capturedCount, formatTime, sceneNumber, sceneStarts, type EpisodeDoc, type Scene } from './model.js';

export interface ChecklistScene {
  number: string;
  index: number;
  start: number;
  scene: Scene;
}
export interface ChecklistGroup {
  location: string | null;
  scenes: ChecklistScene[];
}

/** Story order by default. Location grouping keeps story order inside each group and never changes saved order. */
export function buildChecklist(doc: EpisodeDoc, groupByLocation = false): ChecklistGroup[] {
  const starts = sceneStarts(doc);
  const items = doc.scenes.map((scene, index) => ({ number: sceneNumber(index), index, start: starts[index], scene }));
  if (!groupByLocation) return [{ location: null, scenes: items }];
  const groups = new Map<string, ChecklistGroup>();
  for (const item of items) {
    const label = item.scene.location.trim();
    const key = label.toLowerCase() || '\u0000none';
    if (!groups.has(key)) groups.set(key, { location: label || null, scenes: [] });
    groups.get(key)!.scenes.push(item);
  }
  // Unlocated scenes go last so located groups read as a filming route.
  return [...groups.values()].sort((a, b) => Number(a.location === null) - Number(b.location === null));
}

export function checklistMarkdown(doc: EpisodeDoc, groupByLocation = false): string {
  const lines: string[] = [`# Filming checklist: ${doc.title}`, ''];
  lines.push('Captured means the creator reports the shot was filmed; it does not mean the footage has been reviewed.', '');
  for (const group of buildChecklist(doc, groupByLocation)) {
    if (groupByLocation) lines.push(`## Location: ${group.location ?? 'No location given'}`, '');
    for (const { number, start, scene } of group.scenes) {
      const { captured, total } = capturedCount(scene);
      lines.push(
        `${groupByLocation ? '###' : '##'} ${number} ${scene.title} (${scene.id})`,
        `${formatTime(start)}–${formatTime(start + scene.durationSeconds)} · ${formatTime(scene.durationSeconds)} · planning status: ${scene.status} · captured ${captured}/${total}`,
      );
      if (scene.location && !groupByLocation) lines.push(`Location: ${scene.location}`);
      if (scene.purpose) lines.push(`Purpose: ${scene.purpose}`);
      if (scene.description) lines.push(`What happens: ${scene.description}`);
      if (scene.audio) lines.push(`Audio/music: ${scene.audio}`);
      if (scene.voiceover) lines.push(`Voice-over: ${scene.voiceover}`);
      lines.push('');
      for (const shot of scene.shots) {
        const extra = [shot.framing, shot.priority, shot.cameraNotes].filter(Boolean).join(' · ');
        lines.push(`- [${shot.captured ? 'x' : ' '}] ${shot.description}${extra ? ` (${extra})` : ''} [${shot.id}]`);
      }
      if (!scene.shots.length) lines.push('- No shots listed');
      lines.push('');
    }
  }
  return lines.join('\n');
}
