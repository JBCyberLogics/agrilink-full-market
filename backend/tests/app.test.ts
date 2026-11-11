import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5173';

const { createApp } = await import('../src/main.js');
const app = createApp();

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

  it('documents the actual admin login route', async () => {
    const response = await request(app).get('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.paths['/auth/admin/login']).toBeDefined();
    expect(response.body.paths['/auth/login-admin']).toBeUndefined();
  });
});
