import { apiRequest } from './api/client';
import type { ApiMethod } from './api/client';

export type AdminRecord = Record<string, unknown>;

export const adminRequest = <T = unknown>(path: string, method: ApiMethod = 'GET', body?: unknown) => apiRequest<T>(path, method, body);
export const loadAdminDashboard = () => adminRequest<AdminRecord>('/admin/dashboard');
export const loadAdminAnalytics = (query = '') => adminRequest<AdminRecord>(`/admin/analytics/summary${query}`);
export const loadAdminActivity = (query = '') => adminRequest<AdminRecord[]>(`/admin/audit-logs${query}`);
export const loadAiConfiguration = () => adminRequest<AdminRecord>('/admin/ai/config');
export const saveAiConfiguration = (body: AdminRecord) => adminRequest<AdminRecord>('/admin/ai/config', 'PUT', body);
export const runAiDiagnostics = () => adminRequest<AdminRecord>('/admin/ai/diagnostics', 'POST', {});
export const loadAiUsage = () => adminRequest<AdminRecord>('/admin/ai/usage');
export const loadReadiness = () => adminRequest<AdminRecord>('/health/ready');
export const loadAdminNotifications = () => adminRequest<AdminRecord[]>('/notifications?limit=8');
export const markAdminNotificationRead = (id: string) => adminRequest<AdminRecord>(`/notifications/${encodeURIComponent(id)}/read`, 'PATCH', {});
export const loadMatchingConfiguration = () => adminRequest<AdminRecord>('/admin/algorithms/matching');
export const saveMatchingConfiguration = (body: AdminRecord) => adminRequest<AdminRecord>('/admin/algorithms/matching', 'PUT', body);
export const scoreMatchingCandidate = (body: AdminRecord) => adminRequest<AdminRecord>('/admin/algorithms/matching/score', 'POST', body);

function userEndpoint(role?: string) { return `/admin/users/all-users?limit=100${role ? `&role=${encodeURIComponent(role)}` : ''}`; }
const resourcePaths: Record<string, string> = {
  users: userEndpoint(), farmers: userEndpoint('farmer'), buyers: userEndpoint('buyer'), verifications: userEndpoint(), administrators: '/admin/administrators',
  roles: '/admin/roles', listings: '/admin/products', categories: '/admin/categories', markets: '/admin/market-data',
  transactions: '/admin/transactions', disputes: '/admin/disputes', models: '/admin/ai/config', 'market-intelligence': '/admin/market-data/observations?limit=100',
  'data-sources': '/admin/market-data/sources?limit=100', support: '/admin/support', announcements: '/admin/announcements', reports: '/admin/reports',
  'audit-logs': '/admin/audit-logs?limit=100', alerts: '/health/ready',
};

export async function loadAdminResource(id: string): Promise<unknown> {
  const path = resourcePaths[id];
  if (!path) throw new Error('This administrative view has no backend operation.');
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
  if (id === 'market-intelligence') return Array.isArray(result) ? result : result?.data ?? result?.items ?? [];
  if (id === 'models') return [{ provider: result.hasApiKey ? 'NVIDIA' : 'Not configured', model: result.model || '—', baseUrl: result.baseUrl || '—', status: result.enabled ? 'enabled' : 'unavailable' }];
  if (id === 'markets' || id === 'alerts') return [result];
  return Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : Array.isArray(result?.items) ? result.items : [];
}

export async function toggleAccountStatus(id: string) { return adminRequest<AdminRecord>(`/admin/users/${encodeURIComponent(id)}/block`, 'PATCH', {}); }
export async function moderateListing(id: string, status: string, reason: string) { return adminRequest<AdminRecord>(`/admin/products/${encodeURIComponent(id)}/moderation`, 'PATCH', { status, reason }); }
export async function updateOrderStatus(id: string, status: string, reason: string) { return adminRequest<AdminRecord>(`/admin/orders/${encodeURIComponent(id)}/status`, 'PATCH', { status, reason }); }
export async function updateCategory(id: string, body: AdminRecord) { return adminRequest<AdminRecord>(`/admin/categories/${encodeURIComponent(id)}`, 'PATCH', body); }
export async function createCategory(name: string) { return adminRequest<AdminRecord>('/admin/categories', 'POST', { name }); }
export async function updateSupportTicket(id: string, status: string) { return adminRequest<AdminRecord>(`/admin/support/${encodeURIComponent(id)}`, 'PATCH', { status }); }
export async function createAnnouncement(title: string, message: string, status = 'draft') { return adminRequest<AdminRecord>('/admin/announcements', 'POST', { title, message, status }); }
export async function createMarketSource(body: AdminRecord) { return adminRequest<AdminRecord>('/admin/market-data/sources', 'POST', body); }
export async function updateMarketSource(id: string, body: AdminRecord) { return adminRequest<AdminRecord>(`/admin/market-data/sources/${encodeURIComponent(id)}`, 'PATCH', body); }
export async function syncMarketSource(id: string) { return adminRequest<AdminRecord>(`/admin/market-data/sources/${encodeURIComponent(id)}/sync`, 'POST', {}); }
export async function reviewMarketObservation(id: string, status: 'verified' | 'rejected' | 'pending', reason: string) { return adminRequest<AdminRecord>(`/admin/market-data/observations/${encodeURIComponent(id)}/review`, 'PATCH', { status, reason }); }
export async function correctMarketObservation(id: string, body: AdminRecord) { return adminRequest<AdminRecord>(`/admin/market-data/observations/${encodeURIComponent(id)}/correction`, 'PATCH', body); }
export async function updateDispute(id: string, status: string, resolution: string) { return adminRequest<AdminRecord>(`/admin/disputes/${encodeURIComponent(id)}`, 'PATCH', { status, resolution }); }
export async function loadAdminSettings() { return adminRequest<{ settings: Record<string, unknown> }>('/admin/settings'); }
export async function saveAdminSettings(settings: Record<string, unknown>) { return adminRequest<AdminRecord>('/admin/settings', 'PATCH', settings); }
