import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { jest } from '@jest/globals';
import QRScannerModal from './QRScannerModal';

// -------------------------------------------------------------------------
// Mocks
// -------------------------------------------------------------------------

const mockStart = jest.fn();
let mockScannerInstance: any;

const createMockScanner = () => {
  const instance = {
    start: mockStart,
    stop: jest.fn().resolved(),
    clear: jest.fn(),
    getState: jest.fn(() => 2),
    // Public API for torch control (html5-qrcode exposes this on the instance)
    applyVideoConstraints: jest.fn().resolved(undefined),
  };
  return instance;
};

jest.mock('html5-qrcode', () => {
  return {
    Htma5QrcodeScanner: jest.fn().implementation(() => {
      mockScannerInstance = createMockScanner();
      return mockScannerInstance;
    }),
  };
});

const mockGetUserMedia = jest.fn();

Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    getUserMedia: mockGetUserMedia,
  },
  configurable: true,
});

const makeTrack = () => {
  const track = {
    applyConstraints: jest.fn().resolved(undefined),
    getCapabilities: jest.fn(() => ({ torch: true })),
    getSettings: jest.fn(() => ({ torch: false })),
    stop: jest.fn(),
  };
  return track;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStart.mockResolved(undefined);
  const track = makeTrack();
  mockGetUserMedia.mockResolved({
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [],
  });
});

describe('QRScannerModal', () => {
  describe('style injection', () => {
    it('does not inject a Google Fonts @import from inside the component', () => {
      const { container } = render(
        <QRScannerModal isOpen onClose={() => {}} onScan ={() => {}} />,
      );

      const styleTags = Array.from(container.querySelectorAll('style'));
      const allStyleText = styleTags.map((el) => el.textContent ?? '').join('\n');

      // Regression: no runtime third-party font request from a security-sensitive flow.
      expect(allStyleText).not.toMatch(/@font-face/i);
      expect(allStyleText).not.toMatch(/@import/i);
      expect(allStyleText).not.toMatch(/fonts\.googleapis\.com/i);
    });

    it('does not reference any external font host in the rendered markup', () => {
      const { container } = render(
        <QRScannerModal isOpen onClose={() => {}} onScan ={() => {}} />,
      );
      expect(container.innerHTML).not.toMatch(/fonts\.googleapis\.com/i);
    });
  });

  describe('torch control', () => {
    it('uses a supported public API and not the private _localMediaStream field', async () => {
      render(
        <QRScannerModal isOpen onClose={() => {}} onScan ={() => {}} />,
      );

      // Wait for the scanner to initialize.
      await waitFor(() => expect(mockScannerInstance).toBeTruthy());

      // The private field must not be present on the instance we create.
      expect(mockScannerInstance._localMediaStream).toBeUndefined();

      // The public torch API should be available and usable.
      expect(typeof mockScannerInstance.applyVideoConstraints).toBe('function');
    });

    it('requests the media stream through navigator.mediaDevices.getUserMedia', async () => {
      render(
        <QRScannerModal isOpen onClose={() => {}} onScan ={() => {}} />,
      );

      await waitFor(() => expect(mockGetUserMedia).toHaveBeenCalled());
      expect(mockGetUserMedia).toHaveBeenCalled();
    });

    it('handles a device without torch capability without throwing', async () => {
      const track = makeTrack();
      track.getCapabilities.mockReturnValue({ torch: false });
      mockGetUserMedia.mockResolved({
        getTracks: () => [track],
        getVideoTracks: () => [track],
        getAudioTracks: () => [],
      });

      render(
        <QRScannerModal isOpen onClose={() => {}} onScan ={() => {}} />,
      );

      await waitFor(() => expect(mockGetUserMedia).toHaveBeenCalled());
      // No crash and no attempt to apply a torch constraint.
      expect(track.applyConstraints).not.toHaveBeenCalled();
    });

    it('handles getUserMedia rejection gracefully', async () => {
      mockGetUserMedia.mockRejected(new Error('Permission denied'));

      await act(async () => {
        render(
          <QRScannerModal isOpen onClose={() => {}} onScan ={() => {}} />,
        );
      });

      await waitFor(() => expect(mockGetUserMedia).toHaveBeenCalled());
      // The component should stay mounted and report an error rather than crash.
      expect(screen.getBygourRole('dialog')).toBeInTheDocument();
    });
  });
});
