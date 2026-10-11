// Reads the optional five-line story (Setup, Desire, Conflict, Change, Result) out of the
// free-text outline. Nothing is stored separately: the outline stays plain text and the
// five lines are only recognised when the creator or agent wrote them with these labels.

export const FIVE_LINES = [
  { key: 'setup', label: 'Setup', aliases: ['setup', 'situation'] },
  { key: 'desire', label: 'Desire', aliases: ['desire', 'want'] },
  { key: 'conflict', label: 'Conflict', aliases: ['conflict', 'obstacle'] },
  { key: 'change', label: 'Change', aliases: ['change', 'turn', 'turning point'] },
  { key: 'result', label: 'Result', aliases: ['result', 'outcome', 'ending'] },
] as const;

export interface FiveLine {
  key: (typeof FIVE_LINES)[number]['key'];
  label: string;
  text: string;
  /** Scene numbers mentioned in the line, e.g. "S02–S04" → [2, 3, 4]. */
  scenes: number[];
}

const LABEL = new RegExp(
  `^\\s*(?:\\d+[.)]\\s*)?(${FIVE_LINES.flatMap((l) => l.aliases).join('|')})\\s*[:—–-]\\s*(.*)$`,
  'i',
);

function sceneRefs(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\bS(\d{1,3})(?:\s*[–—-]\s*S?(\d{1,3}))?\b/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 50; n++) found.add(n);
  }
  return [...found].sort((x, y) => x - y);
}

/** Returns the five lines when at least three of them have text; otherwise null. */
export function parseFiveLines(outline: string): FiveLine[] | null {
  const byKey = new Map<string, string[]>();
  let current: string | null = null;
  for (const raw of outline.split(/\r?\n/)) {
    const m = raw.match(LABEL);
    if (m) {
      const alias = m[1].toLowerCase();
      current = FIVE_LINES.find((l) => (l.aliases as readonly string[]).includes(alias))!.key;
      if (!byKey.has(current)) byKey.set(current, []);
      if (m[2].trim()) byKey.get(current)!.push(m[2].trim());
    } else if (current && raw.trim()) {
      byKey.get(current)!.push(raw.trim());
    } else if (!raw.trim()) {
      current = null; // a blank line ends a beat's continuation
    }
  }
  const lines = FIVE_LINES.map((l) => {
    const text = (byKey.get(l.key) ?? []).join(' ');
    return { key: l.key, label: l.label, text, scenes: sceneRefs(text) };
  });
  return lines.filter((l) => l.text).length >= 3 ? lines : null;
}
