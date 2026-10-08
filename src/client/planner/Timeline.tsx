import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatTime, sceneStarts, type Scene } from '../../shared/model';
import { capturePointer } from '../components/ui';

interface Props {
  scenes: Scene[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onResize: (id: string, seconds: number) => void;
  onMove: (id: string, index: number) => void;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const MIN_TICK_PX = 72;

type Drag =
  | { kind: 'resize'; id: string; startX: number; startDur: number; dur: number; pointerId: number }
  | { kind: 'move'; id: string; startX: number; dx: number; active: boolean; target: number; pointerId: number };

export function Timeline({ scenes, selectedId, onSelect, onResize, onMove }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [drag, setDrag] = useState<Drag | null>(null);
  const blockRefs = useRef(new Map<string, HTMLDivElement>());

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Durations as displayed, including a live resize preview.
  const durations = scenes.map((s) => (drag?.kind === 'resize' && drag.id === s.id ? drag.dur : s.durationSeconds));
  const total = Math.max(1, durations.reduce((a, b) => a + b, 0));
  const fitPps = Math.max(0.05, (width - 2) / total);
  const pps = zoom === 'fit' ? fitPps : zoom;
  const starts = useMemo(() => {
    let t = 0;
    return durations.map((d) => {
      const s = t;
      t += d;
      return s;
    });
  }, [durations.join(',')]);
  const contentWidth = Math.max(width - 2, total * pps);
  const step = STEPS.find((s) => s * pps >= MIN_TICK_PX) ?? 3600;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);

  // Keep the selected block in view when zoomed in (horizontal scroll only; never scroll the page).
  useEffect(() => {
    const el = selectedId ? blockRefs.current.get(selectedId) : null;
    const box = wrapRef.current;
    if (!el || !box) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left < box.scrollLeft) box.scrollLeft = left - 8;
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + 8;
  }, [selectedId, zoom]);

