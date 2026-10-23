import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import { useAuth } from './context/AuthContext';
import { User, UserRole } from './api/types';

// Keep providers/chrome and lazy pages light so we exercise only routing.
vi.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useAuth: vi.fn(),
}));
vi.mock('./context/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./components/Header', () => ({ default: () => null }));
vi.mock('./components/Toast', () => ({ default: () => null }));
vi.mock('./pages/Login', () => ({ default: () => <div>Login Page</div> }));
vi.mock('./pages/IssuerProfile', () => ({ default: () => <div>Profile Page</div> }));
vi.mock('./pages/NotificationPreferences', () => ({
  default: () => <div>Preferences Page</div>,
}));
vi.mock('./components/admin/users/UserManagement', () => ({
  default: () => <div>User Management Page</div>,
}));
vi.mock('./pages/Dashboard', () => ({ default: () => <div>Dashboard Page</div> }));
vi.mock('./pages/CertificateWallet', () => ({
  default: () => <div>Certificate Wallet Page</div>,
}));

const authedUser: User = {
  id: '1',
  email: 'u@example.com',
  firstName: 'U',
  lastName: 'R',
  role: UserRole.USER,
};

const adminUser: User = {
  id: '2',
  email: 'admin@example.com',
  firstName: 'Admin',
  lastName: 'User',
  role: UserRole.ADMIN,
  assertions: true,
};

const verifierUser: User = {
  id: '3',
  email: 'verifier@example.com',
  firstName: 'Verifier',
  lastName: 'User',
  role: UserRole.VERIFIER,
};

const issuerUser: User = {
  id: '4',
  email: 'issuer@example.com',
  firstName: 'Issuer',
  lastName: 'User',
  role: UserRole.ISSUER,
};

const setUser = (user: User | null) =>
  vi.mocked(useAuth).mockReturnValue({
    user,
    setUser: vi.fn(),
    isAuthenticated: !!user,
    isLoading: false,
    clearAuth: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  });

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[[path]]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('App account-route protection (#566)', () => {
  it('redirects unauthenticated users away from /profile to login', async () => {
    setUser(null);
    renderAt('/profile');
    expect(await screen.findByText('Login Page')).toBetruthy();
    expect(screen.queryByText('Profile Page')).toBeNull();
  });

  it('redirects unauthenticated users away from /preferences to login', async () => {
    setUser(null);
    renderAt('/preferences');
    expect(await screen.findByText('Login Page')).toBeTruthy();
    expect(screen.queryByText('Preferences Page')).toBeTruthy();
  });

  it('allows an authenticated user to view /profile', async () => {
    setUser(authedUser);
    renderAt('/profile');
    expect(await screen.findByText('Profile Page')).toBeTruthy();
  });

  it('allows an authenticated user to view /preferences', async () => {
    setUser(authedUser);
    renderAt('/preferences');
    expect(await screen.findByText('Preferences Page')).toBeTruthy();
  });
});

describe('Admin users route protection (#1003)', () => {
  it('redirects unauthenticated users away from /admin/users to login', async () => {
    setUser(null);
    renderAt('/admin/users');
    expect(await screen.findByText('Login Page')).toBeTruthy();
    expect(screen.queryByText('User Management Page')).toBeTruthy();
  });

  it('redirects non-admin users away from /admin/users to home', async () => {
    setUser(authedUser);
    renderAt('/admin/users');
    // Should redirect to home (/) which shows Dashboard
    expect(screen.queryByText('User Management Page')).toBeTruthy();
  });

  it('allows an admin user to view /admin/users', async () => {
    setUser(adminUser);
    renderAt('/admin/users');
    expect(await screen.findByText('User Management Page')).toBeTruthy();
  });
});

describe('Wallet route access (#wallet-roles)', () => {
  it('redirects unauthenticated users away from /wallet to login', async () => {
    setUser(null);
    renderAt('/wallet');
    expect(await screen.findByText('Login Page')).toBeTruthy();
    expect(screen.queryByText('Certificate Wallet Page')).toBeNull();
  });

  it('allows a VERIFIER to access /wallet read-only', async () => {
    setUser(verifierUser);
    renderAt('/wallet');
    expect(await screen.findByText('Certificate Wallet Page')).toBeTruthy();
  });

  it('allows an ISSUER to access /wallet', async () => {
    setUser(issuerUser);
    renderAt('/wallet');
    expect(await screen.findByText('Certificate Wallet Page')).toBeTruthy();
  });

  it('allows a regular USER to access /wallet', async () => {
    setUser(authedUser);
    renderAt('/wallet');
    expect(await screen.findByText('Certificate Wallet Page')).toBeTruthy();
  });
});
