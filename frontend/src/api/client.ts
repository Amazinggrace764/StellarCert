import { API_BASE_URL, API_TIMEOUT } from './config';

/**
 * Transport core for the client API.
 *
 * This module owns the fetch wrapper, the retry/backoff policy, the
 * token-refresh de-duplication logic, and the dummy-data switch. It does
 * NOT know about any resource group (auth, certificates, issuers, etc.).
 * Those live in `src/api/resources/*` and are re-exported from `src/api/index.ts`.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions extends Omit<RequestInit, 'method' | 'body' | 'headers'> {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip attaching the authorization header (e.g. login, refresh). */
  skipAuth?: boolean;
  /** Skip the token-refresh retry on 401 (e.g. the refresh call itself). */
  skipRefresh?: boolean;
  /** Override the default retry count for transient failures. */
  retries?: number;
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_KEY = 'stellarcert.accessToken';
const REFRESH_TOKEN_KEY = 'stellarcert.refreshToken';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return safeStorage()?.getItem(ACCESS_TOKEN_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return safeStorage()?.getItem(REFRESH_TOKEN_KEY) ?? null;
}

export function setTokens(tokens: TokenPair): void {
  const storage = safeStorage();
  if (!storage) {
    return;
  }
  storage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  storage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  const storage = safeStorage();
  if (!storage) {
    return;
  }
  storage.removeItem(ACCESS_TOKEN_KEY);
  storage.removeItem(REFRESH_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// Dummy-data switch
// ---------------------------------------------------------------------------

export interface DummyDataProvider {
  handle<T>(request: { method: HttpMethod; path: string; body?: unknown }): Promise<T> | T;
  isEnabled(): boolean;
}

let dummyProvider: DummyDataProvider | null = null;

/**
 * Register a dummy-data provider. Resource modules can install one at
 * bootstrap time when ``dummy mode`` (or a similar flag) is enabled. When no
 * provider is registered, or the provider reports itself as disabled,
 * requests go to the real network.
 */
export function setDummyDataProvider(provider: DummyDataProvider | null): void {
  dummyProvider = provider;
}

export function isDummyModeEnabled(): boolean {
  return Boolean(dummyProvider && dummyProvider.isEnabled());
}

// ---------------------------------------------------------------------------
// Retry / backoff policy
// ---------------------------------------------------------------------------

const DEFAULT_RETRIES = 3;
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 5_000;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Request aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Request aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort);
  });
}

function backoffDelay(attempt: number): number {
  // full jitter exponential backoff, capped at MAX_BACKOFF_MS
  const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.random() * exponential;
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Token refresh de-duplication
// ---------------------------------------------------------------------------

/** Shared in-flight refresh promise so concurrent 401s only trigger one network call. */
let refreshInFlight: Promise<TokenPair> | null = null;

export type RefreshHandler = (refreshToken: string) => Promise<TokenPair>;

let refreshHandler: RefreshHandler | null = null;

/**
 * Register the function used to exchange a refresh token for a new pair.
 * The auth resource module registers this at import time so the client
 * core never imports the auth resource directly (avoiding a cycle).
 */
export function setRefreshHandler(handler: RefreshHandler | null): void {
  refreshHandler = handler;
}

export function getRefreshInFlight(): Promise<TokenPair> | null {
  return refreshInFlight;
}

async function refreshTokensOnce(): Promise<TokenPair> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const refreshToken = getRefreshToken();
  if (!refreshToken || !refreshHandler) {
    throw new ApiError('No refresh token available', 401, 'NO_REFRESH_TOKEN');
  }

  refreshInFlight = (async () => {
    try {
      const next = await refreshHandler!(refreshToken);
      setTokens(next);
      return next;
    } catch (err) {
      clearTokens();
      throw err;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const base = API_BASE_URL.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function buildHeaders(options: RequestOptions, token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (!options.skipAuth && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  let message = response.statusText || `Request failed with status ${response.status}`;
  let code: string | undefined;
  let details: unknown;
  try {
    const body = await response.clone().json();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (typeof b.message === 'string') message = b.message;
      else if (Array.isArray(b.message)) {
        message = (b.message as unknown[]).map(String).join(', ');
      }
      if (typeof b.code === 'string') code = b.code;
      details = b.details ?? b;
    }
  } catch {
    // body was not JSON: fall back to statusText
  }
  return new ApiError(message, response.status, code, details);
}

async function dispatch<T>(
  path: string,
  options: RequestOptions,
  attempt: number,
  allowRefresh: boolean,
): Promise<T> {
  const method: HttpMethod = options.method ?? 'GET';
  const token = options.skipAuth ? null : getAccessToken();
  const headers = buildHeaders(options, token);

  const init: RequestInit = {
    method,
    headers,
    signal: options.signal,
    credentials: options.credentials,
    mode: options.mode,
    cache: options.cache,
    redirect: options.redirect,
    referrer: options.referrer,
    keepalive: options.keepalive,
    integrity: options.integrity,
  };

  if (options.body !== undefined) {
    init.body =
      typeof options.body === 'string' || options.body instanceof Blob
        ? (options.body as BodyInit)
        : JSON.stringify(options.body);
  }

  const timeoutMs = API_TIMEOUT ?? 30_000;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = options.signal
    ? AnySignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  init.signal = signal;

  let response: Response;
  try {
    response = await fetch(buildUrl(path), init);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (options.signal?.aborted) {
        throw err;
      }
      throw new ApiError('Request timed out', 408, 'TIMEOUT');
    }
    // Network failure: retry transient errors up to the configured count.
    const maxRetries = options.retries ?? DEFAULT_RETRIES;
    if (attempt < maxRetries) {
      await sleep(backoffDelay(attempt), options.signal);
      return dispatch<T>(path, options, attempt + 1, allowRefresh);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // 401 handling: attempt a single de-duplicated refresh, then replay.
  if (response.status === 401 && allowRefresh && !options.skipRefresh && !options.skipAuth) {
    try {
      await refreshTokensOnce();
    } catch {
      throw await toApiError(response);
    }
    return dispatch<T>(path, options, attempt, false);
  }

  if (!response.ok) {
    const error = await toApiError(response);
    const maxRetries = options.retries ?? DEFAULT_RETRIES;
    if (isRetryableStatus(response.status) && attempt < maxRetries) {
      await sleep(backoffDelay(attempt), options.signal);
      return dispatch<T>(path, options, attempt + 1, allowRefresh);
    }
    throw error;
  }

  return parseResponse<T>(response);
}

/**
 * Main entry point for all resource modules. Handles the dummy-data
 * switch, retry/backoff, timeouts, and token refresh de-duplication.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method: HttpMethod = options.method ?? 'GET';

  if (dummyProvider && dummyProvider.isEnabled()) {
    return dummyProvider.handle<T>({ path, method, body: options.body });
  }

  return dispatch<T>(path, options, 0, true);
}

export const api = {
  get: <T>(suffix: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(suffix, { ...options, method: 'GET' }),

  post: <T>(suffix: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(suffix, { ...options, method: 'POST', body }),

  put: <T>(suffix: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(suffix, { ...options, method: 'PUT', body }),

  patch: <T>(suffix: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(suffix, { ...options, method: 'PATCH', body }),

  delete: <T>(suffix: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(suffix, { ...options, method: 'DELETE' }),
};
