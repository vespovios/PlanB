import type { Episode, EpisodeSummary, RevisionInfo } from '../shared/model';
import type { Operation } from '../shared/ops';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-planb-csrf': '1',
        ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the PlanB server. Check your connection.');
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page from a proxy */
  }
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/login')) window.dispatchEvent(new Event('planb:signed-out'));
    const message = typeof data.error === 'string' ? data.error : res.status >= 500 ? 'The server could not save this change.' : `Request failed (${res.status})`;
    // 502/503/504 from a proxy behave like being offline: retry later.
    throw new ApiError(res.status >= 502 && res.status <= 504 ? 0 : res.status, message, data);
  }
  return data as T;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AgentToken {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const api = {
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => request('POST', '/api/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) => request('POST', '/api/auth/password', { currentPassword, newPassword }),

  episodes: () => request<{ episodes: EpisodeSummary[] }>('GET', '/api/episodes'),
  createEpisode: (title: string, withExample: boolean) => request<{ episode: Episode }>('POST', '/api/episodes', { title, withExample }),
  deleteEpisode: (id: string) => request('DELETE', `/api/episodes/${id}`),
  episode: (id: string) => request<{ episode: Episode }>('GET', `/api/episodes/${id}`),
  changes: (id: string, baseRevision: number, operations: Operation[], summary?: string) =>
    request<{ episode: Episode; created: Record<number, string> }>('POST', `/api/episodes/${id}/changes`, { baseRevision, operations, summary }),
  revisions: (id: string) => request<{ revisions: RevisionInfo[] }>('GET', `/api/episodes/${id}/revisions`),
  restore: (id: string, targetRevision: number, baseRevision: number, acknowledgeLaterRevisions = false) =>
    request<{ episode: Episode }>('POST', `/api/episodes/${id}/restore`, { targetRevision, baseRevision, acknowledgeLaterRevisions }),
  upload: (episodeId: string, file: Blob, filename: string) => {
    const form = new FormData();
    form.append('file', file, filename);
    return request<{ asset: { id: string; mime: string; bytes: number; width: number; height: number } }>(
      'POST',
      `/api/episodes/${episodeId}/assets`,
      form,
    );
  },

  tokens: () => request<{ tokens: AgentToken[]; mcpUrl: string; apiUrl: string }>('GET', '/api/tokens'),
  createToken: (label: string) => request<{ id: string; label: string; token: string }>('POST', '/api/tokens', { label }),
  revokeToken: (id: string) => request('DELETE', `/api/tokens/${id}`),
};

export const assetUrl = (assetId: string, width?: number) => `/api/assets/${assetId}${width ? `?w=${width}` : ''}`;
