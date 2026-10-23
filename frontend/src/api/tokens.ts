import type { User } from './types';

/**
 * Callback invoked after `apiClient` silently refreshes the access token, so
 * AuthContext can keep its reactive `isAuthenticated` / `user` state in sync.
 * The fresh `user` from the refresh response is forwarded when available.
 */
type TokenRefreshCallback = (accessToken: string, user?: User | null) => void;

const _registeredCallbacks = new Set<TokenRefreshCallback>();

/**
 * Register a callback that runs whenever the access token is rotated by `apiClient`.
 * Multiple consumers (AuthContext, NotificationContext) can subscribe; the
 * previous single-callback API is preserved for compatibility. Returns an
 * unsubscribe function.
 */
export const setTokenRefreshCallback = (cb: TokenRefreshCallback): (() => void) => {
  _registeredCallbacks.add(cb);
  return () => {
    _registeredCallbacks.delete(cb);
  };
};

export const notifyTokenRefreshed = (accessToken: string, user?: User | null) => {
  for (const cb of Array.from(_registeredCallbacks)) {
    try {
      cb(accessToken, user);
    } catch (err) {
      // A faulty consumer must not block others or the refresh flow.
      console.error('Token refresh callback failed:', err);
    }
  }
};

let _inMemoryAccessToken: string | null = null;

export const tokenStorage = {
  getAccessToken: (): string | null => _inMemoryAccessToken,
  setAccessToken: (token: string): void => {
    _inMemoryAccessToken = token;
  },
  clearTokens: (): void => {
    _inMemoryAccessToken = null;
  },
  hasAccessToken: (): boolean => !!_inMemoryAccessToken,
};
