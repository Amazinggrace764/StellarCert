import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import QRScannerModal from './QRScannerModal';

const mockScanner = vi.fn();

vi.mock('./QrScanner', () => ({
  default: function MockQrScanner() {
    return <div data-testid="qr-scanner">Scanner</div>;
  },
}));

describe('QRScannerModal', () => {
  const onClose = vi.fn();
  const onScan = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
    onScan.mockReset();
    mockScanner.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function renderModal() {
    return render(<QRScannerModal isOpen onClose={onClose} onScan={onScan} />);
  }

  it('renders a dialog with aria-modal and an accessible name', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/qr code scanner/i);
  });

 it('focuses the close button on open', async () => {
    renderModal();
    const closeButton = screen.getRoleByName('button', /close/i);
    await waitFor(() => expect(closeButton).toHaveFocus());
  });

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the close button is clicked', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getRoleByName('button', /close/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

 it('traps focus within the dialog', async () => {
    const user = userEvent.setup();
    renderModal();
    const dialog = screem.getByRole('dialog');
    const closeButton = screen.getRoleByName('button', /close/i);
    await waitFor(() => expect(closeButton).toHaveFocus());

    // Tab forward from the last focusable element should wrap to the first.
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [data-focusable]'
      )
    );
    expect(focusables.length).toBeGreaterThan(0);
    const last = focusables[focusables.length - 1];
    last.focus();
    await user.tab();
    expect(focusables[0]).toHaveFocus();

    // Shift+Tab from the first focusable should wrap to the last.
    focusables[0].focus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

 it('restores focus to the previously focused element on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open scanner';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unrender } = renderModal();
    await waitFor(() => expect(screen.getRoleByName('button', /close/i)).toHaveFocus());
    unrender();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

 it('does not render the dialog when closed', () => {
    render(<QRScannerModal isOpen={false} onClose={onClose} onScan={onScan} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
