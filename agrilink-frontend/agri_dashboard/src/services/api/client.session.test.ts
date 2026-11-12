import { describe, expect, it, vi } from 'vitest';
import { AdminApiClient } from './client';

describe('AdminApiClient session realm', () => {
  it('refreshes only through the administrator endpoint and retries the request', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: 'UNAUTHENTICATED', message: 'Sign in.' }), { status: 401, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { csrfToken: 'test-csrf' } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { administrator: { id: 'admin-id' }, expiresAt: null } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { items: [] } }));
    const client = new AdminApiClient({ baseUrl: 'https://agrilink.test/api/v1', fetcher, credentials: 'include' });

    const result = await client.request({ path: '/admin/users', decode: (payload) => payload });

    expect(result).toEqual({ success: true, data: { items: [] } });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://agrilink.test/api/v1/admin/users',
      'https://agrilink.test/api/v1/auth/admin/csrf',
      'https://agrilink.test/api/v1/auth/admin/refresh-token',
      'https://agrilink.test/api/v1/admin/users',
    ]);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get('X-CSRF-Token')).toBe('test-csrf');
  });
})
