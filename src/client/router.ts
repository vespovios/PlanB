import { useEffect, useState } from 'react';

export type Route =
  | { name: 'episodes' }
  | { name: 'planner'; id: string }
  | { name: 'checklist'; id: string }
  | { name: 'document'; id: string }
  | { name: 'settings' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  let m = path.match(/^\/e\/([\w-]+)\/checklist$/);
  if (m) return { name: 'checklist', id: m[1] };
  m = path.match(/^\/e\/([\w-]+)\/document$/);
  if (m) return { name: 'document', id: m[1] };
  m = path.match(/^\/e\/([\w-]+)$/);
  if (m) return { name: 'planner', id: m[1] };
  if (path === '/settings') return { name: 'settings' };
  return { name: 'episodes' };
}

export const href = {
  episodes: () => '#/',
  planner: (id: string) => `#/e/${id}`,
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
