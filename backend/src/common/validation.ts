import { Types } from 'mongoose';
import { z } from 'zod';
import { HttpError } from './http.js';

export function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new HttpError(422, first?.message ?? 'Check the submitted fields.', 'VALIDATION_FAILED', first?.path.join('.'));
  }
  return parsed.data;
}

export function objectId(value: unknown, field = 'id') {
  const text = String(value ?? '');
  if (!Types.ObjectId.isValid(text)) throw new HttpError(400, 'The requested record identifier is invalid.', 'INVALID_ID', field);
  return new Types.ObjectId(text);
}

export function pagination(query: Record<string, unknown>) {
  const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

export function boundedText(value: unknown, maxLength: number, field: string, minLength = 1) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (clean.length < minLength || clean.length > maxLength) throw new HttpError(422, 'Enter a valid ' + field + '.', 'VALIDATION_FAILED', field);
  return clean;
}
