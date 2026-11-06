import { useEffect, useState, useSyncExternalStore } from 'react';

export const EPISODE_TABS = ['overview', 'plan', 'shots', 'storyboard', 'kit', 'notes'] as const;
export type EpisodeTab = (typeof EPISODE_TABS)[number];

export type Route =
  | { name: 'episodes' }
  | { name: 'episode'; id: string; tab: EpisodeTab }
  | { name: 'checklist'; id: string }
  | { name: 'document'; id: string }
  | { name: 'settings' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  let m = path.match(/^\/e\/([\w-]+)\/checklist$/);
  if (m) return { name: 'checklist', id: m[1] };
  m = path.match(/^\/e\/([\w-]+)\/document$/);
  if (m) return { name: 'document', id: m[1] };
  m = path.match(/^\/e\/([\w-]+)(?:\/(\w+))?$/);
  if (m) {
    const tab = (EPISODE_TABS as readonly string[]).includes(m[2] ?? '') ? (m[2] as EpisodeTab) : 'overview';
    return { name: 'episode', id: m[1], tab };
  }
  if (path === '/settings') return { name: 'settings' };
  return { name: 'episodes' };
}

export const href = {
  episodes: () => '#/',
  episode: (id: string, tab: EpisodeTab = 'overview') => (tab === 'overview' ? `#/e/${id}` : `#/e/${id}/${tab}`),
  /** The timeline/cards planner. */
  planner: (id: string) => `#/e/${id}/plan`,
  checklist: (id: string) => `#/e/${id}/checklist`,
  document: (id: string) => `#/e/${id}/document`,
  settings: () => '#/settings',
};

/** The app's guarded history (navigation.ts), once installed; until then plain hash changes. */
interface Navigator {
  navigate: (to: string) => void;
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => string;
}
let installed: Navigator | null = null;
export function installNavigator(n: Navigator | null) {
  installed = n;
}

export function navigate(to: string) {
  if (installed) installed.navigate(to);
  else window.location.hash = to.replace(/^#/, '');
}

const noSubscribe = () => () => undefined;
/** The route on screen: with the guarded history it changes only once a move is approved. */
export function useRoute(nav: Navigator | null = installed): Route {
  const [plain, setPlain] = useState(() => window.location.hash);
  useEffect(() => {
    if (nav) return;
    const on = () => setPlain(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [nav]);
  const guarded = useSyncExternalStore(nav?.subscribe ?? noSubscribe, nav?.getSnapshot ?? (() => plain));
  return parseRoute(nav ? guarded : plain);
}
