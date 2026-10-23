import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProtectedRoute from './ProtectedRoute';
import { useAuth } from '../context/AuthContext';

vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));

// All tests run as an UNAUTHENTICATED visitor, so anything that is not an exact
// public path must be redirected to login.
const setUnauthenticated = () =>
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    setUser: vi.fn(),
    isAuthenticated: false,
    isLoading: false,
    clearAuth: vi.fn(),
    login: vi.fn(),
  });

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/verify" element={<div>verify public</div>} />
          <Route path="/verify-email" element={<div>verify email</div>} />
          <Route path="/verify-payment" element={<div>verify payment</div>} />
        </Route>
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  setUnauthenticated();
});

describe('ProtectedRoute public-path matching (#564)', () => {
  it('treats the exact /verify path as public', () => {
    renderAt('/verify');
    expect(screen.getByText('verify public')).toBeTruthy();
    expect(screen.queryByText('login')).toBeNull();
  });

  it('does NOT treat /verify-email as public (prefix collision)', () => {
    renderAt('/verify-email');
    expect(screen.getByText('login')).toBeTruthy();
    expect(screen.queryByText('verify email')).toBeNull();
  });

  it('does NOT treat /verify-payment as public (prefix collision)', () => {
    renderAt('/verify-payment');
    expect(screen.getByText('login')).toBeTruthy();
    expect(screen.queryByText('verify payment')).toBeNull();
  });
});
