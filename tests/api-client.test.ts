// Client request helper: a response that cannot be read is not an answer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/client/api.js';

const respond = (res: Partial<Response>) => vi.stubGlobal('fetch', async () => res as Response);
afterEach(() => vi.unstubAllGlobals());

describe('api request', () => {
  it('reports an unreadable body as a lost connection (the change may have been applied)', async () => {
    respond({ ok: true, status: 200, text: () => Promise.reject(new TypeError('network error')) });
    await expect(api.changes('ep', 1, [])).rejects.toMatchObject({ status: 0, offline: true });
  });

  it('reports a success that is not JSON as a lost connection', async () => {
    respond({ ok: true, status: 200, text: async () => '<html>proxy</html>' });
    await expect(api.changes('ep', 1, [])).rejects.toBeInstanceOf(ApiError);
    await expect(api.changes('ep', 1, [])).rejects.toMatchObject({ status: 0 });
  });

  it('keeps the status of a non-JSON error page', async () => {
    respond({ ok: false, status: 413, text: async () => '<html>too large</html>' });
    await expect(api.changes('ep', 1, [])).rejects.toMatchObject({ status: 413 });
  });
});

describe('session identity', () => {
  const lost: unknown[] = [];
  const target = new EventTarget();
  target.addEventListener('planb:signed-out', (e) => lost.push((e as CustomEvent).detail));

  it('sends the signed-in account, and reports a 401 for the current session', async () => {
    vi.stubGlobal('window', target);
    const { setSessionUser } = await import('../src/client/api.js');
    setSessionUser('us_alice');
    let headers: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return { ok: false, status: 401, text: async () => JSON.stringify({ error: 'Please sign in.' }) } as Response;
    });
    await expect(api.changes('ep', 1, [])).rejects.toMatchObject({ status: 401 });
    expect(headers['x-planb-user']).toBe('us_alice');
    expect(lost).toEqual([{ userId: 'us_alice', code: undefined }]);
  });

  it('a late 401 for a session replaced since is not reported, and is retried like a lost connection', async () => {
    vi.stubGlobal('window', target);
    const { setSessionUser } = await import('../src/client/api.js');
    setSessionUser('us_alice');
    lost.length = 0;
    let answer!: (r: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>((r) => (answer = r)));
    const pending = api.changes('ep', 1, []);
    await Promise.resolve();
    setSessionUser('us_alice'); // signed in again meanwhile
    answer({ ok: false, status: 401, text: async () => '{}' } as Response);
    await expect(pending).rejects.toMatchObject({ status: 0, body: { code: 'stale_session' } });
    expect(lost).toEqual([]);
    setSessionUser(null);
  });
});
