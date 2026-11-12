import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('test-only-password-hash'),
  verifyAndUpgradePassword: vi.fn().mockResolvedValue(true),
}));

process.env.NODE_ENV = 'test';
process.env.CORS_ORIGINS = 'http://localhost:5199,http://localhost:5173,http://localhost:4173,http://localhost:4199';
process.env.COOKIE_NAME = 'agrilink.sid';
process.env.USER_COOKIE_NAME = 'agrilink.test.farmer.sid';
process.env.ADMIN_COOKIE_NAME = 'agrilink.test.admin.sid';
process.env.SESSION_SECRET = 'test-only-session-secret-for-auth-realm-tests';

const USER_COOKIE = 'agrilink.test.farmer.sid';
const ADMIN_COOKIE = 'agrilink.test.admin.sid';
const FARMER_ORIGIN = 'http://localhost:5199';
const ADMIN_ORIGIN = 'http://localhost:5173';
const accounts = [
  { _id: '64a000000000000000000001', email: 'farmer@example.invalid', fullName: 'Test Farmer', role: 'farmer', isActive: true, isDeleted: false, isEmailVerified: true, refreshTokenVersion: 0 },
  { _id: '64a000000000000000000002', email: 'buyer@example.invalid', fullName: 'Test Buyer', role: 'buyer', isActive: true, isDeleted: false, isEmailVerified: true, refreshTokenVersion: 0 },
  { _id: '64a000000000000000000003', email: 'admin@example.invalid', fullName: 'Test Administrator', role: 'super_admin', isActive: true, isDeleted: false, isEmailVerified: true, refreshTokenVersion: 0 },
];
const sessions = new Map<string, any>();

const { createApp } = await import('../src/main.js');
const { Order, Product, RefreshToken, User } = await import('../src/database/models.js');
const { verifyAndUpgradePassword } = await import('../src/services/password.js');
const app = createApp();

function accountQuery(value: any) {
  return { select: vi.fn().mockResolvedValue(value) } as any;
}

function setCookieHeaders(headers: string[] | string | undefined) {
  return Array.isArray(headers) ? headers : headers ? [headers] : [];
}

function applySetCookies(jar: Map<string, string>, headers: string[] | string | undefined) {
  for (const header of setCookieHeaders(headers)) {
    const pair = header.split(';', 1)[0] ?? '';
    const splitAt = pair.indexOf('=');
    if (splitAt < 0) continue;
    const name = pair.slice(0, splitAt);
    const value = pair.slice(splitAt + 1);
    if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(header)) jar.delete(name);
    else jar.set(name, value);
  }
}

const cookieHeader = (jar: Map<string, string>) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

async function createCsrf(jar = new Map<string, string>(), realm: 'marketplace' | 'admin' = 'marketplace') {
  const path = realm === 'admin' ? '/api/v1/auth/admin/csrf' : '/api/v1/auth/csrf';
  const response = await request(app).get(path).expect(200);
  applySetCookies(jar, response.headers['set-cookie']);
  return { jar, token: response.body.data.csrfToken };
}

async function loginMarketplace(jar: Map<string, string>, csrf: string, email: string, role: 'farmer' | 'buyer') {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', FARMER_ORIGIN)
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf)
    .send({ email, password: 'test-only-password', role });
  applySetCookies(jar, response.headers['set-cookie']);
  return response;
}

async function loginAdmin(jar: Map<string, string>, csrf: string) {
  const response = await request(app)
    .post('/api/v1/auth/admin/login')
    .set('Origin', ADMIN_ORIGIN)
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf)
    .send({ username: 'admin@example.invalid', password: 'test-only-password' });
  applySetCookies(jar, response.headers['set-cookie']);
  return response;
}

