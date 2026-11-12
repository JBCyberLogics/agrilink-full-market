import type { PageId, PageDefinition } from './navigation';

const pagePermissions: Record<PageId, string[]> = {
  dashboard: ['users.read', 'audit.read'],
  analytics: ['reports.read'],
  alerts: ['announcements.manage'],
  users: ['users.read'], farmers: ['users.read'], buyers: ['users.read'],
  verifications: ['users.verify'], administrators: ['administrators.manage'], roles: ['administrators.manage'],
  listings: ['marketplace.read'], categories: ['marketplace.read'], markets: ['market-data.manage'],
  transactions: ['orders.read', 'payments.read'], disputes: ['support.manage'],
  'ai-control': ['ai.read'], nvidia: ['ai.read'], models: ['ai.read'], 'agent-studio': ['ai.read'],
  capabilities: ['ai.read'], algorithms: ['algorithms.manage'], 'market-intelligence': ['market-data.manage'],
  'data-sources': ['market-data.manage'], 'ai-diagnostics': ['ai.configure'], 'ai-usage': ['ai.read'],
  support: ['support.manage'], announcements: ['announcements.manage'], faqs: ['support.manage'],
  reports: ['reports.read'], 'audit-logs': ['audit.read'], 'system-health': ['users.read'],
  'general-settings': ['settings.read'], 'security-settings': ['settings.read'],
  'marketplace-settings': ['settings.read'], 'notification-settings': ['settings.read'],
};

export function canOpenPage(page: PageDefinition, permissions: readonly string[]): boolean {
  return pagePermissions[page.id].every((permission) => permissions.includes(permission));
}

