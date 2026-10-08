import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatTime, parseTime } from '../../shared/model';

/**
 * Text input/textarea that keeps the user's draft while focused (so remote refreshes and
 * temporarily invalid values such as an empty title don't fight the cursor) and reports
 * valid values as they are typed.
 */
export function TextField(props: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  label?: ReactNode;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(props.value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(props.value);
  }, [props.value]);
  const common = {
    id,
    value: draft,
    placeholder: props.placeholder,
    'aria-label': props.ariaLabel,
    maxLength: props.maxLength,
    autoFocus: props.autoFocus,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      if (props.required && !draft.trim()) setDraft(props.value);
      props.onBlur?.();
    },
    onChange: (e: { target: { value: string } }) => {
      setDraft(e.target.value);
      if (props.required && !e.target.value.trim()) return;
      if (e.target.value !== props.value) props.onChange(e.target.value);
    },
  };
  return (
    <div className={`field ${props.className ?? ''}`}>
      {props.label && <label htmlFor={id}>{props.label}</label>}
      {props.multiline ? <AutoTextarea {...common} rows={props.rows ?? 2} /> : <input type="text" {...common} />}
    </div>
  );
}

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 480)}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

/** Whole-second duration with stepper buttons that work well on touch. Accepts "75" or "1:15". */
export function DurationField(props: { value: number; onChange: (v: number) => void; label?: string; compact?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState(String(props.value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(props.value));
  }, [props.value]);
  const commit = (v: number) => {
    const clamped = Math.max(1, Math.min(86_400, Math.round(v)));
    setDraft(String(clamped));
    if (clamped !== props.value) props.onChange(clamped);
  };
  return (
    <div className={`field duration-field ${props.compact ? 'compact' : ''}`}>
      {props.label && <label htmlFor={id}>{props.label}</label>}
      <div className="stepper">
        <button type="button" className="step" aria-label="One second shorter" onClick={() => commit(props.value - 1)} disabled={props.value <= 1}>
          −
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={draft}
          aria-label={props.label ?? 'Duration in seconds'}
          onFocus={() => (focused.current = true)}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = parseTime(e.target.value);
            if (v && v >= 1 && v !== props.value) props.onChange(Math.min(v, 86_400));
          }}
          onBlur={() => {
            focused.current = false;
            const v = parseTime(draft);
            setDraft(String(v && v >= 1 ? v : props.value));
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              commit(props.value + (e.shiftKey ? 5 : 1));
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              commit(props.value - (e.shiftKey ? 5 : 1));
            }
          }}
        />
        <button type="button" className="step" aria-label="One second longer" onClick={() => commit(props.value + 1)}>
          +
        </button>
      </div>
      {!props.compact && <span className="hint">{formatTime(props.value)}</span>}
    </div>
  );
}

/** Optional section: collapsed to a small "+ Label" button while empty. */
export function Disclosure(props: { label: string; filled: boolean; children: ReactNode; count?: number; defaultOpen?: boolean; hint?: string }) {
  const [open, setOpen] = useState(props.defaultOpen ?? props.filled);
  useEffect(() => {
    if (props.filled) setOpen(true);
  }, [props.filled]);
  if (!open) {
    return (
      <button type="button" className="chip-add" onClick={() => setOpen(true)} title={props.hint}>
        + {props.label}
        {props.count ? ` (${props.count})` : ''}
      </button>
    );
  }
  return (
    <section className="disclosure">
      <button type="button" className="disclosure-head" aria-expanded="true" onClick={() => setOpen(false)}>
        <span>{props.label}</span>
        <span className="disclosure-toggle" aria-hidden>
          ▾
        </span>
      </button>
      {props.children}
    </section>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <header className="modal-head">
          <h2>{props.title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">{props.children}</div>
        {props.footer && <footer className="modal-foot">{props.footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm(props: { title: string; message: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" className={`btn ${props.danger ? 'danger' : 'primary'}`} onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-message">{props.message}</div>
    </Modal>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  // Wordmark between filmstrip bands with outward chevrons, after Peter's sketch.
  const holes = (y: number) => Array.from({ length: 9 }, (_, i) => <rect key={i} x={30 + i * 11.5} y={y} width="6" height="4" rx="1" />);
  return (
    <svg className={`logo logo-${size}`} viewBox="0 0 160 64" role="img" aria-label="PlanB">
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 20 6 32l14 12" />
        <path d="M140 20l14 12-14 12" />
        <rect x="26" y="4" width="108" height="10" rx="1.5" />
        <rect x="26" y="50" width="108" height="10" rx="1.5" />
      </g>
      <g fill="currentColor">
        {holes(7)}
        {holes(53)}
      </g>
      <text x="80" y="41" textAnchor="middle" fontFamily="ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" fontWeight="700" fontSize="24" fill="currentColor">
        PlanB
      </text>
    </svg>
  );
}

export function Toast(props: { children: ReactNode; onClose: () => void; timeout?: number; action?: { label: string; onClick: () => void } }) {
  useEffect(() => {
    const t = setTimeout(props.onClose, props.timeout ?? 8000);
    return () => clearTimeout(t);
  }, [props.onClose, props.timeout]);
  return (
    <div className="toast" role="status">
      <span>{props.children}</span>
      {props.action && (
        <button type="button" className="btn small" onClick={props.action.onClick}>
          {props.action.label}
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={props.onClose}>
        ✕
      </button>
    </div>
  );
}

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** setPointerCapture throws for pointers the browser no longer tracks; capture is only an enhancement. */
export function capturePointer(el: Element | null | undefined, pointerId: number) {
  try {
    el?.setPointerCapture(pointerId);
  } catch {
    /* ignore */
  }
}
