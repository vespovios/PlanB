// Original pictograms for shot sizes: one simple figure, framed tighter for each size.
import type { ShotSize } from '../../shared/vocab';

// Visible slice of the figure (in figure units, 0 = top of head, 100 = feet) for each size.
const SLICES: Record<Exclude<ShotSize, 'ews' | 'ins' | 'abstract'>, [number, number]> = {
  ws: [-38, 138],
  fs: [-6, 104],
  mws: [-5, 76],
  ms: [-4, 58],
  mcu: [-3, 40],
  cu: [-2, 27],
  ecu: [5, 15],
};

const W = 64;
const H = 36;

function Figure() {
  return (
    <g>
      <circle cx="0" cy="9" r="8" />
      <path d="M-15 22 Q-15 18 -10 18 L10 18 Q15 18 15 22 L12 56 L-12 56 Z" />
      <rect x="-11" y="56" width="9" height="43" rx="3" />
      <rect x="2" y="56" width="9" height="43" rx="3" />
    </g>
  );
}

export function ShotSizeIcon({ size, className }: { size: ShotSize | null | undefined; className?: string }) {
  if (!size) return null;
  const id = `clip-${size}`;
  let content;
  if (size === 'ews') {
    content = (
      <g>
        <path d={`M0 ${H * 0.62} L14 ${H * 0.4} L24 ${H * 0.55} L36 ${H * 0.3} L50 ${H * 0.5} L${W} ${H * 0.42} L${W} ${H} L0 ${H} Z`} className="land" />
        <g transform={`translate(${W * 0.55} ${H * 0.62}) scale(0.1)`}>
          <Figure />
        </g>
      </g>
    );
  } else if (size === 'abstract') {
    // Light streaks and sparkles: a non-literal mood shot.
    content = (
      <g>
        <path d={`M-4 ${H * 0.75} Q${W * 0.3} ${H * 0.2} ${W + 4} ${H * 0.45}`} className="streak" />
        <path d={`M-4 ${H * 0.95} Q${W * 0.45} ${H * 0.45} ${W + 4} ${H * 0.7}`} className="streak" />
        <circle cx={W * 0.72} cy={H * 0.28} r="3.2" />
        <circle cx={W * 0.25} cy={H * 0.35} r="1.8" />
        <circle cx={W * 0.55} cy={H * 0.18} r="1.4" />
      </g>
    );
  } else if (size === 'ins') {
    // A hand on a buckle/strap: an object filling the frame.
    content = (
      <g>
        <rect x="6" y={H * 0.42} width={W - 12} height="8" rx="2" className="land" />
        <rect x={W / 2 - 10} y={H * 0.3} width="20" height="16" rx="3" />
        <rect x={W / 2 - 5} y={H * 0.3 + 4} width="10" height="8" rx="1.5" className="cut" />
      </g>
    );
  } else {
    const [y0, y1] = SLICES[size];
    const scale = H / (y1 - y0);
    content = (
      <g transform={`translate(${W / 2} ${-y0 * scale}) scale(${scale})`}>
        <Figure />
      </g>
    );
  }
  return (
    <svg className={`shot-icon ${className ?? ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${size.toUpperCase()} shot`}>
      <defs>
        <clipPath id={id}>
          <rect width={W} height={H} rx="3" />
        </clipPath>
      </defs>
      <rect width={W} height={H} rx="3" className="frame" />
      <g clipPath={`url(#${id})`} className="figure">
        {content}
      </g>
    </svg>
  );
}
