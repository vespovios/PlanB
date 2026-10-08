import type { ReactNode } from 'react';
import { href } from '../router';
import { Logo } from './ui';

export function TopBar({ children, crumb }: { children?: ReactNode; crumb?: ReactNode }) {
  return (
    <header className="topbar">
      <a href={href.episodes()} className="brand" aria-label="PlanB episodes">
        <Logo size="sm" />
      </a>
      {crumb && <div className="crumb">{crumb}</div>}
      <div className="topbar-actions">{children}</div>
    </header>
  );
}
