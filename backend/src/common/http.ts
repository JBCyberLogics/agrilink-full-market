import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'REQUEST_FAILED',
    readonly field?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function sendData<T>(res: Response, data: T, status = 200, message = 'OK') {
  return res.status(status).json({ success: true, message, data });
}

export function sendList<T>(res: Response, items: T[], page: number, limit: number, total: number) {
  return res.json({ success: true, message: 'OK', data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
}

export function errorHandler(): ErrorRequestHandler {
  return (error, req, res, _next) => {
    const requestId = String(res.locals.requestId ?? '');
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        success: false, code: error.code, message: error.message,
        ...(error.field ? { field: error.field } : {}),
        ...(error.details ? { details: error.details } : {}),
        ...(requestId ? { requestId } : {}),
      });
    }
    if (error?.name === 'ValidationError' || error?.name === 'ZodError') {
      return res.status(422).json({ success: false, code: 'VALIDATION_FAILED', message: 'Check the submitted fields.', ...(requestId ? { requestId } : {}) });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, code: 'DUPLICATE_RECORD', message: 'A record with those details already exists.', ...(requestId ? { requestId } : {}) });
    }
    const status = Number(error?.statusCode ?? error?.status);
    if (status === 413) return res.status(413).json({ success: false, code: 'REQUEST_TOO_LARGE', message: 'The upload exceeds the allowed size.', ...(requestId ? { requestId } : {}) });
    if (status === 400 && error?.name === 'MulterError') return res.status(400).json({ success: false, code: 'INVALID_UPLOAD', message: 'The upload could not be accepted.', ...(requestId ? { requestId } : {}) });

    const route=req.path.replace(/\/payments\/mpesa\/callback\/[^/]+/,'/payments/mpesa/callback/[redacted]');
    console.error(JSON.stringify({ level: 'error', requestId: requestId || undefined, route, errorName: error?.name ?? 'Error', message: String(error?.message ?? 'unknown').slice(0, 300) }));
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'The request could not be completed.', ...(requestId ? { requestId } : {}) });
  };
}

export function requestId(_req: Request, res: Response, next: (error?: unknown) => void) {
  const id = String(res.getHeader('X-Request-Id') ?? '') || randomUUID();
  res.setHeader('X-Request-Id', id);
  res.locals.requestId = id;
  next();
}
