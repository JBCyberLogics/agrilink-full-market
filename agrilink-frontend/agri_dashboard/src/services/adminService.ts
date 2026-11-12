import { adminApi, apiRequest } from './api/client';
import type { ApiMethod } from './api/client';

export type AdminRecord = Record<string, unknown>;
export type AdminPage<T> = { items: T[]; meta: { page: number; limit: number; total: number; pages: number } };

export const adminRequest = <T = unknown>(path: string, method: ApiMethod = 'GET', body?: unknown) => apiRequest<T>(path, method, body);
export const loadAdminDashboard = () => adminRequest<AdminRecord>('/admin/dashboard');
export const loadAdminAnalytics = (query = '') => adminRequest<AdminRecord>(`/admin/analytics/summary${query}`);
export const loadAdminActivity = (query = '') => adminRequest<AdminRecord[]>(`/admin/audit-logs${query}`);
export const createAdminNotification = (email: string, title: string, message: string) => adminRequest<AdminRecord>('/admin/notifications', 'POST', { email, title, message });
export const loadAiConfiguration = () => adminRequest<AdminRecord>('/admin/ai/config');
export const saveAiConfiguration = (body: AdminRecord) => adminRequest<AdminRecord>('/admin/ai/config', 'PUT', body);
export const loadAiProviders = () => adminRequest<AdminRecord>('/admin/ai/providers');
export const saveAiProvider = (provider: string, body: AdminRecord) => adminRequest<AdminRecord>(`/admin/ai/providers/${encodeURIComponent(provider)}`, 'PUT', body);
export const removeAiProvider = (provider: string) => adminRequest<AdminRecord>(`/admin/ai/providers/${encodeURIComponent(provider)}`, 'DELETE');
export const saveAiCapabilityRouting = (body: AdminRecord) => adminRequest<AdminRecord>('/admin/ai/capabilities', 'PUT', body);
export async function checkAiProviderConnectivity(provider: string, timeoutMs = 10_000): Promise<AdminRecord> {
  return adminApi.request({ path: `/admin/ai/providers/${encodeURIComponent(provider)}/diagnostics/connectivity`, method: 'POST', body: {}, timeoutMs: Math.min(15_000, Math.max(2_000, timeoutMs + 2_000)), decode: (payload) => payload as AdminRecord });
}
export async function runAiProviderInferenceDiagnostic(provider: string, timeoutMs = 30_000, capability = 'shared/agricultural-assistant'): Promise<AdminRecord> {
  return adminApi.request({ path: `/admin/ai/providers/${encodeURIComponent(provider)}/diagnostics/inference`, method: 'POST', body: { capability }, timeoutMs: Math.min(125_000, Math.max(5_000, timeoutMs + 5_000)), decode: (payload) => payload as AdminRecord });
}
export async function runAiDiagnostics(providerTimeoutMs = 30_000): Promise<AdminRecord> {
  const configuredTimeout = Number(providerTimeoutMs);
  const boundedProviderTimeout = Number.isFinite(configuredTimeout)
    ? Math.min(120_000, Math.max(1_000, configuredTimeout))
    : 30_000;
  try {
    return await adminApi.request({
      path: '/admin/ai/diagnostics',
      method: 'POST',
      body: {},
      // The backend waits for the provider up to this configured deadline.
      // Allow a small response/audit-write margin so the browser does not
      // report an Admin API timeout before the provider can return its result.
      timeoutMs: boundedProviderTimeout + 5_000,
      decode: (payload) => {
        if (typeof payload === 'object' && payload !== null && 'data' in payload) {
          return (payload as { data: AdminRecord }).data;
        }
        return payload as AdminRecord;
      },
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'TIMEOUT') {
      throw new Error('The AI diagnostic did not return before its timeout window. Provider latency and Admin API connectivity could not be distinguished; check the AI audit history before retrying.');
    }
    throw error;
  }
}
export const loadAiUsage = () => adminRequest<AdminRecord>('/admin/ai/usage');
export const loadReadiness = () => adminRequest<AdminRecord>('/health/ready');
export const loadAdminNotifications = () => adminRequest<AdminRecord[]>('/notifications?limit=8');
export const markAdminNotificationRead = (id: string) => adminRequest<AdminRecord>(`/notifications/${encodeURIComponent(id)}/read`, 'PATCH', {});
export const loadMatchingConfiguration = () => adminRequest<AdminRecord>('/admin/algorithms/matching');
export const saveMatchingConfiguration = (body: AdminRecord) => adminRequest<AdminRecord>('/admin/algorithms/matching', 'PUT', body);
export const scoreMatchingCandidate = (body: AdminRecord) => adminRequest<AdminRecord>('/admin/algorithms/matching/score', 'POST', body);

function userEndpoint(role?: string) { return `/admin/users/all-users?limit=100${role ? `&role=${encodeURIComponent(role)}` : ''}`; }
const resourcePaths: Record<string, string> = {
  users: userEndpoint(), farmers: userEndpoint('farmer'), buyers: userEndpoint('buyer'), verifications: '/admin/users/verifications?limit=100', administrators: '/admin/administrators',
  roles: '/admin/roles', listings: '/admin/products?limit=100', categories: '/admin/categories?limit=100', markets: '/admin/market-data',
  transactions: '/admin/ledger', disputes: '/admin/disputes', models: '/admin/ai/config', 'market-intelligence': '/admin/market-data/observations?limit=100',
  'data-sources': '/admin/market-data/sources?limit=100', support: '/admin/support?limit=100', announcements: '/admin/announcements?limit=100', reports: '/admin/reports?limit=100',
  'audit-logs': '/admin/audit-logs?limit=100', alerts: '/admin/notifications?limit=100', faqs: '/admin/faqs/manage?limit=100',
};

export const PAGED_ADMIN_RESOURCES = new Set<string>([
  'listings', 'categories', 'disputes', 'market-intelligence', 'data-sources',
  'support', 'announcements', 'reports', 'audit-logs', 'alerts', 'faqs', 'transactions',
]);

export async function loadAdminResourcePage(id: string, options: { page: number; limit?: number; search?: string; status?: string; type?: string; from?: string; to?: string; action?: string; resource?: string; actor?: string }): Promise<AdminPage<AdminRecord>> {
  if (!PAGED_ADMIN_RESOURCES.has(id)) throw new Error('This administrative resource does not support server pagination.');
  const basePath = resourcePaths[id];
  if (!basePath) throw new Error('This administrative view has no backend operation.');
  const params = new URLSearchParams({ page: String(options.page), limit: String(options.limit ?? 25) });
  if (options.search?.trim()) params.set('search', options.search.trim());
  if (options.status) params.set(id === 'audit-logs' ? 'outcome' : 'status', options.status);
  if (id === 'transactions' && options.type) params.set('type', options.type);
  if (id === 'audit-logs' && options.action?.trim()) params.set('action', options.action.trim());
  if (id === 'audit-logs' && options.resource?.trim()) params.set('resource', options.resource.trim());
  if (id === 'audit-logs' && options.actor?.trim()) params.set('actor', options.actor.trim());
  if ((id === 'transactions' || id === 'audit-logs') && options.from) params.set('from', options.from);
  if ((id === 'transactions' || id === 'audit-logs') && options.to) params.set('to', options.to);
  const response = await adminApi.request({
    path: `${basePath.split('?')[0]}?${params.toString()}`,
    decode: (payload) => {
      if (!payload || typeof payload !== 'object') throw new Error('The administrative list response is invalid.');
      const envelope = payload as { data?: unknown; meta?: Record<string, unknown> };
      const nested = envelope.data && typeof envelope.data === 'object' ? envelope.data as Record<string, unknown> : null;
      const rows = id === 'announcements'
        ? nested?.announcements
        : id === 'categories'
          ? nested?.categories
          : envelope.data;
      if (!Array.isArray(rows)) throw new Error('The administrative list response is invalid.');
      const meta = (envelope.meta ?? nested?.meta ?? {}) as Record<string, unknown>;
      return {
        items: rows as AdminRecord[],
        meta: {
          page: Number(meta.page ?? options.page),
          limit: Number(meta.limit ?? options.limit ?? 25),
          total: Number(meta.total ?? rows.length),
          pages: Number(meta.pages ?? (rows.length ? 1 : 0)),
        },
      };
    },
  });
  return response;
}

export async function loadAdminResource(id: string, options: { search?: string } = {}): Promise<unknown> {
  const basePath = resourcePaths[id];
  if (!basePath) throw new Error('This administrative view has no backend operation.');
  const params = new URLSearchParams(basePath.split('?')[1] ?? '');
  if (options.search?.trim()) params.set('search', options.search.trim());
  const path = params.size ? `${basePath.split('?')[0]}?${params.toString()}` : basePath.split('?')[0];
  if (id === 'transactions') {
    const [orders, payments] = await Promise.all([
      adminRequest<any>('/admin/orders?limit=100'),
      adminRequest<any>('/admin/transactions?limit=100'),
    ]);
    const orderRows = Array.isArray(orders) ? orders : orders?.data ?? orders?.items ?? [];
    const paymentRows = Array.isArray(payments) ? payments : payments?.data ?? payments?.items ?? [];
    return [
      ...orderRows.map((order: any) => ({
        id: order.id ?? order._id,
        recordType: 'order',
        transactionId: order.orderNumber ?? order.id ?? order._id,
        orderId: order.id ?? order._id,
        provider: 'Order',
        amount: order.totalAmount ?? (order.totalCents !== null && order.totalCents !== undefined && Number.isFinite(Number(order.totalCents)) ? Number(order.totalCents) / 100 : null),
        currency: order.currency ?? null,
        status: order.status,
      })),
      ...paymentRows.map((payment: any) => ({ ...payment, recordType: 'payment' })),
    ];
  }
  const result: any = await adminRequest<any>(path);
  if (id === 'categories') return result.categories ?? [];
  if (id === 'roles') return result.roles ?? [];
  if (id === 'administrators') return result.administrators ?? [];
  if (id === 'announcements') return result.announcements ?? [];
  if (id === 'faqs') return Array.isArray(result) ? result : result.data ?? [];
  if (id === 'market-intelligence') return Array.isArray(result) ? result : result?.data ?? result?.items ?? [];
  if (id === 'models') return [{ provider: 'NVIDIA', model: result.model ?? null, baseUrl: result.baseUrl ?? null, status: result.enabled && result.hasApiKey && result.model ? 'configured' : 'unavailable' }];
  if (id === 'markets') return [result];
  return Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : Array.isArray(result?.items) ? result.items : [];
}

export async function loadAdminLedgerDetails(type: 'order' | 'payment', id: string) {
  return adminRequest<AdminRecord>(`/admin/ledger/${type}/${encodeURIComponent(id)}`);
}
export async function loadAdminListingDetails(id: string) {
  return adminRequest<AdminRecord>(`/admin/products/${encodeURIComponent(id)}/details`);
}

export async function loadAdminUserPage(id: string, options: { page: number; search: string; role?: string; status?: string; verificationStatus?: string; limit?: number }): Promise<AdminPage<AdminRecord>> {
  if (!['users', 'farmers', 'buyers', 'verifications'].includes(id)) throw new Error('This resource does not support user pagination.');
  const params = new URLSearchParams({ page: String(options.page), limit: String(options.limit ?? 25) });
  if (options.search.trim()) params.set('search', options.search.trim());
  if (id === 'farmers') params.set('role', 'farmer');
  else if (id === 'buyers') params.set('role', 'buyer');
  else if (id === 'users' && options.role) params.set('role', options.role);
  if (id === 'verifications' && options.verificationStatus) params.set('status', options.verificationStatus);
  else if (id !== 'verifications' && options.status) params.set('status', options.status);
  const path = id === 'verifications' ? `/admin/users/verifications?${params}` : `/admin/users/all-users?${params}`;
  return adminApi.request({
    path,
    decode: (payload) => {
      if (!payload || typeof payload !== 'object') throw new Error('The administrator list response is invalid.');
      const response = payload as { data?: unknown; meta?: Partial<AdminPage<AdminRecord>['meta']> };
      if (!Array.isArray(response.data)) throw new Error('The administrator list response is invalid.');
      const meta = response.meta ?? {};
      return {
        items: response.data as AdminRecord[],
        meta: {
          page: Number(meta.page ?? options.page),
          limit: Number(meta.limit ?? options.limit ?? 25),
          total: Number(meta.total ?? response.data.length),
          pages: Number(meta.pages ?? (response.data.length ? 1 : 0)),
        },
      };
    },
  });
}

export async function changeUserRole(id: string, role: string) {
  return adminRequest<AdminRecord>(`/admin/users/${encodeURIComponent(id)}/role`, 'PATCH', { role });
}
export async function loadAdminUserDetails(id: string) {
  return adminRequest<{ user: AdminRecord; profile: AdminRecord | null }>(`/admin/users/details/${encodeURIComponent(id)}`);
}
export async function updateAdminUserDetails(id: string, body: AdminRecord) {
  return adminRequest<{ user: AdminRecord }>(`/admin/users/details/${encodeURIComponent(id)}`, 'PATCH', body);
}

export async function toggleAccountStatus(id: string) { return adminRequest<AdminRecord>(`/admin/users/${encodeURIComponent(id)}/block`, 'PATCH', {}); }
export async function moderateListing(id: string, status: string, reason: string) { return adminRequest<AdminRecord>(`/admin/products/${encodeURIComponent(id)}/moderation`, 'PATCH', { status, reason }); }
export async function updateOrderStatus(id: string, status: string, reason: string) { return adminRequest<AdminRecord>(`/admin/orders/${encodeURIComponent(id)}/status`, 'PATCH', { status, reason }); }
export async function updateCategory(id: string, body: AdminRecord) { return adminRequest<AdminRecord>(`/admin/categories/${encodeURIComponent(id)}`, 'PATCH', body); }
export async function createCategory(name: string) { return adminRequest<AdminRecord>('/admin/categories', 'POST', { name }); }
export async function updateSupportTicket(id: string, status: string) { return adminRequest<AdminRecord>(`/admin/support/${encodeURIComponent(id)}`, 'PATCH', { status }); }
export async function loadAdminSupportDetails(id: string) { return adminRequest<AdminRecord>(`/admin/support/${encodeURIComponent(id)}`); }
export async function loadSupportAssignees() { return adminRequest<{ assignees: AdminRecord[] }>('/admin/support/assignees'); }
export async function assignSupportTicket(id: string, assignedTo: string | null) { return adminRequest<AdminRecord>(`/admin/support/${encodeURIComponent(id)}/assignment`, 'PATCH', { assignedTo }); }
export async function sendSupportReply(id: string, reply: string) { return adminRequest<AdminRecord>(`/admin/support/${encodeURIComponent(id)}/reply`, 'POST', { reply }); }
export async function decideUserVerification(id: string, status: 'pending' | 'verified' | 'rejected', reason: string) { return adminRequest<AdminRecord>(`/admin/users/${encodeURIComponent(id)}/verification`, 'PATCH', { status, reason }); }
export async function assignAdministratorRole(id: string, roleId: string) { return adminRequest<AdminRecord>(`/admin/administrators/${encodeURIComponent(id)}/role`, 'PATCH', { roleId }); }
export async function updateAdministratorStatus(id: string, isActive: boolean, reason: string) { return adminRequest<AdminRecord>(`/admin/administrators/${encodeURIComponent(id)}/status`, 'PATCH', { isActive, reason }); }
export async function createAnnouncement(title: string, message: string, status = 'draft') { return adminRequest<AdminRecord>('/admin/announcements', 'POST', { title, message, status }); }
export async function updateAnnouncement(id: string, body: AdminRecord) { return adminRequest<AdminRecord>(`/admin/announcements/${encodeURIComponent(id)}`, 'PATCH', body); }
export async function createFaq(question: string, answer: string, category?: string) { return adminRequest<AdminRecord>('/admin/faqs/manage', 'POST', { question, answer, ...(category ? { category } : {}) }); }
export async function updateFaq(id: string, body: AdminRecord) { return adminRequest<AdminRecord>(`/admin/faqs/manage/${encodeURIComponent(id)}`, 'PATCH', body); }
export async function createMarketSource(body: AdminRecord) { return adminRequest<AdminRecord>('/admin/market-data/sources', 'POST', body); }
export async function updateMarketSource(id: string, body: AdminRecord) { return adminRequest<AdminRecord>(`/admin/market-data/sources/${encodeURIComponent(id)}`, 'PATCH', body); }
export async function syncMarketSource(id: string) { return adminRequest<AdminRecord>(`/admin/market-data/sources/${encodeURIComponent(id)}/sync`, 'POST', {}); }
export async function reviewMarketObservation(id: string, status: 'verified' | 'rejected' | 'pending', reason: string) { return adminRequest<AdminRecord>(`/admin/market-data/observations/${encodeURIComponent(id)}/review`, 'PATCH', { status, reason }); }
export async function correctMarketObservation(id: string, body: AdminRecord) { return adminRequest<AdminRecord>(`/admin/market-data/observations/${encodeURIComponent(id)}/correction`, 'PATCH', body); }
export async function updateDispute(id: string, status: string, resolution: string) { return adminRequest<AdminRecord>(`/admin/disputes/${encodeURIComponent(id)}`, 'PATCH', { status, resolution }); }
export async function updateReport(id: string, status: 'under_review' | 'resolved' | 'rejected', resolution: string) { return adminRequest<AdminRecord>(`/admin/reports/${encodeURIComponent(id)}`, 'PATCH', { status, resolution }); }
export async function loadAdminSettings() { return adminRequest<{ settings: Record<string, unknown> }>('/admin/settings'); }
export async function loadAdminSecuritySettings() { return adminRequest<AdminRecord>('/admin/settings/security'); }
export async function loadAdminNotificationSettings() { return adminRequest<AdminRecord>('/admin/settings/notifications'); }
export async function saveAdminSettings(settings: Record<string, unknown>) { return adminRequest<AdminRecord>('/admin/settings', 'PATCH', settings); }
