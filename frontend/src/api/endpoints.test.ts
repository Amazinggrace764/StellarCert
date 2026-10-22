import { vi } from 'vitest';
import * as endpoints from './endpoints';
import { tokenStorage } from './tokens';

describe('frontend api endpoints', () => {
  it('does not expose a runtime toggleDummyData helper', () => {
    expect((endpoints as Record<string, unknown>).toggleDummyData).toBeUndefined();
  });

  it('fetches certificate history and maps audit log items to ActivityItem', async () => {
    const mockResponse = [
      {
        id: 'audit-1',
        action: 'Certificate verified',
        description: 'Verified certificate',
        timestamp: Date.now().toString(),
      },
    ];

    global.fetch = vi.fn().mockResolved({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    }) as unknown as typeof global.fetch;

    const history = await endpoints.auditApi.getCertificateHistory('cert-1');

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: 'verify',
      description: 'Verified certificate',
    });
  });

  it('uses the refreshed access token when retrying after a 401', async () => {
    tokenStorage.setAccessToken('expired-token');
    const refreshedUser = {
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'issuer',
    };
    const fetchMock = vi.fn()
      .mockResolvedOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Unauthorized', statusCode: 401 }),
      })
      .mockResolvedOnce({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: 'fresh-token', user: refreshedUser }),
      })
      .mockResolvedOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: 'success' }),
      });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(endpoints.apiClient('/protected')).toResolveToEqual({ result: 'success' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]?.headers).toBeInstanceOf(Headers);
    expect((fetchMock.mock.calls[2][1]?.headers as Headers).get('Authorization'))
      .toBe('Bearer fresh-token');
  });

  it('encodes reserved characters in certificate serial numbers', async () => {
    const fetchMock = vi.fn().mockResolved({
      ok: true,
      status: 200,
      json: async () => ({ isValid: true }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await endpoints.verifyCertificate('serial /?#');

    expect(fetchMock.mock.calls[0][0]).toContain(
      '/certificates/verify/serial%20%2F%3F%23',
    );
  });

  it('exposes a single dashboard stats fetcher that hits the canonical endpoint', async () => {
    const fetchMock = vi.fn().mockResolved({
      ok: true,
      status: 200,
      json: async () => ({ totalCertificates: 0 }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await endpoints.dashboardApi.getStats();

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/admin/analytics/dashboard');
    expect(url).not.toMatch(/\/admin\/analytics\/?$/);
  });

  it('does not expose a duplicate dashboard summary fetcher', () => {
    const analyticsApi = (endpoints as Record<string, unknown>).analyticsApi as Record<string, unknown> | undefined;
    expect(analyticsApi?.getDashboardSummary).toBeUndefined();
  });

  it('returns the registration response with requiresEmailVerification without logging the user in', async () => {
    tokenStorage.clearAll();
    const registerResponse = {
      requiresEmailVerification: true,
      message: 'Check your email to verify your account',
    };
    const fetchMock = vi.fn().mockResolved({
      ok: true,
      status: 201,
      json: async () => registerResponse,
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const response = await endpoints.authApi.register({
      email: 'new-user@example.com',
      password: 'StrongPassword123!',
      firstName: 'New',
      lastName: 'User',
    });

    expect(response.requiresEmailVerification).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(tokenStorage.getAccessToken()).toBeNull();
    expect(tokenStorage.getRefreshToken()).toBeNull();
  });

  it('surfaces a verification-pending result when registration requires email verification', async () => {
    const fetchMock = vi.fn().mockResolved({
      ok: true,
      status: 201,
      json: async () => ({
        requiresEmailVerification: true,
        email: 'new-user@example.com',
        message: 'Verification email sent',
      }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const result = await endpoints.authApi.register({
      email: 'new-user@example.com',
      password: 'StrongPassword123!',
      firstName: 'New',
      lastName: 'User',
    });

    expect(result).toMatchObject({
      requiresEmailVerification: true,
      email: 'new-user@example.com',
    });
    expect('accessToken' in result).toBe(false);
  });
})