beforeEach(() => {
  sessions.clear();
  vi.restoreAllMocks();
  vi.mocked(verifyAndUpgradePassword).mockResolvedValue(true);

  vi.spyOn(User, 'findOne').mockImplementation(((filter: any) => {
    const identity = filter?.$or?.flatMap((condition: any) => Object.values(condition)).find(Boolean);
    const match = accounts.find((account) => account.email === identity);
    return accountQuery(match);
  }) as any);
  vi.spyOn(User, 'findById').mockImplementation(((id: unknown) => accountQuery(accounts.find((account) => account._id === String(id)))) as any);
  vi.spyOn(User, 'updateOne').mockResolvedValue({ acknowledged: true } as any);
  vi.spyOn(RefreshToken, 'create').mockImplementation((async (document: any) => {
    const session = { ...document, _id: `test-session-${sessions.size + 1}` };
    sessions.set(document.tokenHash, session);
    return session;
  }) as any);
  vi.spyOn(RefreshToken, 'findOne').mockImplementation(((filter: any) => {
    const session = sessions.get(filter.tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return Promise.resolve(null) as any;
    return Promise.resolve(session) as any;
  }) as any);
  vi.spyOn(RefreshToken, 'updateOne').mockImplementation((async (filter: any, update: any) => {
    const session = [...sessions.values()].find((row) => String(row._id) === String(filter._id));
    if (session) Object.assign(session, update.$set ?? {});
    return { acknowledged: true, modifiedCount: session ? 1 : 0 } as any;
  }) as any);
});

describe('separate marketplace and administrator sessions', () => {
  it('sets distinct cookies and keeps both identities active in one browser jar', async () => {
    const { jar, token } = await createCsrf();
    const { token: adminToken } = await createCsrf(jar, 'admin');
    const farmerLogin = await loginMarketplace(jar, token, 'farmer@example.invalid', 'farmer');
    expect(farmerLogin.status).toBe(200);
    expect(setCookieHeaders(farmerLogin.headers['set-cookie']).some((value) => value.startsWith(`${USER_COOKIE}=`))).toBe(true);

    const adminLogin = await loginAdmin(jar, adminToken);
    expect(adminLogin.status).toBe(200);
    expect(setCookieHeaders(adminLogin.headers['set-cookie']).some((value) => value.startsWith(`${ADMIN_COOKIE}=`))).toBe(true);
    expect(jar.has(USER_COOKIE)).toBe(true);
    expect(jar.has(ADMIN_COOKIE)).toBe(true);

    const farmerSession = await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(jar)).expect(200);
    const adminSession = await request(app).get('/api/v1/auth/admin/session').set('Cookie', cookieHeader(jar)).expect(200);
    expect(farmerSession.body.data.user.id).toBe(accounts[0]!._id);
    expect(adminSession.body.data.administrator.id).toBe(accounts[2]!._id);
  });

  it('keeps the administrator session when a Farmer signs in afterward', async () => {
    const { jar, token } = await createCsrf();
    const { token: adminToken } = await createCsrf(jar, 'admin');
    expect((await loginAdmin(jar, adminToken)).status).toBe(200);
    expect((await loginMarketplace(jar, token, 'farmer@example.invalid', 'farmer')).status).toBe(200);
    expect(jar.has(ADMIN_COOKIE)).toBe(true);
    expect(jar.has(USER_COOKIE)).toBe(true);

    const adminSession = await request(app).get('/api/v1/auth/admin/session').set('Cookie', cookieHeader(jar)).expect(200);
    const farmerSession = await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(jar)).expect(200);
    expect(adminSession.body.data.administrator.id).toBe(accounts[2]!._id);
    expect(farmerSession.body.data.user.id).toBe(accounts[0]!._id);
  });

  it('uses the marketplace realm for buyers and rejects administrator credentials on marketplace login', async () => {
    const { jar, token } = await createCsrf();
    const buyerLogin = await loginMarketplace(jar, token, 'buyer@example.invalid', 'buyer');
    expect(buyerLogin.status).toBe(200);
    expect(jar.has(USER_COOKIE)).toBe(true);
    expect(jar.has(ADMIN_COOKIE)).toBe(false);

    const adminAsMarketplace = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', FARMER_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', token)
      .send({ email: 'admin@example.invalid', password: 'test-only-password' });
    expect(adminAsMarketplace.status).toBe(401);
    expect(adminAsMarketplace.body).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Unable to sign in with those credentials. Please check your details and try again.',
    });
    expect(JSON.stringify(adminAsMarketplace.body)).not.toMatch(/farmer|buyer|admin|role/i);
  });

  it('uses the same generic response for wrong marketplace role, unknown identity, and wrong password', async () => {
    const { jar, token } = await createCsrf();
    const responses = [
      await loginMarketplace(jar, token, 'farmer@example.invalid', 'buyer'),
      await loginMarketplace(jar, token, 'buyer@example.invalid', 'farmer'),
      await loginMarketplace(jar, token, 'missing@example.invalid', 'buyer'),
    ];
    vi.mocked(verifyAndUpgradePassword).mockResolvedValueOnce(false);
    responses.push(await loginMarketplace(jar, token, 'farmer@example.invalid', 'farmer'));

    const publicError = (response: any) => ({
      status: response.status,
      code: response.body.code,
      message: response.body.message,
      field: response.body.field,
      details: response.body.details,
    });
    const expected = {
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Unable to sign in with those credentials. Please check your details and try again.',
      field: undefined,
      details: undefined,
    };
    for (const response of responses) {
      expect(publicError(response)).toEqual(expected);
      expect(JSON.stringify(response.body)).not.toMatch(/farmer|buyer|admin|role/i);
    }
  });

  it('does not reveal marketplace roles from the AgriLink Control login route', async () => {
    const { jar } = await createCsrf();
    const { token } = await createCsrf(jar, 'admin');
    const response = await request(app)
      .post('/api/v1/auth/admin/login')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', token)
      .send({ username: 'farmer@example.invalid', password: 'test-only-password' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Unable to sign in with those credentials. Please check your details and try again.',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/farmer|buyer|admin|role/i);
  });

  it('rotates and logs out only the session realm addressed by the route', async () => {
    const { jar, token } = await createCsrf();
    const { token: adminToken } = await createCsrf(jar, 'admin');
    expect((await loginMarketplace(jar, token, 'farmer@example.invalid', 'farmer')).status).toBe(200);
    expect((await loginAdmin(jar, adminToken)).status).toBe(200);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh-token')
      .set('Origin', FARMER_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', token)
      .send({})
      .expect(200);
    applySetCookies(jar, refresh.headers['set-cookie']);
    expect(setCookieHeaders(refresh.headers['set-cookie']).some((value) => value.startsWith(`${USER_COOKIE}=`))).toBe(true);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(jar)).expect(200);
    await request(app).get('/api/v1/auth/admin/session').set('Cookie', cookieHeader(jar)).expect(200);

    const adminRefresh = await request(app)
      .post('/api/v1/auth/admin/refresh-token')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', adminToken)
      .send({})
      .expect(200);
    applySetCookies(jar, adminRefresh.headers['set-cookie']);
    expect(setCookieHeaders(adminRefresh.headers['set-cookie']).some((value) => value.startsWith(`${ADMIN_COOKIE}=`))).toBe(true);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(jar)).expect(200);

    const adminLogout = await request(app)
      .post('/api/v1/auth/admin/logout')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', adminToken)
      .send({})
      .expect(200);
    applySetCookies(jar, adminLogout.headers['set-cookie']);
    expect(adminLogout.body.data.serverInvalidated).toBe(true);
    expect(jar.has(ADMIN_COOKIE)).toBe(false);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(jar)).expect(200);

    expect((await loginAdmin(jar, adminToken)).status).toBe(200);
    const farmerLogout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', FARMER_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', token)
      .send({})
      .expect(200);
    applySetCookies(jar, farmerLogout.headers['set-cookie']);
    expect(farmerLogout.body.data.serverInvalidated).toBe(true);
    expect(jar.has(USER_COOKIE)).toBe(false);
    await request(app).get('/api/v1/auth/admin/session').set('Cookie', cookieHeader(jar)).expect(200);
  });

  it('keeps role checks and self-profile identity bound to the selected session', async () => {
    const { jar, token } = await createCsrf();
    const { token: adminToken } = await createCsrf(jar, 'admin');
    await loginAdmin(jar, adminToken);
    const adminCookie = new Map(jar);
    adminCookie.delete(USER_COOKIE);
    for (const path of ['/api/v1/users/my-profile', '/api/v1/profiles/me', '/api/v1/product/seller', '/api/v1/order']) {
      const response = await request(app).get(path).set('Cookie', cookieHeader(adminCookie));
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('SESSION_REALM_MISMATCH');
    }

    const farmerJar = new Map<string, string>();
    const csrf = await createCsrf(farmerJar);
    await loginMarketplace(farmerJar, csrf.token, 'farmer@example.invalid', 'farmer');
    const profile = await request(app)
      .get('/api/v1/users/my-profile?userId=64a000000000000000000003')
      .set('Cookie', cookieHeader(farmerJar))
      .expect(200);
    expect(profile.body.data.user.id).toBe(accounts[0]!._id);
    const adminEndpoint = await request(app).get('/api/v1/admin/administrators').set('Cookie', cookieHeader(farmerJar));
    expect(adminEndpoint.status).toBe(403);
    expect(adminEndpoint.body.code).toBe('SESSION_REALM_MISMATCH');

    const buyerJar = new Map<string, string>();
    const buyerCsrf = await createCsrf(buyerJar);
    await loginMarketplace(buyerJar, buyerCsrf.token, 'buyer@example.invalid', 'buyer');
    const buyerFarmerRoute = await request(app).get('/api/v1/product/seller').set('Cookie', cookieHeader(buyerJar));
    expect(buyerFarmerRoute.status).toBe(403);
    expect(buyerFarmerRoute.body.code).toBe('FORBIDDEN');
  });

  it('filters seller listings and orders by the authenticated Farmer identity', async () => {
    const { jar, token } = await createCsrf();
    await loginMarketplace(jar, token, 'farmer@example.invalid', 'farmer');
    const productQuery = { sort: vi.fn().mockReturnThis(), skip: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    const orderQuery = { sort: vi.fn().mockReturnThis(), skip: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    const productFind = vi.spyOn(Product, 'find').mockReturnValue(productQuery as any);
    const orderFind = vi.spyOn(Order, 'find').mockReturnValue(orderQuery as any);
    vi.spyOn(Product, 'countDocuments').mockResolvedValue(0 as any);
    vi.spyOn(Order, 'countDocuments').mockResolvedValue(0 as any);

    await request(app).get('/api/v1/product/seller').set('Cookie', cookieHeader(jar)).expect(200);
    await request(app).get('/api/v1/order').set('Cookie', cookieHeader(jar)).expect(200);

    const farmerId = accounts[0]!._id;
    expect(productFind.mock.calls[0]?.[0]).toEqual({ $or: [{ farmer: farmerId }, { sellerId: farmerId }], isDeleted: { $ne: true } });
    expect(orderFind.mock.calls[0]?.[0]).toEqual({ $or: [{ farmer: farmerId }, { sellerId: farmerId }] });
  });

  it('keeps CSRF and the two approved credentialed preflights enabled', async () => {
    const missingCsrf = await request(app).post('/api/v1/auth/logout').send({});
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.code).toBe('CSRF_VALIDATION_FAILED');

    for (const origin of [FARMER_ORIGIN, ADMIN_ORIGIN]) {
      const response = await request(app)
        .options('/api/v1/auth/admin/refresh-token')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      const headers = String(response.headers['access-control-allow-headers']).toLowerCase();
      expect(headers).toContain('content-type');
      expect(headers).toContain('x-csrf-token');
    }
  });

  it('keeps the marketplace and administrator CSRF double-submit pairs separate', async () => {
    const { jar, token: marketplaceToken } = await createCsrf();
    const { token: adminToken } = await createCsrf(jar, 'admin');
    expect(jar.has('agrilink.csrf')).toBe(true);
    expect(jar.has('agrilink.admin.csrf')).toBe(true);

    const wrongRealm = await request(app)
      .post('/api/v1/auth/admin/login')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', cookieHeader(jar))
      .set('X-CSRF-Token', marketplaceToken)
      .send({ username: 'admin@example.invalid', password: 'test-only-password' });
    expect(wrongRealm.status).toBe(403);
    expect(wrongRealm.body.code).toBe('CSRF_VALIDATION_FAILED');

    expect((await loginMarketplace(jar, marketplaceToken, 'farmer@example.invalid', 'farmer')).status).toBe(200);
    expect((await loginAdmin(jar, adminToken)).status).toBe(200);
    expect(jar.has('agrilink.csrf')).toBe(true);
    expect(jar.has('agrilink.admin.csrf')).toBe(true);
  });

  it('rejects credentialed requests when the browser origin belongs to the other frontend', async () => {
    const { jar, token: marketplaceToken } = await createCsrf();
    const { token: adminToken } = await createCsrf(jar, 'admin');
    expect((await loginMarketplace(jar, marketplaceToken, 'farmer@example.invalid', 'farmer')).status).toBe(200);
    expect((await loginAdmin(jar, adminToken)).status).toBe(200);

    const adminSessionFromMarketplace = await request(app).get('/api/v1/auth/admin/session')
      .set('Origin', FARMER_ORIGIN).set('Cookie', cookieHeader(jar));
    const marketplaceSessionFromAdmin = await request(app).get('/api/v1/auth/me')
      .set('Origin', ADMIN_ORIGIN).set('Cookie', cookieHeader(jar));
    const adminCsrfFromMarketplace = await request(app).get('/api/v1/auth/admin/csrf').set('Origin', FARMER_ORIGIN);
    const adminLoginFromMarketplace = await request(app).post('/api/v1/auth/admin/login')
      .set('Origin', FARMER_ORIGIN).set('Cookie', cookieHeader(jar)).set('X-CSRF-Token', adminToken)
      .send({ username: 'admin@example.invalid', password: 'test-only-password' });

    for (const response of [adminSessionFromMarketplace, marketplaceSessionFromAdmin, adminCsrfFromMarketplace, adminLoginFromMarketplace]) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('SESSION_REALM_ORIGIN_MISMATCH');
    }
  });
});
