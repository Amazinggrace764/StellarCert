import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import IssueCertificate from "./IssueCertificate";

describe("IssueCertificate", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the success confirmation after a valid submission", async () => {
    render(<IssueCertificate />);

    fireEvent.change(screen.getByLabelText(/Full Name/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Stellar Wallet Address/i), {
      target: { value: "G" + "A".repeat(55) },
    });
    fireEvent.change(screen.getByLabelText(/Certificate Title/i), {
      target: { value: "Certified Blockchain Developer" },
    });
    fireEvent.change(screen.getByLabelText(/Issuer \/ Organization/i), {
      target: { value: "Acme Academy" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Issue Certificate/i }));

    // The component simulates the network round-trip (~1.5s) before confirming
    await waitFor(
      () => {
        expect(alertSpy).toHaveBeenCalledWith(
          "Certificate issued successfully on the Stellar network!",
        );
      },
      { timeout: 4000 },
    );
  });

  it("shows validation errors instead of submitting when required fields are empty", async () => {
    render(<IssueCertificate />);

    fireEvent.click(screen.getByRole("button", { name: /Issue Certificate/i }));

    expect(
      await screen.findByText("Recipient name is required"),
    ).toBeInDocument();
    expect(
      screen.getByText("Stellar wallet address is required"),
    ).toBeInDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("rejects an issue date that is in the future in UTC", async () => {
    render(<IssueCertificate />);

    const futureUtc = new Date(Date.now() + 1000 * 60 * 60 * 24)
      .toISOString()
      .slice(0, 10);

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Issue Date/i), {
      target: { value: futureUtC },
    });

    fireEvent.click(screen.getByRole("button", { name: /Issue Certificate/i }));

    expect(
      await screen.findByText(/Issue date cannot be in the future \(UTC\)/i),
    ).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("rejects a date that is future in UTC even when it is today in a negative UTC offset timezone", async () => {
    // Pin clock to 2024-01-16T01:00:00Z (01:00 UTC). In UTC-5 this is
    // 2024-01-15 20:00 local, so a date of 2024-01-16 would have passed
    // the old local-timezone check but must fail UTC-based validation.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-16T01:00:00Z"));

    try {
      render(<IssueCertificate />);

      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/Issue Date/i), {
        target: { value: "2024-01-16" },
      });

      fireEvent.click(screen.getByRole("button", { name: /Issue Certificate/i }));

      // 2024-01-16 is today in UTC, so it must be accepted.
      await waitFor(
        () => {
          expect(alertSpy).toHaveBeenCalled();
        },
        { timeout: 4000 },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a date that is future in UTC (tomorrow) when today is still the previous day locally", async () => {
    // Pin clock to 2024-01-16T01:00:00Z (01:00 UTC). In UTC-5 this is
    // 2024-01-15 20:00 local. Tomorrow in UTC is 2024-01-17.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-16T01:00:00Z"));

    try {
      render(<IssueCertificate />);

      fillRequiredFields();
      fireEvent.change(screen.getByLabelText(/Issue Date/i), {
        target: { value: "2024-01-17" },
      });

      fireEvent.click(screen.getByRole("button", { name: /Issue Certificate/i }));

      expect(
        await screen.findByText(/Issue date cannot be in the future \(UTC\)/i),
      ).toBeInTheDocument();
      expect(alertSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  function fillRequiredFields() {
    fireEvent.change(screen.getByLabelText(/Full Name/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Stellar Wallet Address/i), {
      target: { value: "G" + "A".repeat(55) },
    });
    fireEvent.change(screen.getByLabelText(/Certificate Title/i), {
      target: { value: "Certified Blockchain Developer" },
    });
    fireEvent.change(screen.getByLabelText(/Issuer \/ Organization/i), {
      target: { value: "Acme Academy" },
    });
  }
});
