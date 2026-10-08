// Simple per-scene storyboard editor on a fixed canvas. Works with mouse, pen and touch
// via Pointer Events. The document is saved as editable objects; the server renders the PNG.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageAttachment, Scene } from '../../shared/model';
import { randomId } from '../../shared/ids';
import {
  DEFAULT_CANVAS,
  STORYBOARD_COLOURS,
  STORYBOARD_SCHEMA_VERSION,
  STROKE_WIDTHS,
  objectBounds,
  objectToSvg,
  type StoryboardInput,
  type StoryboardObject,
} from '../../shared/storyboard';
import { ApiError, api, assetUrl } from '../api';
import type { EpisodeSync } from '../sync';
import { Confirm, capturePointer } from '../components/ui';

type Tool = 'select' | 'freehand' | 'arrow' | 'rect' | 'ellipse' | 'text';
type Pt = { x: number; y: number };

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select / move', icon: '➚' },
  { id: 'freehand', label: 'Freehand', icon: '✎' },
  { id: 'arrow', label: 'Arrow', icon: '→' },
  { id: 'rect', label: 'Rectangle', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse', icon: '◯' },
  { id: 'text', label: 'Text', icon: 'T' },
];

interface Doc {
  width: number;
  height: number;
  backgroundAttachmentId: string | null;
  description: string;
  objects: StoryboardObject[];
}

const draftKey = (episodeId: string, sceneId: string) => `planb:storyboard-draft:${episodeId}:${sceneId}`;

function fromScene(scene: Scene): Doc {
  const sb = scene.storyboard;
  return sb
    ? { width: sb.width, height: sb.height, backgroundAttachmentId: sb.backgroundAttachmentId, description: sb.description, objects: sb.objects }
    : { ...DEFAULT_CANVAS, backgroundAttachmentId: null, description: '', objects: [] };
}

// --- geometry -----------------------------------------------------------------------

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function hit(o: StoryboardObject, p: Pt, tol: number): boolean {
  switch (o.type) {
    case 'freehand':
      for (let i = 0; i + 3 < o.points.length || i === 0; i += 2) {
        const a = { x: o.points[i], y: o.points[i + 1] };
        const b = i + 3 < o.points.length ? { x: o.points[i + 2], y: o.points[i + 3] } : a;
        if (distToSegment(p, a, b) <= tol + o.width / 2) return true;
        if (i + 3 >= o.points.length) break;
      }
      return false;
    case 'arrow':
      return distToSegment(p, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) <= tol + o.width / 2;
    case 'ellipse': {
      const rx = o.w / 2 + tol;
      const ry = o.h / 2 + tol;
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      return ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
    }
    default: {
      const b = objectBounds(o);
      return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    }
  }
}

function translate(o: StoryboardObject, dx: number, dy: number): StoryboardObject {
  switch (o.type) {
    case 'freehand':
      return { ...o, points: o.points.map((v, i) => v + (i % 2 ? dy : dx)) };
    case 'arrow':
      return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
    default:
      return { ...o, x: o.x + dx, y: o.y + dy };
  }
}

/** Scales an object so its bounds grow from the top-left corner to the dragged corner. */
function scaleTo(o: StoryboardObject, orig: StoryboardObject, corner: Pt): StoryboardObject {
  const b = objectBounds(orig);
  const sx = Math.max(0.05, (corner.x - b.x) / b.w);
  const sy = Math.max(0.05, (corner.y - b.y) / b.h);
  switch (orig.type) {
    case 'freehand':
      return { ...orig, points: orig.points.map((v, i) => (i % 2 ? b.y + (v - b.y) * sy : b.x + (v - b.x) * sx)) };
    case 'rect':
    case 'ellipse':
      return { ...orig, w: Math.max(4, orig.w * sx), h: Math.max(4, orig.h * sy) };
    case 'text':
      return { ...orig, size: Math.min(300, Math.max(8, Math.round(orig.size * sy))) };
    default:
      return o;
  }
}

