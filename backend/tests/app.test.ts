import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5199,http://localhost:4173,http://localhost:4199';

const { createApp } = await import('../src/main.js');
const { User } = await import('../src/database/models.js');
const app = createApp();
const limiterApp = createApp();
const supportLimiterApp = createApp();

describe('HTTP boundary', () => {
  it('provides application liveness without requiring MongoDB', async () => {
    const response = await request(app).get('/api/v1/health/live');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('alive');
  });

  it('requires a valid double-submit CSRF token for browser writes', async () => {
    const response = await request(app).post('/api/v1/auth/logout').send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CSRF_VALIDATION_FAILED');
  });

  it('allows the farmer app OTP verification preflight with cookie and CSRF headers', async () => {
    const response = await request(app)
      .options('/api/v1/users/create-user-verify-otp')
      .set('Origin', 'http://localhost:5199')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5199');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    const allowedHeaders = (response.headers['access-control-allow-headers'] ?? '').toLowerCase().split(/,\s*/);
    expect(allowedHeaders).toContain('content-type');
    expect(allowedHeaders).toContain('x-csrf-token');
  });

  it('documents the actual admin login route', async () => {
    const response = await request(app).get('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.paths['/auth/admin/login']).toBeDefined();
    expect(response.body.paths['/auth/login-admin']).toBeUndefined();
  });

  it('keeps admin login limited while isolating it from the shared auth IP bucket', async () => {
    let csrfToken = '';
    let csrfCookie = '';
    for (let index = 0; index < 40; index += 1) {
      const response = await request(limiterApp).get('/api/v1/auth/admin/csrf').expect(200);
      csrfToken = response.body.data.csrfToken;
      csrfCookie = response.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    }
    expect(csrfCookie).toContain('agrilink.admin.csrf=');

    const findOne = vi.spyOn(User, 'findOne').mockImplementation(() => ({
      select: vi.fn().mockResolvedValue(null),
    } as never));
    const failedLogin = () => request(limiterApp)
      .post('/api/v1/auth/admin/login')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ username: 'missing-admin-account', password: 'incorrect-password' });

    try {
      const first = await failedLogin();
      expect(first.status).toBe(401);
      expect(first.headers['ratelimit-limit']).toBe('40');

      for (let index = 1; index < 40; index += 1) {
        expect((await failedLogin()).status).toBe(401);
      }

      const limited = await failedLogin();
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toMatch(/^\d+$/);
      expect(limited.headers['ratelimit-limit']).toBe('40');
    } finally {
      findOne.mockRestore();
    }
  });

  it('rate limits public support submissions without touching the database for invalid requests', async () => {
    const csrfResponse = await request(supportLimiterApp).get('/api/v1/auth/csrf').expect(200);
    const csrfToken = csrfResponse.body.data.csrfToken;
    const csrfCookie = csrfResponse.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    const invalidSupportSubmission = () => request(supportLimiterApp)
      .post('/api/v1/contact-message')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({});
    for (let index = 0; index < 10; index += 1) expect((await invalidSupportSubmission()).status).toBe(422);
    const limited = await invalidSupportSubmission();
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });
});
