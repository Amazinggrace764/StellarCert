import React from "react";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestQueryClient, renderWithProviders } from "../../test/renderWithProviders";

// ── API mock ───────────────────────────────────────────────────────────────
// Mocked at the endpoints module: verification now runs through the query layer,
// which imports its fetcher from there.
const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));

vi.mock("../../api/endpoints", () => ({
  certificateApi: {
    verify: verifyMock,
  },
}));

// ── html5-qrcode mock (camera scanner is irrelevant to these tests) ────────
vi.mock("html5-qrcode", () => ({
  Html5QrcodeScanner: vi.fn(),
}));


vi.mock("../../components/QRScannerModal", () => ({
  default: ({ isOpen, onClose, onScanSuccess }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="mock-qr-scanner-modal">
        <button onClick={onClose} aria-label="Mock Close Scanner">Close</button>
        <button
          onClick={() => onScanSuccess?.({
            raw: "SCANNED-SERIAL-999",
            certificateId: "SCANNED-SERIAL-999",
            url: "https://stellarcert.org/verify/SCANNED-SERIAL-999"
          })}
          aria-label="Mock Trigger Scan"
        >
          Scan Code
        </button>
      </div>
    );
  },
}));

import VerifyCertificate from "../VerifyCertificate";

const VALID_RESULT = {
  isValid: true,
  status: "valid",
  message: "Certificate is valid",
  certificate: {
    id: "cert-1",
    recipientName: "Jordan Lewis",
    courseName: "Blockchain Fundamentals",
    issuerName: "Stellar Academy",
    issueDate: "2026-01-15",
    status: "active",
  },
};

/** jsdom ships without the async Clipboard API — install a per-test stand-in. */
function mockClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

/** jsdom does not implement the legacy document.execCommand — stub it per test. */
function mockExecCommand(result: boolean) {
  const fn = vi.fn().mockReturnValue(result);
  Object.defineProperty(document, "execCommand", {
    value: fn,
    configurable: true,
  });
  return fn;
}

describe("VerifyCertificate share actions (toast, not alert)", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let execCommandMock: ReturnType<typeof mockExecCommand>;

  beforeEach(() => {
    verifyMock.mockResolvedValue(VALID_RESULT);
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    // Legacy fallback fails by default; individual tests override it
    execCommandMock = mockExecCommand(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderPage() {
    return renderWithProviders(<VerifyCertificate />, {
      queryClient: createTestQueryClient(),
      routerEntries: ["/verify?serial=CERT-123"],
    });
  }

  async function openSharePanel() {
    renderPage();
    return screen.findByRole("button", { name: /Copy Link/i });
  }

  it("shows the success toast (no alert) when Copy Link succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);

    const copyButton = await openSharePanel();
    fireEvent.click(copyButton);

    // The existing toast — previously unreachable dead code — is now shown
    await waitFor(() =>
      expect(
        screen.getByRole("status").textContent,
      ).toContain("Link copied to clipboard!"),
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain(
      "/verify?serial=CERT-123",
    );
    // The blocking window.alert fallback must be gone
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows an error toast when the clipboard API fails and the legacy fallback fails too", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("Clipboard denied")));

    const copyButton = await openSharePanel();
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(
        screen.getByRole("status").textContent,
      ).toContain("Copy failed. Please copy the link manually."),
    );

    expect(alertSpy).not.toHaveBeenCalled();
    expect(execCommandMock).toHaveBeenCalledWith("copy");
  });

  it("shows the success toast when the legacy copy fallback succeeds", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("HTTP context")));
    execCommandMock = mockExecCommand(true);

    const copyButton = await openSharePanel();
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(
        screen.getByRole("status").textContent,
      ).toContain("Link copied to clipboard!"),
    );

    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("copies via the clipboard (toast) when Share is used without Web Share support", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    // jsdom has no navigator.share — the else branch must be exercised
    expect(navigator.share).toBeUndefined();

    renderPage();
    const shareButton = await screen.findByRole("button", { name: /Share/i });
    fireEvent.click(shareButton);

    await waitFor(() =>
      expect(
        screen.getByRole("status").textContent,
      ).toContain("Link copied to clipboard!"),
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Certificate Verified: Jordan Lewis");
    expect(copied).toContain("/verify?serial=CERT-123");
    expect(alertSpy).not.toHaveBeenCalled();
  });
});


describe("VerifyCertificate QR scanner integration (#102)", () => {
  beforeEach(() => {
    verifyMock.mockResolvedValue(VALID_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the lazy QRScannerModal when Scan QR Code is clicked", async () => {
    renderWithProviders(<VerifyCertificate />, {
      queryClient: createTestQueryClient(),
      routerEntries: ["/verify"],
    });

    expect(screen.queryByTestId("mock-qr-scanner-modal")).not.toBeInTheDocument();

    const scanButton = screen.getByRole("button", { name: /Scan QR Code/i });
    fireEvent.click(scanButton);

    await waitFor(() => {
      expect(screen.getByTestId("mock-qr-scanner-modal")).toBeInTheDocument();
    });
  });

  it("updates serial and closes modal onScanSuccess", async () => {
    renderWithProviders(<VerifyCertificate />, {
      queryClient: createTestQueryClient(),
      routerEntries: ["/verify"],
    });

    const scanButton = screen.getByRole("button", { name: /Scan QR Code/i });
    fireEvent.click(scanButton);

    const triggerScan = await screen.findByRole("button", { name: "Mock Trigger Scan" });
    fireEvent.click(triggerScan);

    await waitFor(() => {
      expect(screen.queryByTestId("mock-qr-scanner-modal")).not.toBeInTheDocument();
    });

    const input = screen.getByLabelText(/Certificate Serial Number/i) as HTMLInputElement;
    expect(input.value).toBe("SCANNED-SERIAL-999");
  });

  it("closes modal when onClose is called", async () => {
    renderWithProviders(<VerifyCertificate />, {
      queryClient: createTestQueryClient(),
      routerEntries: ["/verify"],
    });

    const scanButton = screen.getByRole("button", { name: /Scan QR Code/i });
    fireEvent.click(scanButton);

    const closeButton = await screen.findByRole("button", { name: "Mock Close Scanner" });
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByTestId("mock-qr-scanner-modal")).not.toBeInTheDocument();
    });
  });
});
