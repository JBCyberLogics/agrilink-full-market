import type { LoginCredentials } from '../contracts/auth.contract';

export type LoginFieldErrors = { identity?: string; password?: string };

/** Presence checks only; credential validity belongs to the backend. */
export function validateLoginCredentials(credentials: LoginCredentials): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  if (!credentials.identity.trim()) errors.identity = 'Enter your email or username.';
  if (!credentials.password) errors.password = 'Enter your password.';
  return errors;
}
