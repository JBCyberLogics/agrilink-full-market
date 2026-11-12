import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiRequest: vi.fn(), adminApi: { request: vi.fn() } }));
vi.mock('./api/client', () => api);

import { assignAdministratorRole, assignSupportTicket, changeUserRole, createAdminNotification, createCategory, createFaq, decideUserVerification, loadAdminLedgerDetails, loadAdminListingDetails, loadAdminResource, loadAdminResourcePage, loadAdminSupportDetails, loadSupportAssignees, loadAdminUserDetails, loadAdminUserPage, loadAdminNotificationSettings, loadAdminSecuritySettings, runAiDiagnostics, sendSupportReply, updateAdminUserDetails, updateAdministratorStatus, updateAnnouncement, updateCategory, updateFaq, updateReport } from './adminService';

describe('administrator verification contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the backend verification queue instead of the general account list', async () => {
    api.apiRequest.mockResolvedValueOnce([{ id: 'user-1', verificationStatus: 'pending' }]);
    await expect(loadAdminResource('verifications')).resolves.toEqual([{ id: 'user-1', verificationStatus: 'pending' }]);
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/users/verifications?limit=100', 'GET', undefined);
  });

  it('allows the provider diagnostic to finish before the Admin client timeout', async () => {
    api.adminApi.request.mockImplementationOnce(({ path, method, body, timeoutMs, decode }: { path: string; method: string; body: unknown; timeoutMs: number; decode: (payload: unknown) => unknown }) => {
      expect({ path, method, body, timeoutMs }).toEqual({
        path: '/admin/ai/diagnostics', method: 'POST', body: {}, timeoutMs: 35_000,
      });
      return Promise.resolve(decode({ success: true, data: { available: true, provider: 'nvidia' } }));
    });
    await expect(runAiDiagnostics(30_000)).resolves.toEqual({ available: true, provider: 'nvidia' });
  });

  it('sends FAQ search to the persistent administrative query', async () => {
    api.apiRequest.mockResolvedValueOnce([{ id: 'faq-1', question: 'Where is the harvest report?' }]);
    await expect(loadAdminResource('faqs', { search: 'harvest report' })).resolves.toEqual([{ id: 'faq-1', question: 'Where is the harvest report?' }]);
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/faqs/manage?limit=100&search=harvest+report', 'GET', undefined);
  });

  it('creates in-app notifications for an existing account by email', async () => {
    api.apiRequest.mockResolvedValueOnce({ id: 'notification-1' });
    await createAdminNotification('farmer@example.test', 'Harvest update', 'A buyer asked about your listing.');
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/notifications', 'POST', {
      email: 'farmer@example.test', title: 'Harvest update', message: 'A buyer asked about your listing.',
    });
  });

  it('sends user search, filters and pagination to the backend and preserves list metadata', async () => {
    api.adminApi.request.mockImplementationOnce(({ path, decode }: { path: string; decode: (payload: unknown) => unknown }) => {
      expect(path).toBe('/admin/users/all-users?page=2&limit=25&search=Farmer+One&role=farmer&status=active');
      return decode({ data: [{ id: 'farmer-1', role: 'farmer' }], meta: { page: 2, limit: 25, total: 26, pages: 2 } });
    });
    await expect(loadAdminUserPage('users', { page: 2, limit: 25, search: 'Farmer One', role: 'farmer', status: 'active' })).resolves.toEqual({
      items: [{ id: 'farmer-1', role: 'farmer' }], meta: { page: 2, limit: 25, total: 26, pages: 2 },
    });
  });

  it('loads paged marketplace records from the backend and preserves nested metadata', async () => {
    api.adminApi.request.mockImplementationOnce(({ path, decode }: { path: string; decode: (payload: unknown) => unknown }) => {
      expect(path).toBe('/admin/categories?page=2&limit=25&search=grain');
      return decode({ data: { categories: [{ id: 'category-26', name: 'Grain' }], meta: { page: 2, limit: 25, total: 26, pages: 2 } } });
    });
    await expect(loadAdminResourcePage('categories', { page: 2, limit: 25, search: 'grain' })).resolves.toEqual({
      items: [{ id: 'category-26', name: 'Grain' }],
      meta: { page: 2, limit: 25, total: 26, pages: 2 },
    });
  });

  it('creates and renames categories through the persistent admin endpoints', async () => {
    api.apiRequest.mockResolvedValueOnce({ id: 'category-1', name: 'Grain', slug: 'grain', isActive: true });
    await expect(createCategory('Grain')).resolves.toMatchObject({ id: 'category-1', slug: 'grain' });
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/categories', 'POST', { name: 'Grain' });
    api.apiRequest.mockResolvedValueOnce({ id: 'category-1', name: 'Cereal Grain', slug: 'cereal-grain', isActive: false });
    await expect(updateCategory('category-1', { name: 'Cereal Grain', isActive: false })).resolves.toMatchObject({ slug: 'cereal-grain', isActive: false });
    expect(api.apiRequest).toHaveBeenLastCalledWith('/admin/categories/category-1', 'PATCH', { name: 'Cereal Grain', isActive: false });
  });

  it('loads protected order and payment detail resources with encoded identifiers', async () => {
    api.apiRequest.mockResolvedValueOnce({ type: 'payment', id: 'payment/one', status: 'pending' });
    await expect(loadAdminLedgerDetails('payment', 'payment/one')).resolves.toEqual({ type: 'payment', id: 'payment/one', status: 'pending' });
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/ledger/payment/payment%2Fone', 'GET', undefined);
  });

  it('loads protected listing ownership and moderation detail data', async () => {
    api.apiRequest.mockResolvedValueOnce({ listing: { id: 'listing/one' }, seller: { id: 'farmer-1' }, moderation: { history: [] } });
    await expect(loadAdminListingDetails('listing/one')).resolves.toMatchObject({ listing: { id: 'listing/one' }, seller: { id: 'farmer-1' } });
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/products/listing%2Fone/details', 'GET', undefined);
  });

  it('requests listing search and moderation status from the server page query', async () => {
    api.adminApi.request.mockImplementationOnce(({ path, decode }: { path: string; decode: (payload: unknown) => unknown }) => {
      expect(path).toBe('/admin/products?page=2&limit=25&search=maize&status=suspended');
      return decode({ data: [{ id: 'listing-26', status: 'suspended' }], meta: { page: 2, limit: 25, total: 26, pages: 2 } });
    });
    await expect(loadAdminResourcePage('listings', { page: 2, limit: 25, search: 'maize', status: 'suspended' })).resolves.toMatchObject({ items: [{ id: 'listing-26', status: 'suspended' }], meta: { total: 26, pages: 2 } });
  });

  it('loads the combined order and payment ledger with server-side filters and metadata', async () => {
    api.adminApi.request.mockImplementationOnce(({ path, decode }: { path: string; decode: (payload: unknown) => unknown }) => {
      expect(path).toBe('/admin/ledger?page=3&limit=25&search=INV-42&status=paid&type=payment&from=2026-10-01&to=2026-10-31');
      return decode({ data: [{ id: 'payment-42', recordType: 'payment', status: 'paid' }], meta: { page: 3, limit: 25, total: 51, pages: 3 } });
    });
    await expect(loadAdminResourcePage('transactions', { page: 3, limit: 25, search: 'INV-42', status: 'paid', type: 'payment', from: '2026-10-01', to: '2026-10-31' })).resolves.toEqual({
      items: [{ id: 'payment-42', recordType: 'payment', status: 'paid' }],
      meta: { page: 3, limit: 25, total: 51, pages: 3 },
    });
  });

  it('sends audit log search to the persistent backend query', async () => {
    api.adminApi.request.mockImplementationOnce(({ path, decode }: { path: string; decode: (payload: unknown) => unknown }) => {
      expect(path).toBe('/admin/audit-logs?page=2&limit=25&search=support.assigned&outcome=success&action=support.assigned&resource=contact-message&actor=admin%40example.test&from=2026-10-01&to=2026-10-31');
      return decode({ data: [{ id: 'audit-1', action: 'support.assigned' }], meta: { page: 2, limit: 25, total: 1, pages: 1 } });
    });
    await expect(loadAdminResourcePage('audit-logs', { page: 2, limit: 25, search: 'support.assigned', status: 'success', action: 'support.assigned', resource: 'contact-message', actor: 'admin@example.test', from: '2026-10-01', to: '2026-10-31' })).resolves.toMatchObject({ items: [{ action: 'support.assigned' }], meta: { total: 1 } });
  });

  it('submits a status decision and its explanation to the guarded endpoint', async () => {
    api.apiRequest.mockResolvedValueOnce({ id: 'user-1', verificationStatus: 'verified' });
    await decideUserVerification('user-1', 'verified', 'Documents checked by administrator.');
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/users/user-1/verification', 'PATCH', { status: 'verified', reason: 'Documents checked by administrator.' });
  });

  it('assigns a custom role through the administrator assignment operation', async () => {
    api.apiRequest.mockResolvedValueOnce({ adminRole: { id: 'role-1', name: 'Reviewer' } });
    await assignAdministratorRole('admin-1', 'role-1');
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/administrators/admin-1/role', 'PATCH', { roleId: 'role-1' });
  });

  it('changes administrator status through the dedicated permission-checked route with a reason', async () => {
    api.apiRequest.mockResolvedValueOnce({ id: 'admin-1', isActive: false, changed: true });
    await updateAdministratorStatus('admin-1', false, 'Access review requires temporary suspension.');
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/administrators/admin-1/status', 'PATCH', {
      isActive: false, reason: 'Access review requires temporary suspension.',
    });
  });

  it('updates an account role through the guarded administrator operation', async () => {
    api.apiRequest.mockResolvedValueOnce({ id: 'buyer-1', role: 'farmer' });
    await changeUserRole('buyer-1', 'farmer');
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/users/buyer-1/role', 'PATCH', { role: 'farmer' });
  });

  it('loads account details through the guarded admin identity endpoint', async () => {
    api.apiRequest.mockResolvedValueOnce({ user: { id: 'user-1' }, profile: { county: 'Kiambu' } });
    await expect(loadAdminUserDetails('user-1')).resolves.toEqual({ user: { id: 'user-1' }, profile: { county: 'Kiambu' } });
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/users/details/user-1', 'GET', undefined);
  });

  it('updates only permitted account profile fields through the admin endpoint', async () => {
    api.apiRequest.mockResolvedValueOnce({ user: { id: 'farmer-1', fullName: 'Farmer One' } });
    await expect(updateAdminUserDetails('farmer-1', { fullName: 'Farmer One', phone: null, county: 'Nakuru' })).resolves.toEqual({ user: { id: 'farmer-1', fullName: 'Farmer One' } });
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/users/details/farmer-1', 'PATCH', { fullName: 'Farmer One', phone: null, county: 'Nakuru' });
  });

  it('records a support reply through the support management endpoint', async () => {
    api.apiRequest.mockResolvedValueOnce({ deliveryStatus: 'not_configured' });
    await expect(sendSupportReply('ticket-1', 'We recorded your request.')).resolves.toEqual({ deliveryStatus: 'not_configured' });
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/support/ticket-1/reply', 'POST', { reply: 'We recorded your request.' });
  });

  it('loads support case history and assigns it to an administrator through guarded endpoints', async () => {
    api.apiRequest.mockResolvedValueOnce({ id: 'case-1', replies: [{ id: 'reply-1', deliveryStatus: 'not_configured' }] });
    await expect(loadAdminSupportDetails('case-1')).resolves.toMatchObject({ id: 'case-1', replies: [{ id: 'reply-1' }] });
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/support/case-1', 'GET', undefined);
    api.apiRequest.mockResolvedValueOnce({ assignees: [{ id: 'admin-1', email: 'admin@example.test' }] });
    await expect(loadSupportAssignees()).resolves.toHaveProperty('assignees.0.id', 'admin-1');
    expect(api.apiRequest).toHaveBeenLastCalledWith('/admin/support/assignees', 'GET', undefined);
    api.apiRequest.mockResolvedValueOnce({ id: 'case-1', assignedTo: { id: 'admin-1' } });
    await expect(assignSupportTicket('case-1', 'admin-1')).resolves.toMatchObject({ assignedTo: { id: 'admin-1' } });
    expect(api.apiRequest).toHaveBeenLastCalledWith('/admin/support/case-1/assignment', 'PATCH', { assignedTo: 'admin-1' });
  });

  it('updates announcement publication state through the guarded admin endpoint', async () => {
    api.apiRequest.mockResolvedValueOnce({ id: 'notice-1', status: 'published' });
    await expect(updateAnnouncement('notice-1', { status: 'published' })).resolves.toEqual({ id: 'notice-1', status: 'published' });
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/announcements/notice-1', 'PATCH', { status: 'published' });
  });

  it('updates report review state and resolution through the existing guarded endpoint', async () => {
    api.apiRequest.mockResolvedValueOnce({ id: 'report-1', status: 'under_review' });
    await updateReport('report-1', 'under_review', 'Assigned for administrator review.');
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/reports/report-1', 'PATCH', { status: 'under_review', resolution: 'Assigned for administrator review.' });
  });

  it('loads safe security and notification diagnostics without returning provider secrets', async () => {
    api.apiRequest.mockResolvedValueOnce({ csrfProtection: 'enabled' });
    await expect(loadAdminSecuritySettings()).resolves.toEqual({ csrfProtection: 'enabled' });
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/settings/security', 'GET', undefined);
    api.apiRequest.mockResolvedValueOnce({ channels: { inApp: 'available', email: 'unavailable', push: 'unavailable' } });
    await expect(loadAdminNotificationSettings()).resolves.toHaveProperty('channels.email', 'unavailable');
    expect(api.apiRequest).toHaveBeenLastCalledWith('/admin/settings/notifications', 'GET', undefined);
  });

  it('creates and activates FAQ content through the support management endpoints', async () => {
    api.apiRequest.mockResolvedValueOnce({ id: 'faq-1', isActive: true });
    await createFaq('How do I contact a farmer?', 'Open a listing and use its inquiry action.', 'Buyer Accounts');
    expect(api.apiRequest).toHaveBeenCalledWith('/admin/faqs/manage', 'POST', { question: 'How do I contact a farmer?', answer: 'Open a listing and use its inquiry action.', category: 'Buyer Accounts' });
    api.apiRequest.mockResolvedValueOnce({ id: 'faq-1', isActive: false });
    await updateFaq('faq-1', { isActive: false });
    expect(api.apiRequest).toHaveBeenLastCalledWith('/admin/faqs/manage/faq-1', 'PATCH', { isActive: false });
  });
});
