import { AuditLog } from '../database/models.js';

const SECRET_KEY = /(password|secret|token|api.?key|authorization|cookie|prompt|content)/i;

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SECRET_KEY.test(key))
    .slice(0, 40));
}

export async function writeAudit(input: {
  actor?: unknown;
  action: string;
  resource: string;
  resourceId?: string;
  outcome?: 'success' | 'denied' | 'failure';
  metadata?: Record<string, unknown>;
}) {
  await AuditLog.create({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId,
    outcome: input.outcome ?? 'success',
    metadata: safeMetadata(input.metadata),
    createdAt: new Date(),
  });
}