const round = (o: StoryboardObject): StoryboardObject => {
  const r = (v: number) => Math.round(v * 10) / 10;
  switch (o.type) {
    case 'freehand':
      return { ...o, points: o.points.map(r) };
    case 'arrow':
      return { ...o, x1: r(o.x1), y1: r(o.y1), x2: r(o.x2), y2: r(o.y2) };
    case 'text':
      return { ...o, x: r(o.x), y: r(o.y) };
    default:
      return { ...o, x: r(o.x), y: r(o.y), w: r(o.w), h: r(o.h) };
  }
};

type Gesture =
  | { kind: 'draw'; id: string; start: Pt }
  | { kind: 'move'; id: string; last: Pt; moved: boolean }
  | { kind: 'resize'; id: string; orig: StoryboardObject }
  | { kind: 'endpoint'; id: string; end: 1 | 2 };

// --- component ----------------------------------------------------------------------

export function StoryboardEditor({ scene, engine, episodeId, onClose }: { scene: Scene; engine: EpisodeSync; episodeId: string; onClose: () => void }) {
  const saved = useMemo(() => fromScene(scene), []); // the version this editing session started from
  const startRevision = scene.storyboard?.savedRevision ?? null;
  const [doc, setDoc] = useState<Doc>(saved);
  const [past, setPast] = useState<StoryboardObject[][]>([]);
  const [future, setFuture] = useState<StoryboardObject[][]>([]);
  const [tool, setTool] = useState<Tool>(scene.storyboard ? 'select' : 'freehand');
  const [colour, setColour] = useState<string>(STORYBOARD_COLOURS[1]);
  const [width, setWidth] = useState<number>(STROKE_WIDTHS[1]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  // Refs, not state: pointer events can arrive faster than React re-renders.
  const gestureRef = useRef<Gesture | null>(null);
  const drawnRef = useRef<StoryboardObject | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleChoice, setStaleChoice] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [restorable, setRestorable] = useState<{ doc: Doc; at: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const images = scene.attachments.filter((a): a is ImageAttachment => a.kind === 'image');
  const dirty = JSON.stringify(doc) !== JSON.stringify(saved);

  // Offer to recover a drawing that was not saved (closed tab, failed save, lost connection).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(episodeId, scene.id));
      if (raw) {
        const d = JSON.parse(raw) as { doc: Doc; at: string };
        if (JSON.stringify(d.doc) !== JSON.stringify(saved)) setRestorable(d);
        else localStorage.removeItem(draftKey(episodeId, scene.id));
      }
    } catch {
      /* ignore corrupt draft */
    }
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => localStorage.setItem(draftKey(episodeId, scene.id), JSON.stringify({ doc, at: new Date().toISOString() })), 300);
    return () => clearTimeout(t);
  }, [doc, dirty]);

  // Prevent page scroll / pull-to-refresh behind the full-screen editor on phones.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const commitObjects = useCallback(
    (next: StoryboardObject[]) => {
      setPast((p) => [...p.slice(-99), doc.objects]);
      setFuture([]);
      setDoc((d) => ({ ...d, objects: next }));
    },
    [doc.objects],
  );
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [doc.objects, ...f]);
    setDoc((d) => ({ ...d, objects: past[past.length - 1] }));
    setPast((p) => p.slice(0, -1));
    setSelected(null);
    setEditingText(null);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, doc.objects]);
    setDoc((d) => ({ ...d, objects: future[0] }));
    setFuture((f) => f.slice(1));
  };
  const remove = () => {
    if (!selected) return;
    commitObjects(doc.objects.filter((o) => o.id !== selected));
    setSelected(null);
    setEditingText(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('textarea, input')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        remove();
      } else if (e.key === 'Escape') {
        if (selected || editingText) {
          setSelected(null);
          setEditingText(null);
        } else if (!confirmCancel && !staleChoice) cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (editingText) setTimeout(() => textRef.current?.focus(), 0);
  }, [editingText]);

  const toCanvas = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };
  /** Canvas units per screen pixel, so hit tolerance feels the same at any display size. */
  const unit = () => {
    const svg = svgRef.current;
    if (!svg) return 1;
    const r = svg.getBoundingClientRect();
    return Math.max(doc.width / r.width, doc.height / r.height);
  };

  const update = (id: string, fn: (o: StoryboardObject) => StoryboardObject) =>
    setDoc((d) => ({ ...d, objects: d.objects.map((o) => (o.id === id ? fn(o) : o)) }));

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    capturePointer(svgRef.current, e.pointerId);
    const p = toCanvas(e);
    const tol = 10 * unit();
    if (tool === 'select') {
      const sel = doc.objects.find((o) => o.id === selected);
      if (sel) {
        if (sel.type === 'arrow') {
          if (Math.hypot(p.x - sel.x1, p.y - sel.y1) <= tol * 2) return void (gestureRef.current = { kind: 'endpoint', id: sel.id, end: 1 }), pushUndo();
          if (Math.hypot(p.x - sel.x2, p.y - sel.y2) <= tol * 2) return void (gestureRef.current = { kind: 'endpoint', id: sel.id, end: 2 }), pushUndo();
        } else {
          const b = objectBounds(sel);
          if (Math.hypot(p.x - (b.x + b.w), p.y - (b.y + b.h)) <= tol * 2.2) return void (gestureRef.current = { kind: 'resize', id: sel.id, orig: sel }), pushUndo();
        }
      }
      const target = [...doc.objects].reverse().find((o) => hit(o, p, tol));
      setSelected(target?.id ?? null);
      if (target?.type !== 'text' || target.id !== editingText) setEditingText(null);
      if (target) {
        pushUndo();
        gestureRef.current = { kind: 'move', id: target.id, last: p, moved: false };
      }
      return;
    }
    if (tool === 'text') {
      const id = randomId('tx', 8);
      commitObjects([...doc.objects, { id, type: 'text', x: p.x, y: p.y, text: 'Label', color: colour, size: 44 }]);
      setSelected(id);
      setEditingText(id);
      setTool('select');
      return;
    }
    const id = randomId(tool.slice(0, 2), 8);
    const base = { id, color: colour, width };
    const obj: StoryboardObject =
      tool === 'freehand'
        ? { ...base, type: 'freehand', points: [p.x, p.y] }
        : tool === 'arrow'
          ? { ...base, type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y }
          : { ...base, type: tool, x: p.x, y: p.y, w: 1, h: 1 };
    pushUndo();
    setDoc((d) => ({ ...d, objects: [...d.objects, obj] }));
    drawnRef.current = obj;
    gestureRef.current = { kind: 'draw', id, start: p };
  };

  /** Records the current objects for undo before a gesture changes them. */
  const pushUndo = () => {
    setPast((ps) => [...ps.slice(-99), doc.objects]);
    setFuture([]);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const p = toCanvas(e);
    if (gesture.kind === 'draw') {
      const next = ((o: StoryboardObject): StoryboardObject => {
        if (o.type === 'freehand') {
          const lx = o.points[o.points.length - 2];
          const ly = o.points[o.points.length - 1];
          if (Math.hypot(p.x - lx, p.y - ly) < 1.5 * unit() || o.points.length >= 7998) return o;
          return { ...o, points: [...o.points, p.x, p.y] };
        }
        if (o.type === 'arrow') return { ...o, x2: p.x, y2: p.y };
        if (o.type === 'rect' || o.type === 'ellipse') {
          const s = gesture.start;
          return { ...o, x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.max(1, Math.abs(p.x - s.x)), h: Math.max(1, Math.abs(p.y - s.y)) };
        }
        return o;
      })(drawnRef.current!);
      drawnRef.current = next;
      update(gesture.id, () => next);
    } else if (gesture.kind === 'move') {
      const dx = p.x - gesture.last.x;
      const dy = p.y - gesture.last.y;
      update(gesture.id, (o) => translate(o, dx, dy));
      gestureRef.current = { ...gesture, last: p, moved: true };
    } else if (gesture.kind === 'resize') {
      update(gesture.id, (o) => scaleTo(o, gesture.orig, p));
    } else if (gesture.kind === 'endpoint') {
      update(gesture.id, (o) => (o.type !== 'arrow' ? o : gesture.end === 1 ? { ...o, x1: p.x, y1: p.y } : { ...o, x2: p.x, y2: p.y }));
    }
  };

  const onPointerUp = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    if (gesture.kind === 'draw') {
      const o = drawnRef.current;
      drawnRef.current = null;
      const tiny =
        !o ||
        (o.type === 'arrow' && Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 6 * unit()) ||
        ((o.type === 'rect' || o.type === 'ellipse') && (o.w < 4 * unit() || o.h < 4 * unit()));
      if (tiny) {
        setDoc((d) => ({ ...d, objects: d.objects.filter((x) => x.id !== gesture.id) }));
        setPast((ps) => ps.slice(0, -1));
      } else update(gesture.id, round);
    } else if (gesture.kind === 'move' && !gesture.moved) {
      setPast((ps) => ps.slice(0, -1)); // a tap only selects
      const o = doc.objects.find((x) => x.id === gesture.id);
      if (o?.type === 'text' && selected === o.id) setEditingText(o.id); // tap a selected label to edit it
    } else update(gesture.id, round);
  };

  const applyStyle = (patch: { color?: string; width?: number }) => {
    if (patch.color) setColour(patch.color);
    if (patch.width) setWidth(patch.width);
    const sel = doc.objects.find((o) => o.id === selected);
    if (!sel) return;
    commitObjects(
      doc.objects.map((o) => {
        if (o.id !== selected) return o;
        if (o.type === 'text') return { ...o, color: patch.color ?? o.color };
        return { ...o, color: patch.color ?? o.color, width: patch.width ?? o.width };
      }),
    );
  };

  const uploadBackground = async (file: File) => {
    setError(null);
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setError('Only PNG and JPEG images can be used.');
    if (file.size > 10 * 1024 * 1024) return setError('Images can be at most 10 MiB.');
    setUploading(true);
    try {
      const { asset } = await api.upload(episodeId, file, file.name);
      const id = randomId('at');
      engine.rememberAsset(asset.id, asset);
      // The photo is stored as a scene reference so the drawing can point at it.
      await engine.commitNow(
        [{ op: 'addImage', sceneId: scene.id, id, assetId: asset.id, label: file.name.replace(/\.[^.]+$/, '').slice(0, 80) }],
        `Added image reference to "${scene.title}"`,
      );
      setDoc((d) => ({ ...d, backgroundAttachmentId: id }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async (force = false) => {
    setSaving(true);
    setError(null);
    const storyboard: StoryboardInput = {
      schemaVersion: STORYBOARD_SCHEMA_VERSION,
      width: doc.width,
      height: doc.height,
      backgroundAttachmentId: doc.backgroundAttachmentId,
      description: doc.description.trim(),
      objects: doc.objects.map(round),
    };
    const attempt = () => engine.commitNow([{ op: 'saveStoryboard', sceneId: scene.id, storyboard }], `Saved storyboard for "${scene.title}"`);
    try {
      const current = engine.confirmed?.scenes.find((s) => s.id === scene.id)?.storyboard?.savedRevision ?? null;
      if (!force && current !== startRevision) {
        setStaleChoice(true);
        return;
      }
      try {
        await attempt();
      } catch (e) {
        const err = e as ApiError;
        if (err.status !== 409 || err.body.code === 'pending_edits') throw err;
        // Someone saved first. If they didn't touch this drawing, saving on top is safe; otherwise ask.
        const now = engine.confirmed?.scenes.find((s) => s.id === scene.id);
        if (!now) throw new ApiError(404, 'This scene was deleted elsewhere. Your drawing is still here; copy what you need, then cancel.');
        if (!force && (now.storyboard?.savedRevision ?? null) !== startRevision) {
          setStaleChoice(true);
          return;
        }
        await attempt();
      }
      localStorage.removeItem(draftKey(episodeId, scene.id));
      onClose();
    } catch (e) {
      setError(`Not saved: ${(e as Error).message} Your drawing is still here.`);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (dirty) setConfirmCancel(true);
    else onClose();
  };

  const selectedObj = doc.objects.find((o) => o.id === selected);
  const editingObj = doc.objects.find((o) => o.id === editingText && o.type === 'text') as Extract<StoryboardObject, { type: 'text' }> | undefined;
  const bg = images.find((a) => a.id === doc.backgroundAttachmentId);
  const u = unit();

  return (
    <div className="sb-overlay" role="dialog" aria-modal="true" aria-label={`Storyboard for ${scene.title}`}>
      <div className="sb-editor">
        <header className="sb-head">
          <button type="button" className="btn ghost" onClick={cancel}>
            ← Cancel
          </button>
          <h2>Storyboard · {scene.title}</h2>
          <button type="button" className="btn primary" disabled={saving || uploading} onClick={() => save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </header>

        <div className="sb-toolbar" role="toolbar" aria-label="Drawing tools">
          <div className="sb-group">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`sb-tool ${tool === t.id ? 'on' : ''}`}
                aria-pressed={tool === t.id}
                aria-label={t.label}
                title={t.label}
                onClick={() => {
                  setTool(t.id);
                  if (t.id !== 'select') {
                    setSelected(null);
                    setEditingText(null);
                  }
                }}
              >
                {t.icon}
              </button>
            ))}
          </div>
          <div className="sb-group">
            {STORYBOARD_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                className={`sb-colour ${colour === c ? 'on' : ''}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                aria-pressed={colour === c}
                onClick={() => applyStyle({ color: c })}
              />
            ))}
          </div>
          <div className="sb-group">
            {STROKE_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={`sb-tool ${width === w ? 'on' : ''}`}
                aria-label={`Stroke width ${w}`}
                aria-pressed={width === w}
                onClick={() => applyStyle({ width: w })}
              >
                <span className="sb-width" style={{ height: Math.max(2, w / 1.5) }} />
              </button>
            ))}
          </div>
          <div className="sb-group">
            <button type="button" className="sb-tool" aria-label="Undo" title="Undo" disabled={!past.length} onClick={undo}>
              ↶
            </button>
            <button type="button" className="sb-tool" aria-label="Redo" title="Redo" disabled={!future.length} onClick={redo}>
              ↷
            </button>
            <button type="button" className="sb-tool" aria-label="Delete selected" title="Delete selected" disabled={!selected} onClick={remove}>
              🗑
            </button>
          </div>
          <div className="sb-group sb-bg">
            <label className="small" htmlFor="sb-bg">
              Background
            </label>
            <select
              id="sb-bg"
              value={doc.backgroundAttachmentId ?? ''}
              onChange={(e) => {
                if (e.target.value === '__upload') fileRef.current?.click();
                else setDoc((d) => ({ ...d, backgroundAttachmentId: e.target.value || null }));
              }}
            >
              <option value="">Blank</option>
              {images.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label || a.id}
                </option>
              ))}
              <option value="__upload">{uploading ? 'Uploading…' : 'Upload image…'}</option>
            </select>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && uploadBackground(e.target.files[0])} />
          </div>
        </div>

        {restorable && (
          <div className="banner info">
            <span>An unsaved version of this drawing from {new Date(restorable.at).toLocaleString()} was found on this device.</span>
            <div className="row">
              <button
                type="button"
                className="btn small primary"
                onClick={() => {
                  pushUndo();
                  setDoc(restorable.doc);
                  setRestorable(null);
                }}
              >
                Restore it
              </button>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  localStorage.removeItem(draftKey(episodeId, scene.id));
                  setRestorable(null);
                }}
              >
                Discard
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        <div className="sb-stage">
          {editingObj && (
            <div className="sb-textbar">
              <label htmlFor="sb-text">Label text</label>
              <textarea
                id="sb-text"
                ref={textRef}
                rows={1}
                value={editingObj.text}
                onFocus={() => pushUndo()}
                onChange={(e) => update(editingObj.id, (o) => ({ ...o, text: e.target.value.slice(0, 500) }))}
              />
              <div className="sb-size">
                <button type="button" className="sb-tool" aria-label="Smaller text" onClick={() => update(editingObj.id, (o) => (o.type === 'text' ? { ...o, size: Math.max(8, o.size - 6) } : o))}>
                  A−
                </button>
                <button type="button" className="sb-tool" aria-label="Larger text" onClick={() => update(editingObj.id, (o) => (o.type === 'text' ? { ...o, size: Math.min(300, o.size + 6) } : o))}>
                  A+
                </button>
              </div>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  if (!editingObj.text.trim()) setDoc((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== editingObj.id) }));
                  setEditingText(null);
                }}
              >
                Done
              </button>
            </div>
          )}

          <svg
            ref={svgRef}
            className={`sb-canvas tool-${tool}`}
            viewBox={`0 0 ${doc.width} ${doc.height}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => selectedObj?.type === 'text' && setEditingText(selectedObj.id)}
          >
            <rect x="0" y="0" width={doc.width} height={doc.height} fill="#ffffff" />
            {bg && <image href={assetUrl(bg.assetId)} x="0" y="0" width={doc.width} height={doc.height} preserveAspectRatio="xMidYMid meet" />}
            <g dangerouslySetInnerHTML={{ __html: doc.objects.map(objectToSvg).join('') }} />
            {selectedObj && <SelectionOverlay o={selectedObj} unit={u} />}
          </svg>
        </div>

        <footer className="sb-foot">
          <label htmlFor="sb-desc" className="small">
            Description
          </label>
          <input
            id="sb-desc"
            value={doc.description}
            maxLength={2000}
            placeholder="What the sketch shows, e.g. camera at the ramp; rider enters from the left"
            onChange={(e) => setDoc((d) => ({ ...d, description: e.target.value }))}
          />
          <span className="muted small sb-hint">
            {doc.width}×{doc.height} · {doc.objects.length} object{doc.objects.length === 1 ? '' : 's'} {dirty ? '· unsaved' : ''}
          </span>
        </footer>
      </div>

      {confirmCancel && (
        <Confirm
          title="Discard drawing changes?"
          message={<p>Your unsaved changes to this drawing will be discarded. The last saved drawing is kept.</p>}
          confirmLabel="Discard changes"
          danger
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => {
            localStorage.removeItem(draftKey(episodeId, scene.id));
            onClose();
          }}
        />
      )}
      {staleChoice && (
        <Confirm
          title="This drawing was changed elsewhere"
          message={
            <p>
              A newer version of this storyboard was saved (from another device or your agent) after you opened it. Saving now replaces that version with yours. The
              newer version stays in History.
            </p>
          }
          confirmLabel="Save mine anyway"
          onCancel={() => {
            setStaleChoice(false);
            setSaving(false);
            setError('Not saved. Your drawing is still here. Save again to replace the newer version, or Cancel to keep it.');
          }}
          onConfirm={() => {
            setStaleChoice(false);
            void save(true);
          }}
        />
      )}
    </div>
  );
}

function SelectionOverlay({ o, unit }: { o: StoryboardObject; unit: number }) {
  const r = 9 * unit;
  if (o.type === 'arrow') {
    return (
      <g className="sb-selection" pointerEvents="none">
        <circle cx={o.x1} cy={o.y1} r={r} />
        <circle cx={o.x2} cy={o.y2} r={r} />
      </g>
    );
  }
  const b = objectBounds(o);
  const pad = 6 * unit;
  return (
    <g className="sb-selection" pointerEvents="none">
      <rect x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} strokeWidth={1.5 * unit} strokeDasharray={`${6 * unit} ${4 * unit}`} fill="none" />
      <rect x={b.x + b.w - r} y={b.y + b.h - r} width={r * 2} height={r * 2} />
    </g>
  );
}
