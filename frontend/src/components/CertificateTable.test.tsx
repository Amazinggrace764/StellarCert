import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import CertificateTable from './CertificateTable';
import { certificateApi, auditApi } from '../api/endpoints';
import type { Certificate } from '../api';
import { createTestQueryClient, renderWithProviders } from '../test/renderWithProviders';

// Mocked at the endpoints module because the table's data now flows through the
// query layer, which imports its fetchers from there.
vi.mock('../api/endpoints', () => ({
  certificateApi: {
    list: vi.fn(),
    bulkExport: vi.fn(),
    bulkExportAll: vi.fn(),
    bulkRevoke: vi.fn(),
    freeze: vi.fn(),
    unfreeze: vi.fn(),
    transfer: { initiate: vi.fn() },
  },
  auditApi: {
    getCertificateHistory: vi.fn().mockResolvedValue([]),
  },
}));

// The table reads the signed-in user from the auth context to decide which
// issuer-owned actions to render. Tests drive that context directly so the
// role/action matrix is exercised without a full session bootstrap.
const mockedUseAuth = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockedUseAuth(),
}));

const certificate = (overrides: Partial<Certificate> = {}): Certificate =>
  ({
    id: 'cert-1',
    serialNumber: 'SC-0001',
    recipientName: 'Ada Lovelace',
    recipientEmail: 'ada@example.com',
    title: 'Advanced Analytical Engines',
    courseName: 'Computing 101',
    issuerName: 'Royal Society',
    issuerId: 'issuer-1',
    issuerEmail: 'issuer@example.com',
    issueDate: '2026-01-15T00:00:00.000Z',
    status: 'active',
    ...overrides,
  }) as Certificate;

const issuerUser = {
  id: 'issuer-1',
  email: 'issuer@example.com',
  role: 'ISSUER' as const,
  name: 'Royal Society',
};

const verifierUser = {
  id: 'verifier-1',
  email: 'verifier@example.com',
  role: 'VERIFIER' as const,
  name: 'Verifier',
};

const otherIssuerUser = {
  id: 'issuer-2',
  email: 'other-issuer@example.com',
  role: 'ISSUER' as const,
  name: 'Other Issuer',
};

const mockAuth = (user: typeof issuerUser | null = issuerUser) => {
  mockedUseAuth.mockReturn({
    user,
    isAuthenticated: Boolean(user),
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
};

const listResolvesWith = (certificates: Certificate[]) => {
  vi.mocked(certificateApi.list).mockResolved({
    data: certificates,
    total: certificates.length,
    totalPages: 1,
    page: 1,
    limit: 10,
  } as never);
};

const renderTable = async (certificates: Certificate[] = [certificate()]) => {
  listResolvesWith(certificates);
  renderWithProviders(<CertificateTable />, {
    queryClient: createTestQueryClient(),
  });
  await waitFor(expect(certificateApi.list).toHaveBeenCalled());
};

const openDetails = async (serialNumber = 'SC-0001') => {
  const button = await screen.findByRole('button', {
    name: `View certificate ${serialNumber}`,
  });
  await userEvent.click(button);
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth(issuerUser);
  vi.mocked(auditApi.getCertificateHistory).mockResolvedValue([]);
});

describe('CertificateTable "View Certificate" action', () => {
  // The button rendered enabled with no onClick, so clicking it did nothing
  // and the user had no way to tell it was not meant to work.
  it('opens the certificate details dialog', async () => {
    await renderTable();

    expect(screen.queryByRole('dialog', { name: /certificate details/i })).not.toBeInTheDocument();

    await openDetails();

    expect(screen.getByRole('dialog', { name: /certificate details/i })).toBeInTheDocument();
  });

  it('shows the certificate the row belongs to', async () => {
    await renderTable([
      certificate(),
      certificate({ id: 'cert-2', serialNumber: 'SC-0002', recipientName: 'Grace Hopper' }),
    ]);

    await openDetails('SC-0002');

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).toHaveTextContent('SC-0002');
    expect(dialog).toHaveTextContent('Grace Hopper');
    expect(dialog).not.toHaveTextContent('Ada Lovelace');
  });

  it('shows the certificate fields', async () => {
    await renderTable();
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).toHaveTextContent('Ada Lovelace');
    expect(dialog).toHaveTextContent('ada@example.com');
    expect(dialog).toHaveTextContent('Advanced Analytical Engines');
    expect(dialog).toHaveTextContent('Computing 101');
    expect(dialog).toHaveTextContent('Royal Society');
  });

  it('reads the details straight from the row, without a second request', async () => {
    await renderTable();
    const callsBefore = vi.mocked(certificateApi.list).mock.calls.length;

    await openDetails();

    expect(vi.mocked(certificateApi.list).mock.calls).toHaveLength(callsBefore);
  });

  it('says so when the certificate has no expiry', async () => {
    await renderTable();
    await openDetails();

    expect(screen.getByRole('dialog', { name: /certificate details/i })).toHaveTextContent(
      'No expiry',
    );
  });

  it('shows the expiry date when there is one', async () => {
    await renderTable([certificate({ expiryDate: '2027-01-15T00:00:00.000Z' })]);
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).toHaveTextContent(new Date('2027-01-15T00:00:00.000Z').toLocaleDateString());
  });

  it('shows the transaction hash and IPFS CID when present', async () => {
    await renderTable([certificate({ txHash: 'abc123def456', cid: 'bafyfakecid' })]);
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).toHaveTextContent('abc123def456');
    expect(dialog).toHaveTextContent('bafyfakecid');
  });

  it('omits the chain fields when the certificate has none', async () => {
    await renderTable();
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    expect(dialog).not.toHaveTextContent(/Transaction Hash/i);
    expect(dialog).not.toHaveTextContent(/IPFS CID/i);
  });

  it('explains why a frozen certificate is frozen', async () => {
    await renderTable([
      certificate({ status: 'frozen', freezeReason: 'Pending accreditation review' }),
    ]);
    await openDetails();

    expect(screen.getByRole('dialog', { name: /certificate details/i })).toHaveTextContent(
      'Pending accreditation review',
    );
  });

  it('links to the certificate file when one exists', async () => {
    await renderTable([certificate({ pdfUrl: 'https://files.example.com/cert-1.pdf' })]);
    await openDetails();

    const link = screen.getByRole('link', { name: /open certificate file/i });
    expect(link).toHaveAttribute('href', 'https://files.example.com/cert-1.pdf');
    // A cross-origin target="_blank" without this leaks window.opener.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('offers no file link when the certificate has no file', async () => {
    await renderTable();
    await openDetails();

    expect(screen.queryByRole('link', { name: /open certificate file/i })).not.toBeInTheDocument();
  });

  it('closes from the close button', async () => {
    await renderTable();
    await openDetails();

    await userEvent.click(screen.getByRole('button', { name: /close certificate details/i }));

    expect(screen.queryByRole('dialog', { name: /certificate details/i })).not.toBeInTheDocument();
  });

  it('closes from the footer button', async () => {
    await renderTable();
    await openDetails();

    const dialog = screen.getByRole('dialog', { name: /certificate details/i });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog', { name: /certificate details/i })).not.toBeInTheDocument();
  });

  it('reopens with a different certificate after closing', async () => {
    await renderTable([
      certificate(),
      certificate({ id: 'cert-2', serialNumber: 'SC-0002', recipientName: 'Grace Hopper' }),
    ]);

    await openDetails('SC-0001');
    await userEvent.click(screen.getByRole('button', { name: /close certificate details/i }));
    await openDetails('SC-0002');

    expect(screen.getByRole('dialog', { name: /certificate details/i })).toHaveTextContent(
      'Grace Hopper',
    );
  });

  it('does not trigger a revoke or freeze when viewing', async () => {
    await renderTable();
    await openDetails();

    expect(certificateApi.freeze).not.toHaveBeenCalled();
    expect(certificateApi.bulkRevoke).not.toHaveBeenCalled();
  });
});

