import { useEffect, useState } from 'react';

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

export function navigate(to: string) {
  window.location.hash = to.replace(/^#/, '');
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
