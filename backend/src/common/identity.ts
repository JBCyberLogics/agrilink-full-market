import type { Request } from 'express';
import { HttpError } from './http.js';
import { AdminRole } from '../database/models.js';

export type AppRole = 'farmer' | 'buyer' | 'admin' | 'super_admin';

export function normalizeRole(value: unknown): AppRole | null {
  const role = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['farmer', 'seller'].includes(role)) return 'farmer';
  if (['buyer', 'customer'].includes(role)) return 'buyer';
  if (['admin', 'administrator'].includes(role)) return 'admin';
  if (['super_admin', 'superadmin'].includes(role)) return 'super_admin';
  return null;
}

export function displayUser(user: any) {
  const firstName = typeof user.firstName === 'string' ? user.firstName.trim() : '';
  const lastName = typeof user.lastName === 'string' ? user.lastName.trim() : '';
  const fullName = user.fullName ?? user.name ?? [firstName, lastName].filter(Boolean).join(' ');
  const role = normalizeRole(user.role);
  return {
    id: String(user._id ?? user.id),
    name: fullName || user.email || 'Account',
    fullName: fullName || user.email || 'Account',
    firstName,
    lastName,
    email: user.email,
    role: role === 'farmer' ? 'seller' : role === 'buyer' ? 'customer' : role,
    accountType: role,
    image: user.image ?? user.profilePicture ?? user.avatarUrl ?? null,
    phone: user.phone ?? null,
    county: user.county ?? user.city ?? null,
    createdAt: user.createdAt ?? null,
    isEmailVerified: user.isEmailVerified === true,
  };
}

export function requireIdentity(req: Request) {
  if (!req.user) throw new HttpError(401, 'Sign in to continue.', 'UNAUTHENTICATED');
  return req.user;
}

export function requireRole(req: Request, roles: AppRole[]) {
  const user = requireIdentity(req);
  const role = normalizeRole(user.role);
  if (!role || !roles.includes(role)) throw new HttpError(403, 'You do not have permission to perform this action.', 'FORBIDDEN');
  return user;
}

export const ADMIN_ROLES: AppRole[] = ['admin', 'super_admin'];

export function permissionsForRole(roleValue: unknown) {
  const role = normalizeRole(roleValue);
  if (role === 'super_admin') return [
    'users.read', 'users.update', 'users.verify', 'users.roles.manage',
    'marketplace.read', 'marketplace.manage', 'orders.read', 'orders.manage',
    'payments.read', 'support.manage', 'announcements.manage', 'reports.read',
    'audit.read', 'ai.read', 'ai.configure', 'algorithms.manage',
    'market-data.manage', 'settings.read', 'settings.update', 'administrators.manage',
  ];
  if (role === 'admin') return [
    'users.read', 'users.update', 'users.verify', 'marketplace.read',
    'marketplace.manage', 'orders.read', 'orders.manage', 'payments.read',
    'support.manage', 'announcements.manage', 'reports.read', 'audit.read',
    'ai.read', 'algorithms.manage', 'market-data.manage', 'settings.read', 'settings.update',
  ];
  return [];
}

export const ALL_ADMIN_PERMISSIONS = [
  'users.read','users.update','users.verify','users.roles.manage','marketplace.read','marketplace.manage',
  'orders.read','orders.manage','payments.read','support.manage','announcements.manage','reports.read',
  'audit.read','ai.read','ai.configure','algorithms.manage','market-data.manage','settings.read','settings.update','administrators.manage',
] as const;

export function hasPermission(user: any, permission: string) {
  return permissionsForRole(user?.role).includes(permission);
}

export async function permissionsForUser(user: any) {
  if (user?.adminRoleId) {
    const role: any = await AdminRole.findOne({ _id: user.adminRoleId, isActive: true });
    return role?.permissions ?? [];
  }
  return permissionsForRole(user?.role);
}
