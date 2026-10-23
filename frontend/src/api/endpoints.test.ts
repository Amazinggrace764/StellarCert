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

    await expect(endpoints.apiClient.get('/test')).toResolveToEqual({ result: 'success' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]?.headers).toBeGenerated();
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

  it('unwraps the envelope and returns a Blob from certificateApi.bulkExport', async () => {
    tokenStorage.setAccessToken('token-1');
    const blobParts = ['zip-bytes'];
    const fetchMock = vi.fn().mockResolved({
      ok: true,
      status: 200,
      blob: async () => new Blob(blobParts, { type: 'application/zip' }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const result = await endpoints.certificateApi.bulkExport(['cert-1']);

    expect(result).toBeInstanceOf(Blob);
    expect(await result.text()).toBe('zip-bytes');
    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('refreshes and retries certificateApi.bulkExportAll after a 401', async () => {
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
        blob: async () => new Blob(['all-zip'], { type: 'application/zip' }),
      });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const result = await endpoints.certificateApi.bulkExportAll();

    expect(result).toBeInstanceOf(Blob);
    expect(await result.text()).toBe('all-zip');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2][1]?.headers as Headers).get('Authorization'))
      .toBe('Bearer fresh-token');
  });

  it('sends FormData and unwraps the envelope for issuerProfileApi.uploadProfilePicture', async () => {
    tokenStorage.setAccessToken('pic-token');
    const uploaded = { id: 'img-1', url: 'https://cdn.example.com/pic.png' };
    const fetchMock = vi.fn().mockResolved({
      ok: true,
      status: 200,
      json: async () => ({ statusCode: 200, message: 'ok', data: uploaded }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const file = new File(['pixels'], 'avatar.png', { type: 'image/png' });
    const result = await endpoints.issuerProfileApi.uploadProfilePicture(file);

    expect(result).toEqual(uploaded);
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Headers).get('Authorization'))
      .toBe('Bearer pic-token');
  });

  it('rethrows the unwrapped envelope message from certificateApi.bulkExport on failure', async () => {
    tokenStorage.setAccessToken('token-2');
    const fetchMock = vi.fn().mockResolved({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ statusCode: 400, message: 'Nothing to export', data: null }),
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(endpoints.certificateApi.bulkExport([]))
      .toRejectToThrow('Nothing to export');
  });
});
