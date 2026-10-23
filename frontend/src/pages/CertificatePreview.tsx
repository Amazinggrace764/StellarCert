import { useState, useRef, useCallback } from "react";
import { Download, Mail, CheckCircle, Share2, Award } from "lucide-react";

// ─── Types / data ─────────────────────────────────────────────────────────────

const certificateData = {
  title: "Certificate of Excellence",
  recipient: "Jordan Lewis",
  issuer: "StellarCert Institute",
  issueDate: "February 23, 2026",
  credentialId: "STC-2026-00023",
  description:
    "For outstanding performance in the Blockchain Fundamentals program.",
  program: "Blockchain Fundamentals",
};

// ─── Tiny toast ───────────────────────────────────────────────────────────────

function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: "2rem",
        left: "50%",
        transform: `translateX(-50%) translateY(${visible ? "0" : "1.5rem"})`,
        opacity: visible ? 1 : 0,
        transition: "all 0.35s cubic-bezier(0.34,1.56,0.64,1)",
        background: "#0f172a",
        color: "#e2e8f0",
        padding: "0.6rem 1.2rem",
        borderRadius: "999px",
        fontSize: "0.8rem",
        fontFamily: "'DM Mono', monospace",
        letterSpacing: "0.05em",
        pointerEvents: "none",
        zIndex: 9999,
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      {message}
    </div>
  );
}

// ─── Decorative SVG seal ──────────────────────────────────────────────────────

