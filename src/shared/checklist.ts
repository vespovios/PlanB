// Filming checklist derived directly from the saved scenes and shots.
import { capturedCount, formatTime, sceneNumber, sceneStarts, type EpisodeDoc, type Scene } from './model.js';

export interface ChecklistScene {
  number: string;
  index: number;
  start: number;
  scene: Scene;
}
export interface ChecklistGroup {
  /** Group heading: the location, or "Day 2", or null for the single story-order group / unassigned scenes. */
  label: string | null;
  scenes: ChecklistScene[];
}

/** story: story order. location: grouped by location. filming: by filming day, then stop. */
export type ChecklistOrder = 'story' | 'location' | 'filming';

/** None of the orders change the saved story order; scene numbers (S01…) always follow the story. */
export function buildChecklist(doc: EpisodeDoc, order: ChecklistOrder = 'story'): ChecklistGroup[] {
  const starts = sceneStarts(doc);
  const items = doc.scenes.map((scene, index) => ({ number: sceneNumber(index), index, start: starts[index], scene }));
  if (order === 'filming') {
    const sorted = [...items].sort(
      (a, b) =>
        (a.scene.filmDay ?? 1e3) - (b.scene.filmDay ?? 1e3) ||
        (a.scene.filmStop ?? 1e3) - (b.scene.filmStop ?? 1e3) ||
        a.index - b.index,
    );
    const groups: ChecklistGroup[] = [];
    for (const item of sorted) {
      const label = item.scene.filmDay ? `Day ${item.scene.filmDay}` : null;
      if (groups.at(-1)?.label !== label || !groups.length) groups.push({ label, scenes: [] });
      groups.at(-1)!.scenes.push(item);
    }
    return groups;
  }
  if (order !== 'location') return [{ label: null, scenes: items }];
  const groups = new Map<string, ChecklistGroup>();
  for (const item of items) {
    const label = item.scene.location.trim();
    const key = label.toLowerCase() || '\u0000none';
    if (!groups.has(key)) groups.set(key, { label: label || null, scenes: [] });
    groups.get(key)!.scenes.push(item);
  }
  // Unlocated scenes go last so located groups read as a filming route.
  return [...groups.values()].sort((a, b) => Number(a.label === null) - Number(b.label === null));
}

/** "Day 1 · stop 3", "Day 2", or "" when the scene has no filming slot. */
export function filmSlot(scene: Pick<Scene, 'filmDay' | 'filmStop'>): string {
  if (!scene.filmDay) return scene.filmStop ? `Stop ${scene.filmStop}` : '';
  return scene.filmStop ? `Day ${scene.filmDay} · stop ${scene.filmStop}` : `Day ${scene.filmDay}`;
}

/** Accepts the old boolean (group by location) as well as an order name. */
export function checklistOrder(value: unknown): ChecklistOrder {
  if (value === true || value === 'true' || value === '1') return 'location';
  return value === 'location' || value === 'filming' ? value : 'story';
}

export function checklistMarkdown(doc: EpisodeDoc, order: ChecklistOrder = 'story'): string {
  const lines: string[] = [`# Filming checklist: ${doc.title}`, ''];
  lines.push('Captured means the creator reports the shot was filmed; it does not mean the footage has been reviewed.', '');
  if (order === 'filming') lines.push('In filming order (day, then stop). Scene numbers follow the story.', '');
  const grouped = order !== 'story';
  for (const group of buildChecklist(doc, order)) {
    if (order === 'location') lines.push(`## Location: ${group.label ?? 'No location given'}`, '');
    if (order === 'filming') lines.push(`## ${group.label ?? 'No filming day set'}`, '');
    for (const { number, start, scene } of group.scenes) {
      const { captured, total } = capturedCount(scene);
      const slot = filmSlot(scene);
      lines.push(
        `${grouped ? '###' : '##'} ${number} ${scene.title} (${scene.id})`,
        `${order === 'filming' ? 'edit position ' : ''}${formatTime(start)}–${formatTime(start + scene.durationSeconds)} · ${formatTime(scene.durationSeconds)}${order === 'filming' ? ' on screen' : ''} · planning status: ${scene.status} · captured ${captured}/${total}${slot ? ` · filming: ${slot}` : ''}`,
      );
      if (scene.location && order !== 'location') lines.push(`Location: ${scene.location}`);
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
