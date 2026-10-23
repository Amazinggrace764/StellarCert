import QRCodeModal from "@/components/QRCodeModal";
import QRScannerModal from "@/components/QRScannerModal";
import { useState } from "react";

// Example usage / demo page
export default function CertificateDemoPage() {
  const [qrOpen, setQrOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);

  // Example certificate data — replace with your real data
  const certificate = {
    id: "cert_a1b2c3d4e5f6",
    name: "Advanced React Development",
  };

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center gap-6 p-8"
      style={{
        fontFamily: "'DM Mono', monospace",
        background: "#0a0a0f",
      }}
    >
      <div className="text-center mb-4">
        <h1 className="text-white text-2xl font-semibold mb-2">Certificate QR Demo</h1>
        <p className="text-sm" style={{ color: "#6b6b85" }}>
          Click a button to open a modal
        </p>
      </div>

      <div className="flex gap-3">
        {/* Generate QR */}
        <button
          onClick={() => setQrOpen(true)}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all"
          style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.9), rgba(79,70,229,0.9))",
            border: "1px solid rgba(139,92,246,0.4)",
            color: "#fff",
            boxShadow: "0 4px 20px rgba(139,92,246,0.3)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <path d="M14 14h3v3h-3zM17 17h3M17 14v3" />
          </svg>
          Show QR Code
        </button>

        {/* Scanner */}
        <button
          onClick={() => setScannerOpen(true)}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#c4c4d4",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Scan QR
        </button>
      </div>

      {lastScan && (
        <div
          className="mt-4 px-4 py-3 rounded-xl text-xs max-w-sm text-center"
          style={{
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.2)",
            color: "#6ee7b7",
          }}
        >
          Last scan: <span className="text-green-300 break-all">{lastScan}</span>
        </div>
      )}

      {/* QR Code Generator Modal */}
      <QRCodeModal
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        certificateId={certificate.id}
        certificateName={certificate.name}
      // baseUrl is optional — defaults to window.location.origin + /verify/{id}
      />

      {/* QR Scanner Modal */}
      <QRScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={(result) => {
          setLastScan(result.url);
          setScannerOpen(false);
          // Navigate to verification page or handle however you need:
          // router.push(`/verify/${result.certificateId}`);
        }}
        verifyPathPrefix="/verify/"
      />
    </main>
  );
}