function Seal() {
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" fill="none">
      <circle cx="44" cy="44" r="40" stroke="#b8860b" strokeWidth="1.5" strokeDasharray="4 3" />
      <circle cx="44" cy="44" r="33" stroke="#b8860b" strokeWidth="0.8" opacity="0.5" />
      <circle cx="44" cy="44" r="26" fill="#b8860b" opacity="0.08" />
      <path
        d="M44 18 L46.9 35.5 L62 28.5 L52.5 43 L70 44 L52.5 45 L62 59.5 L46.9 52.5 L44 70 L41.1 52.5 L26 59.5 L35.5 45 L18 44 L35.5 43 L26 28.5 L41.1 35.5 Z"
        fill="#b8860b"
        opacity="0.25"
      />
      <text x="44" y="47" textAnchor="middle" fontFamily="serif" fontSize="9" fill="#b8860b" letterSpacing="1">
        VERIFIED
      </text>
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CertificatePreview() {
  const [toast, setToast] = useState({ visible: false, message: "" });
  const [shareLoading, setShareLoading] = useState(false);
  const certRef = useRef(null);

  const showToast = useCallback((message: string) => {
    setToast({ visible: true, message });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2800);
  }, []);

  const handleDownload = useCallback(async () => {
    showToast("Preparing PDF download…");
    // Wire up html2canvas / jsPDF here in production
    await new Promise((r) => setTimeout(r, 800));
    showToast("PDF downloaded ✓");
  }, [showToast]);

  const handleShare = useCallback(async () => {
    setShareLoading(true);
    try {
      if (navigator.share) {
        await navigator.share({
          title: certificateData.title,
          text: `${certificateData.recipient} earned the ${certificateData.program} certificate from ${certificateData.issuer}`,
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        showToast("Link copied to clipboard ✓");
      }
    } catch {
      showToast("Share cancelled");
    } finally {
      setShareLoading(false);
    }
  }, [showToast]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(certificateData.credentialId);
    showToast(`Credential ID copied ✓`);
  }, [showToast]);

  return (
    <>
      {/* ── Font imports ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600&family=DM+Mono:wght@300;400;500&display=swap');

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        @keyframes rotateSlow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .cert-root { animation: fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) both; }
        .cert-card { animation: fadeUp 0.7s 0.1s cubic-bezier(0.22,1,0.36,1) both; }
        .cert-actions { animation: fadeUp 0.6s 0.25s cubic-bezier(0.22,1,0.36,1) both; }

        .shimmer-name {
          background: linear-gradient(90deg, #78350f 0%, #b8860b 40%, #d4a843 55%, #b8860b 70%, #78350f 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 4s linear infinite;
        }

        .cert-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.65rem 1.4rem;
          border: none;
          border-radius: 6px;
          font-family: 'DM Mono', monospace;
          font-size: 0.75rem;
          font-weight: 500;
          letter-spacing: 0.06em;
          cursor: pointer;
          transition: all 0.22s ease;
          position: relative;
          overflow: hidden;
        }
        .cert-btn::after {
          content: '';
          position: absolute;
          inset: 0;
          background: rgba(255,255,255,0.08);
          opacity: 0;
          transition: opacity 0.18s;
        }
        .cert-btn:hover::after { opacity: 1; }
        .cert-btn:active { transform: scale(0.97); }

        .btn-download { background: #1e293b; color: #e2e8f0; box-shadow: 0 2px 12px rgba(0,0,0,0.25); }
        .btn-share    { background: #b8860b; color: #fff8e7; box-shadow: 0 2px 12px rgba(184,134,11,0.35); }

        .credential-chip {
          font-family: 'DM Mono', monospace;
          font-size: 0.68rem;
          letter-spacing: 0.12em;
          cursor: pointer;
          transition: color 0.18s;
        }
        .credential-chip:hover { color: #b8860b; }

        .divider-rule {
          border: none;
          height: 1px;
          background: linear-gradient(90deg, transparent, #b8860b44, transparent);
          margin: 0;
        }

        @media print {
          .cert-actions, .cert-root > *:not(.cert-card) { display: none !important; }
          .cert-card { box-shadow: none !important; border: 1px solid #e2e8f0 !important; }
        }
      `}</style>

      <section
        className="cert-root"
        style={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "0 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "2rem",
        }}
      >
        {/* ── Certificate card ── */}
        <div
          ref={certRef}
          className="cert-card"
          style={{
            background: "#fffdf7",
            borderRadius: 20,
            border: "1.5px solid #e8d5a3",
            boxShadow:
              "0 4px 6px rgba(184,134,11,0.04), 0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
            padding: "3rem 3.5rem",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Background texture */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "radial-gradient(circle at 15% 85%, rgba(184,134,11,0.06) 0%, transparent 50%), radial-gradient(circle at 85% 15%, rgba(184,134,11,0.06) 0%, transparent 50%)",
              pointerEvents: "none",
            }}
          />

          {/* Corner ornaments */}
          {[
            { top: 16, left: 16, rotate: 0 },
            { top: 16, right: 16, rotate: 90 },
            { bottom: 16, right: 16, rotate: 180 },
            { bottom: 16, left: 16, rotate: 270 },
          ].map(({ rotate, ...pos }, i) => (
            <svg
              key={i}
              width="28" height="28" viewBox="0 0 28 28"
              style={{ position: "absolute", opacity: 0.35, transform: `rotate(${rotate}deg)`, ...pos }}
            >
              <path d="M2 26 L2 2 L26 2" stroke="#b8860b" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <circle cx="2" cy="2" r="2" fill="#b8860b" opacity="0.6" />
            </svg>
          ))}

          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <Award size={14} color="#b8860b" />
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.65rem", letterSpacing: "0.2em", color: "#92400e", textTransform: "uppercase" }}>
                {certificateData.issuer}
              </span>
            </div>
            <div
              className="credential-chip"
              title="Click to copy"
              onClick={handleCopyId}
              style={{ color: "#a8936a", display: "flex", alignItems: "center", gap: "0.3rem" }}
            >
              <span>ID</span>
              <span style={{ color: "#78350f" }}>{certificateData.credentialId}</span>
            </div>
          </div>

          {/* Divider */}
          <hr className="divider-rule" style={{ margin: "1.5rem 0" }} />

          {/* Title */}
          <p style={{
            textAlign: "center",
            fontFamily: "'DM Mono', monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#b8860b",
            margin: "0 0 0.75rem",
          }}>
            Certificate of
          </p>
          <h2 style={{
            textAlign: "center",
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "clamp(1.8rem, 5vw, 2.6rem)",
            fontWeight: 700,
            color: "#1c1208",
            margin: 0,
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
          }}>
            Excellence
          </h2>

          {/* Body */}
          <p style={{
            textAlign: "center",
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "1rem",
            color: "#6b5a3a",
            marginTop: "2rem",
            fontStyle: "italic",
          }}>
            This certifies that
          </p>

          {/* Recipient name */}
          <h3
            className="shimmer-name"
            style={{
              textAlign: "center",
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "clamp(1.6rem, 5vw, 2.2rem)",
              fontWeight: 600,
              margin: "0.4rem 0 0",
              letterSpacing: "0.02em",
            }}
          >
            {certificateData.recipient}
          </h3>

          {/* Description */}
          <p style={{
            textAlign: "center",
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "1rem",
            color: "#7c6545",
            margin: "1.2rem auto 0",
            maxWidth: 380,
            lineHeight: 1.65,
          }}>
            {certificateData.description}
          </p>

          {/* Divider */}
          <hr className="divider-rule" style={{ margin: "2rem 0 1.75rem" }} />

          {/* Footer row: seal + date + verified badge */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.62rem", color: "#a8936a", letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 0.2rem" }}>
                Issued on
              </p>
              <p style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "0.95rem", color: "#4a3728", margin: 0, fontWeight: 600 }}>
                {certificateData.issueDate}
              </p>
            </div>

            <Seal />

            <div style={{ textAlign: "right" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", background: "rgba(184,134,11,0.1)", border: "1px solid rgba(184,134,11,0.3)", borderRadius: 999, padding: "0.3rem 0.75rem" }}>
                <CheckCircle size={11} color="#b8860b" />
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.6rem", color: "#78350f", letterSpacing: "0.12em" }}>
                  VERIFIED
                </span>
              </div>
              <p style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.58rem", color: "#a8936a", margin: "0.4rem 0 0", letterSpacing: "0.08em" }}>
                On-chain credential
              </p>
            </div>
          </div>
        </div>

        {/* ── Actions row ── */}
        <div
          className="cert-actions"
          style={{ display: "flex", justifyContent: "center", gap: "0.75rem", flexWrap: "wrap" }}
        >
          <button className="cert-btn btn-download" onClick={handleDownload}>
            <Download size={13} />
            Download PDF
          </button>

          <button
            className="cert-btn btn-share"
            onClick={handleShare}
            disabled={shareLoading}
            style={{ opacity: shareLoading ? 0.75 : 1 }}
          >
            {shareLoading ? <Share2 size={13} style={{ animation: "rotateSlow 1s linear infinite" }} /> : <Mail size={13} />}
            {shareLoading ? "Sharing…" : "Share Certificate"}
          </button>
        </div>

        {/* ── Credential footnote ── */}
        <p style={{
          textAlign: "center",
          fontFamily: "'DM Mono', monospace",
          fontSize: "0.62rem",
          color: "#a8936a",
          letterSpacing: "0.1em",
          margin: "-0.75rem 0 0",
        }}>
          Click the credential ID to copy · Verifiable on the Stellar network
        </p>
      </section>

      <Toast message={toast.message} visible={toast.visible} />
    </>
  );
}