  const zoomBy = (f: number) => setZoom((z) => Math.min(80, Math.max(0.05, (z === 'fit' ? fitPps : z) * f)));

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.kind === 'resize') {
      const dur = Math.max(1, Math.round(drag.startDur + (e.clientX - drag.startX) / pps));
      if (dur !== drag.dur) setDrag({ ...drag, dur });
    } else {
      const dx = e.clientX - drag.startX;
      const active = drag.active || Math.abs(dx) > 6;
      // Target index: the gap nearest the pointer, based on block midpoints.
      const rect = wrapRef.current!.querySelector('.timeline-track')!.getBoundingClientRect();
      const x = (e.clientX - rect.left) / pps;
      let target = scenes.length;
      for (let i = 0; i < scenes.length; i++) {
        if (x < starts[i] + durations[i] / 2) {
          target = i;
          break;
        }
      }
      setDrag({ ...drag, dx, active, target });
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.kind === 'resize') {
      const scene = scenes.find((s) => s.id === drag.id);
      if (scene && drag.dur !== scene.durationSeconds) onResize(drag.id, drag.dur);
    } else if (drag.active) {
      const from = scenes.findIndex((s) => s.id === drag.id);
      const to = drag.target > from ? drag.target - 1 : drag.target;
      if (to !== from) onMove(drag.id, to);
    } else {
      onSelect(drag.id);
    }
    setDrag(null);
  };

  const onKey = (e: React.KeyboardEvent, scene: Scene, i: number) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const to = i + (e.key === 'ArrowLeft' ? -1 : 1);
      if (to >= 0 && to < scenes.length) onMove(scene.id, to);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = scenes[i + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (next) {
        onSelect(next.id);
        blockRefs.current.get(next.id)?.focus();
      }
    } else if (e.code === 'BracketRight' || e.key === ']' || e.key === '+' || e.key === '=') {
      e.preventDefault();
      onResize(scene.id, scene.durationSeconds + step);
    } else if (e.code === 'BracketLeft' || e.key === '[' || e.key === '-') {
      e.preventDefault();
      if (scene.durationSeconds - step >= 1) onResize(scene.id, scene.durationSeconds - step);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(scene.id);
    }
  };

  const insertionX =
    drag?.kind === 'move' && drag.active ? (drag.target >= scenes.length ? total : starts[drag.target]) * pps : null;

  return (
    <div className="timeline">

      <div className="timeline-scroll" ref={wrapRef} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
        <div className="timeline-inner" style={{ width: contentWidth }}>
          <div className="ruler" aria-hidden>
            {ticks
              .filter((t) => t === 0 || (total - t) * pps > 70 || t === total)
              .map((t) => (
                <span key={t} className={`tick ${t > 0 && (total - t) * pps <= 70 ? 'end' : ''}`} style={{ left: t * pps }}>
                  {formatTime(t)}
                </span>
              ))}
            {total !== ticks[ticks.length - 1] && (
              <span className="tick end" style={{ left: total * pps }}>
                {formatTime(total)}
              </span>
            )}
          </div>
          <div className="timeline-track" role="listbox" aria-label="Scenes in story order" aria-orientation="horizontal">
            {scenes.map((s, i) => {
              const left = starts[i] * pps;
              const w = Math.max(durations[i] * pps - 4, 8);
              const moving = drag?.kind === 'move' && drag.active && drag.id === s.id;
              const narrow = w < 70;
              return (
                <div
                  key={s.id}
                  ref={(el) => {
                    if (el) blockRefs.current.set(s.id, el);
                    else blockRefs.current.delete(s.id);
                  }}
                  role="option"
                  aria-selected={s.id === selectedId}
                  aria-label={`${s.title}, ${formatTime(durations[i])}, starts ${formatTime(starts[i])}`}
                  tabIndex={s.id === selectedId ? 0 : -1}
                  className={`block ${s.id === selectedId ? 'selected' : ''} ${moving ? 'moving' : ''} ${s.status === 'ready' ? 'ready' : ''} ${narrow ? 'narrow' : ''}`}
                  style={{ left, width: w, transform: moving ? `translateX(${drag.dx}px)` : undefined }}
                  title={`${s.title} · ${formatTime(durations[i])}`}
                  onKeyDown={(e) => onKey(e, s, i)}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    capturePointer(e.currentTarget.closest('.timeline-scroll'), e.pointerId);
                    setDrag({ kind: 'move', id: s.id, startX: e.clientX, dx: 0, active: false, target: i, pointerId: e.pointerId });
                  }}
                >
                  <span className="block-grip" aria-hidden />
                  {!narrow && (
                    <>
                      <span className="block-title">{s.title}</span>
                      <span className="block-time">{formatTime(durations[i])}</span>
                    </>
                  )}
                  <span
                    className="block-handle"
                    aria-hidden
                    title="Drag to change duration"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (e.button !== 0) return;
                      capturePointer(e.currentTarget.closest('.timeline-scroll'), e.pointerId);
                      onSelect(s.id);
                      setDrag({ kind: 'resize', id: s.id, startX: e.clientX, startDur: s.durationSeconds, dur: s.durationSeconds, pointerId: e.pointerId });
                    }}
                  />
                  {drag?.kind === 'resize' && drag.id === s.id && <span className="resize-bubble">{formatTime(drag.dur)}</span>}
                </div>
              );
            })}
            {insertionX !== null && <div className="insertion" style={{ left: insertionX - 2 }} />}
            {!scenes.length && <div className="timeline-empty">No scenes yet. Add the first one with “+ Scene”.</div>}
          </div>
        </div>
      </div>
      <div className="timeline-bottom">
      <div className="timeline-zoom" role="group" aria-label="Timeline zoom">
          <button type="button" className={`btn small ${zoom === 'fit' ? 'on' : ''}`} onClick={() => setZoom('fit')}>
            Fit
          </button>
          <button type="button" className="btn small" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)}>
            −
          </button>
          <button type="button" className="btn small" aria-label="Zoom in" onClick={() => zoomBy(1.5)}>
            +
          </button>
        </div>
        <p className="timeline-help muted small">
          Drag a block to reorder; drag its right edge to change duration. Keys: ←/→ select · Alt+←/→ move · [ ] shorter/longer (Shift ×5)
        </p>
      </div>
    </div>
  );
}

export function sceneRange(scenes: Scene[], id: string | null) {
  const i = scenes.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const start = sceneStarts({ scenes })[i];
  return { index: i, start, end: start + scenes[i].durationSeconds };
}
