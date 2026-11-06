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
