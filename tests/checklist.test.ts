import { describe, expect, it } from 'vitest';
import { buildChecklist, checklistMarkdown, checklistOrder, filmSlot } from '../src/shared/checklist.js';
import { EpisodeDocSchema } from '../src/shared/model.js';
import { OperationSchema, applyOperations } from '../src/shared/ops.js';

const scene = (id: string, title: string, location: string, filmDay: number | null, filmStop: number | null) => ({
  id,
  title,
  durationSeconds: 30,
  location,
  filmDay,
  filmStop,
});
const doc = EpisodeDocSchema.parse({
  title: 'Trip',
  scenes: [
    scene('sc_opening', 'Cold open', 'Cape', 1, 5),
    scene('sc_ferryxx', 'Ferry', 'Port', 1, 1),
    scene('sc_roadxxx', 'Road', 'Cape', 1, 2),
    scene('sc_homexxx', 'Home', 'Port', 2, 1),
    scene('sc_extraxx', 'Extra', '', null, null),
  ],
});

describe('filming order', () => {
  it('lists scenes by day, then stop, keeping story numbers; unscheduled last', () => {
    const groups = buildChecklist(doc, 'filming');
    expect(groups.map((g) => g.label)).toEqual(['Day 1', 'Day 2', null]);
    expect(groups[0].scenes.map((s) => `${s.number} ${s.scene.title}`)).toEqual(['S02 Ferry', 'S03 Road', 'S01 Cold open']);
    expect(groups[2].scenes.map((s) => s.scene.title)).toEqual(['Extra']);
    // Story order itself is untouched.
    expect(buildChecklist(doc)[0].scenes.map((s) => s.scene.title)).toEqual(['Cold open', 'Ferry', 'Road', 'Home', 'Extra']);
  });

  it('keeps location grouping and the old boolean option working', () => {
    expect(buildChecklist(doc, 'location').map((g) => g.label)).toEqual(['Cape', 'Port', null]);
    expect(checklistOrder(true)).toBe('location');
    expect(checklistOrder('1')).toBe('location');
    expect(checklistOrder('filming')).toBe('filming');
    expect(checklistOrder(undefined)).toBe('story');
  });

  it('labels slots and prints them in the Markdown checklist', () => {
    expect(filmSlot({ filmDay: 1, filmStop: 3 })).toBe('Day 1 · stop 3');
    expect(filmSlot({ filmDay: 2, filmStop: null })).toBe('Day 2');
    expect(filmSlot({ filmDay: null, filmStop: null })).toBe('');
    const md = checklistMarkdown(doc, 'filming');
    expect(md).toContain('## Day 1');
    expect(md).toContain('## No filming day set');
    expect(md.indexOf('S02 Ferry')).toBeLessThan(md.indexOf('S01 Cold open'));
    expect(md).toContain('filming: Day 1 · stop 5');
    expect(md).toContain('edit position 00:00–00:30 · 00:30 on screen');
    expect(checklistMarkdown(doc)).not.toContain('edit position');
  });

  it('is set per scene with updateScene and validated', () => {
    const op = OperationSchema.parse({ op: 'updateScene', sceneId: 'sc_extraxx', fields: { filmDay: 2, filmStop: 2 } });
    const ok = applyOperations(doc, [op], { newId: () => 'sc_new', nextRevision: 2 });
    expect(ok.doc.scenes[4]).toMatchObject({ filmDay: 2, filmStop: 2 });
    expect(OperationSchema.safeParse({ op: 'updateScene', sceneId: 'sc_extraxx', fields: { filmDay: 0 } }).success).toBe(false);
    expect(OperationSchema.safeParse({ op: 'updateScene', sceneId: 'sc_extraxx', fields: { filmStop: null } }).success).toBe(true);
  });
});
