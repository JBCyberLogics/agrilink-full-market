import { AUTH_INTEGRATION_STATUS } from '../config/auth.config';
import type { AuthenticatedSession, LoginCredentials, LoginResult, LogoutResult, SessionResult } from '../contracts/auth.contract';
import { apiRequest, ADMIN_API_CONFIGURED } from '../../../services/api/client';

/**
 * AgriLink Control uses the shared backend's HttpOnly cookie session.
 */
export const authService = {
  integrationStatus: ADMIN_API_CONFIGURED ? AUTH_INTEGRATION_STATUS : 'NOT_CONFIGURED',

  async login(credentials: LoginCredentials): Promise<LoginResult> {
    if (!ADMIN_API_CONFIGURED) return { status: 'not-configured' };
    try {
      const result = await apiRequest<{ administrator: AuthenticatedSession['administrator']; expiresAt: string | null }>('/auth/admin/login', 'POST', credentials);
      if (!result.administrator?.id || !result.administrator.roles?.some((role) => ['admin', 'super_admin'].includes(role))) return { status: 'rejected' };
      return { status: 'authenticated', session: { administrator: result.administrator, expiresAt: result.expiresAt } };
    } catch (error) {
      return error instanceof Error && 'status' in error && Number((error as { status?: number }).status) >= 400 ? { status: 'rejected' } : { status: 'error' };
    }
  },

  async restoreSession(): Promise<SessionResult> {
    if (!ADMIN_API_CONFIGURED) return { status: 'not-configured' };
    try {
      const result = await apiRequest<{ administrator: AuthenticatedSession['administrator']; expiresAt: string | null }>('/auth/admin/session');
      if (!result.administrator?.id) return { status: 'unauthenticated' };
      return { status: 'authenticated', session: { administrator: result.administrator, expiresAt: result.expiresAt } };
    } catch (error) {
      if (error instanceof Error && 'status' in error && Number((error as { status?: number }).status) === 401) return { status: 'unauthenticated' };
      return { status: 'error' };
    }
  },

  async logout(): Promise<LogoutResult> {
    if (!ADMIN_API_CONFIGURED) return { status: 'not-configured' };
    let result: LogoutResult = { status: 'error' };
    try {
      const response = await apiRequest<{ serverInvalidated: boolean }>('/auth/admin/logout', 'POST', {});
      result = response.serverInvalidated ? { status: 'signed-out' } : { status: 'error' };
    } catch { /* caller clears only local session state and must not report server invalidation */ }
    try { localStorage.setItem('agrilink.session-event', String(Date.now())); } catch { /* browser storage may be unavailable */ }
    try { const channel = new BroadcastChannel('agrilink.session'); channel.postMessage({ type: 'signed-out' }); channel.close(); } catch { /* browser may not support channel messaging */ }
    return result;
  },
};