// Root cause of the reported issue: the wallet rendered issuer-owned actions
// (download, transfer, revoke, freeze) for every role. A VERIFIER could see
// and click them even though the API rejects the call. The actions are now
// gated on the user's role and on whether they own the certificate.
describe('CertificateTable issuer-owned actions', () => {
  const expectIssuerActions = () => {
    expect(screen.getByTitle('Freeze Certificate')).toBeInTheDocument();
    expect(screen.getByTitle('Revoke Certificate')).toBeInTheDocument();
    expect(screen.getByTitle('Transfer Certificate')).toBeInTheDocument();
    expect(screen.getByTitle('Download Certificate')).toBeInTheDocument();
  };

  const expectNoIssuerActions = () => {
    expect(screen.queryByTitle('Freeze Certificate')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Revoke Certificate')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Transfer Certificate')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Download Certificate')).not.toBeInTheDocument();
  };

  it('shows issuer actions to the owning issuer', async () => {
    mockAuth(issuerUser);
    await renderTable();

    expectIssuerActions();
  });

  it('hides issuer actions from a VERIFIER', async () => {
    mockAuth(verifierUser);
    await renderTable();

    expectNoIssuerActions();
    // The row is still visible and viewable; only the mutating actions are gone.
    expect(screen.getByRole('button', { name: /View certificate SC-0001/i })).toBeInTheDocument();
  });

  it('hides issuer actions from an issuer who does not own the certificate', async () => {
    mockAuth(otherIssuerUser);
    await renderTable();

    expectNoIssuerActions();
  });

  it('hides issuer actions when no user is signed in', async () => {
    mockAuth(null);
    await renderTable();

    expectNoIssuerActions();
  });

  it('shows actions per-row based on ownership', async () => {
    mockAuth(issuerUser);
    await renderTable([
      certificate(),
      certificate({
        id: 'cert-2',
        serialNumber: 'SC-0002',
        recipientName: 'Grace Hopper',
        issuerId: 'issuer-2',
        issuerEmail: 'other-issuer@example.com',
      }),
    ]);

    // One set of actions for the owned row, none for the foreign row.
    expect(screen.getAllByTitle('Revoke Certificate')).toHaveLength(1);
    expect(screen.getAllByTitle('Freeze Certificate')).toHaveLength(1);
  });

  it('does not expose the revoke action to a VERIFIER', async () => {
    mockAuth(verifierUser);
    await renderTable();

    expect(screen.queryByTitle('Revoke Certificate')).not.toBeInTheDocument();
    expect(certificateApi.bulkRevoke).not.toHaveBeenCalled();
  });
});
