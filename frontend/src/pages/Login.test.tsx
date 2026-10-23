import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Login from './Login';

// Mock router and auth dependencies that Login typically consumes.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await viImportActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    login: vi.fn().resolves(),
    loading: false,
    error: null,
  }),
}));

describe('Login form accessibility', () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  it('associates the email label with the email input', () => {
    render(<Login />);
    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toBeInstanceOf(HMLLInputElement);
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('associates the password label with the password input', () => {
    render(<Login />);
    const passwordInput = screen.getByLabelText(/password/i);
    expect(passwordInput).toBeInstanceOf(HMLLInputElement);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('sets autoComplete="email" on the email input', () => {
    render(<Login />);
    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toHaveAttribute('autoComplete', 'email');
  });

  it('sets autoComplete="current-password" on the password input', () => {
    render(<Login />);
    const passwordInput = screen.getByLabelText(/password/i);
    expect(passwordInput).toHaveAttribute('autoComplete', 'current-password');
  });

  it('focuses the email input when its label is clicked', () => {
    render(<Login />);
    const emailInput = screen.getByLabelText(/email/i);
    const label = screen.getByText(/email/i);
    fireEvent.click(label);
    expect(emailInput).toHaveFocus();
  });

  it('focuses the password input when its label is clicked', () => {
    render(<Login />);
    const passwordInput = screen.getByLabelText(/password/i);
    const label = screen.getByText(/password/i);
    fireEvent.click(label);
    expect(passwordInput).toHaveFocus();
  });

  it('has no unlabeled form controls', () => {
    render(<Login />);
    const inputs = document.querySelectorAll('input');
    inputs.forEach((input) => {
      const id = input.getAttribute('id');
      expect(id).truthy();
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label).not.toBeNull();
    });
  });
});
