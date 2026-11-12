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

function redactCheckoutDiagnostic(value: unknown, maxLength: number) {
  return String(value ?? 'unknown')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, '[REDACTED_MONGODB_URI]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?254|0)[\d()\s-]{8,}\b/g, '[REDACTED_PHONE]')
    .replace(/((?:phone|email|address|postal|county|city|token|key|secret|password|cookie|authorization)[\w.[\]-]*\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^,;\n}]+)/gi, '$1[REDACTED]')
    .slice(0, maxLength);
}

/** Checkout-only diagnostics. Never include request bodies, identifiers, or cookies. */
export function logCheckoutDiagnostic(res: Response, event: string, error?: unknown) {
  const context = res.locals.checkoutDiagnostics ?? {};
  const source = error as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown } | undefined;
  const errorCode = source?.code;
  const level = event === 'checkout_completed' || event === 'checkout_replayed' || event === 'checkout_completed_degraded' ? 'info' : 'error';
  const record = JSON.stringify({
    level,
    event,
    requestId: String(res.locals.requestId ?? '') || undefined,
    route: '/api/v1/checkout',
    stage: String(context.stage ?? 'unknown'),
    transactionOutcome: String(context.transactionOutcome ?? 'unknown'),
    idempotencyOutcome: String(context.idempotencyOutcome ?? 'unknown'),
    ...(error ? {
      errorName: redactCheckoutDiagnostic(source?.name ?? 'Error', 80),
      ...(typeof errorCode === 'string' || typeof errorCode === 'number' ? { errorCode: String(errorCode).slice(0, 80) } : {}),
      message: redactCheckoutDiagnostic(source?.message ?? 'unknown', 300),
      ...(typeof source?.stack === 'string' ? { stack: redactCheckoutDiagnostic(source.stack, 6000) } : {}),
    } : {}),
  });
  if (level === 'info') console.info(record);
  else console.error(record);
}

export function errorHandler(): ErrorRequestHandler {
  return (error, req, res, _next) => {
    const requestId = String(res.locals.requestId ?? '');
    if (error instanceof HttpError) {
      if (error.status >= 500 && res.locals.checkoutDiagnostics) logCheckoutDiagnostic(res, 'checkout_failed', error);
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

    if (res.locals.checkoutDiagnostics) logCheckoutDiagnostic(res, 'checkout_failed', error);
    else {
      const route=req.path.replace(/\/payments\/mpesa\/callback\/[^/]+/,'/payments/mpesa/callback/[redacted]');
      console.error(JSON.stringify({ level: 'error', requestId: requestId || undefined, route, errorName: error?.name ?? 'Error', message: String(error?.message ?? 'unknown').slice(0, 300) }));
    }
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'The request could not be completed.', ...(requestId ? { requestId } : {}) });
  };
}

export function requestId(_req: Request, res: Response, next: (error?: unknown) => void) {
  const id = String(res.getHeader('X-Request-Id') ?? '') || randomUUID();
  res.setHeader('X-Request-Id', id);
  res.locals.requestId = id;
  next();
}
