import { describe, expect, it, vi } from 'vitest';
import { AUTH_INTEGRATION_STATUS, DEV_DASHBOARD_PREVIEW_PATH, getDevelopmentPreviewPath, getDevelopmentPreviewUrl } from '../config/auth.config';
import { AdminApiClient } from '../../../services/api/client';

describe('AgriLink Control authentication boundary', () => {
  it('uses the configured shared backend and sends browser credentials', async () => {
    expect(AUTH_INTEGRATION_STATUS).toBe('CONFIGURED');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { administrator: { id: 'test-admin' } } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const client = new AdminApiClient({ baseUrl: 'https://agrilink.test/api/v1', credentials: 'include', fetcher });
    const result = await client.request({ path: '/auth/admin/session', decode: (payload: any) => payload.data });
    expect(result).toEqual({ administrator: { id: 'test-admin' } });
    expect(fetcher).toHaveBeenCalledWith('https://agrilink.test/api/v1/auth/admin/session', expect.objectContaining({ credentials: 'include', method: 'GET' }));
  });

  it('keeps the development preview route unavailable in production', () => {
    expect(DEV_DASHBOARD_PREVIEW_PATH).toBe('/__dev/dashboard-preview');
    expect(getDevelopmentPreviewPath(DEV_DASHBOARD_PREVIEW_PATH, true)).toBe('/dashboard');
    expect(getDevelopmentPreviewPath('/__dev/dashboard-preview/settings/security', true)).toBe('/settings/security');
    expect(getDevelopmentPreviewPath(DEV_DASHBOARD_PREVIEW_PATH, false)).toBeNull();
    expect(getDevelopmentPreviewUrl('/settings/security', true)).toBe('/__dev/dashboard-preview/settings/security');
    expect(getDevelopmentPreviewUrl('/settings/security', false)).toBeNull();
  });
});
