import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { findCertBySerialNumber, revokeCertificate } from '../api';
import { AlertTriangle, Search, ShieldAlert, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { Certificate } from '../api';
interface Message {
  type: 'success' | 'error' | 'warning' | '';
  text: string;
}

const TRIVIAL_REASONS = ['error', 'wrong', 'mistake', 'bad', 'invalid', 'test', 'expired', 'fraud'];
const MIN_REASON_LENGTH = 15;

function validateReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return 'Reason is required.';
  if (trimmed.length < MIN_REASON_LENGTH)
    return `Reason must be at least ${MIN_REASON_LENGTH} characters.`;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount < 3) return 'Reason must contain at least 3 words — avoid trivial explanations.';
  if (TRIVIAL_REASONS.includes(trimmed.toLowerCase()))
    return 'Please provide a more descriptive reason.';
  return null;
}

function formatApiError(err: unknown): string {
  const status = (err && typeof err === 'object' && 'response' in err)
    ? (err as { response: { status: number } }).response?.status
    : undefined;
  const serverMsg = (err && typeof err === 'object' && 'response' in err)
    ? (err as { response: { data?: { message?: string } } }).response?.data?.message
    : (err instanceof Error ? err.message : undefined);

  if (status === 404) return 'Certificate not found. Please check the serial number and try again.';
  if (status === 409) return 'This certificate has already been revoked.';
  if (status === 403) return 'You do not have permission to revoke this certificate.';
  if (status === 400) return `Invalid request: ${serverMsg ?? 'please check your input.'}`;
  if (!navigator.onLine) return 'No internet connection. Please check your network and try again.';
  return serverMsg ?? 'An unexpected error occurred. Please try again.';
}

const RevokeCertificate = () => {
  const [serialNumber, setSerialNumber] = useState('');
  const [reason, setReason] = useState('');
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [message, setMessage] = useState<Message>({ type: '', text: '' });
  const [reasonError, setReasonError] = useState('');
  const [revoked, setRevoked] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const navigate = useNavigate();

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serialNumber.trim()) {
      setMessage({ type: 'error', text: 'Please enter a certificate serial number.' });
      return;
    }

    setLookupLoading(true);
    setMessage({ type: '', text: '' });
    setCertificate(null);

    try {
      const result = await findCertBySerialNumber(serialNumber.trim());
      if (result && result.status === 'revoked') {
        setMessage({ type: 'warning', text: 'This certificate has already been revoked.' });
      } else if (result) {
        setCertificate({
          id: result.id,
          serialNumber: result.serialNumber,
          recipientName: result.recipientName,
          courseName: result.courseName,
          issuerName: result.issuerName,
          status: result.status,
          recipientEmail: result.recipientEmail,
          title: result.title,
          issueDate: result.issueDate,
        });
      } else {
        setMessage({ type: 'error', text: 'Certificate not found.' });
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: formatApiError(err) });
    } finally {
      setLookupLoading(false);
    }
  };

  const handleRevoke = (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateReason(reason);
    if (validationError) {
      setReasonError(validationError);
      return;
    }
    setReasonError('');
    setShowConfirm(true);
  };

  const handleConfirmRevoke = async () => {
    setShowConfirm(false);
    setRevokeLoading(true);
    setMessage({ type: '', text: '' });

    try {
      await revokeCertificate(certificate!.id, reason.trim());
      setRevoked(true);
      setMessage({ type: 'success', text: `Certificate for "${certificate?.recipientName}" has been successfully revoked and recorded on the blockchain.` });
    } catch (err: unknown) {
      setMessage({ type: 'error', text: formatApiError(err) });
    } finally {
      setRevokeLoading(false);
    }
  };

  const handleReset = () => {
    setSerialNumber('');
    setReason('');
    setCertificate(null);
    setMessage({ type: '', text: '' });
    setReasonError('');
    setRevoked(false);
  };

  return (
    <>
    {showConfirm && (
      <ConfirmDialog
        recipientName={certificate?.recipientName ?? ''}
        onConfirm={handleConfirmRevoke}
        onCancel={() => setShowConfirm(false)}
      />
    )}
    <div className="max-w-2xl mx-auto mt-6 px-4">

      {/* Page Header */}
      <div className="flex items-center gap-3 mb-6">
        <ShieldAlert className="w-8 h-8 text-red-500 dark:text-red-400 flex-shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Revoke Certificate</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Authorized personnel only — actions are permanent and blockchain-recorded</p>
        </div>
      </div>

      {/* Warning Banner */}
      <div className="flex gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-red-700 dark:text-red-300">
          Certificate revocation is <strong>irreversible</strong>. The revocation will be published to the Certificate Revocation List (CRL) and verified parties will be notified. Ensure you have authorization before proceeding.
        </p>
      </div>

      {/* Step 1 — Lookup */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6 mb-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center">1</span>
          Look Up Certificate
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Enter the certificate serial number to locate and review it before revoking.</p>

        <form onSubmit={handleLookup} className="flex gap-2">
          <input
            type="text"
            aria-label="Certificate serial number"
            className="flex-1 border border-gray-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            placeholder="e.g. STC-2026-00023"
            disabled={lookupLoading || revokeLoading || revoked}
          />
          <button
            type="submit"
            disabled={lookupLoading || revokeLoading || revoked}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {lookupLoading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Searching...</>
              : <><Search className="w-4 h-4" /> Search</>}
          </button>
        </form>
      </div>

      {/* Certificate Preview */}
      {certificate && !revoked && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6 mb-4">
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center">2</span>
              Certificate Found
            </h2>
            <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-full font-medium">Active</span>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-6">
            {[
              ['Recipient', certificate.recipientName],
              ['Course / Certificate', certificate.courseName],
              ['Issuer', certificate.issuerName],
              ['Serial Number', certificate.serialNumber],
              ['Issued On', new Date(certificate.issueDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-gray-500 dark:text-slate-400 font-medium">{label}</dt>
                <dd className="text-gray-900 dark:text-white mt-0.5">{value}</dd>
              </div>
            ))}
          </dl>

          {/* Step 2 — Reason + Submit */}
          <form onSubmit={handleRevoke} className="border-t border-gray-100 dark:border-slate-700 pt-4 space-y-4">
            <div>
              <label htmlFor="reason" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Reason for Revocation <span className="text-red-500">*</span>
              </label>
              <textarea
                id="reason"
                className={`block w-full border rounded-md px-3 py-2 text-sm h-24 bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none transition-colors ${reasonError ? 'border-red-400 dark:border-red-600' : 'border-gray-300 dark:border-slate-600'}`}
                value={reason}
                onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(''); }}
                placeholder="Describe why this certificate is being revoked (e.g. 'Issued in error — recipient did not complete course requirements')"
                aria-describedby={reasonError ? 'reason-error' : undefined}
                disabled={revokeLoading}
              />
              {reasonError && (
                <p id="reason-error" className="mt-1 text-xs text-red-600 dark:text-red-400">{reasonError}</p>
              )}
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">Minimum {MIN_REASON_LENGTH} characters · At least 3 words · This reason will be recorded for audit purposes</p>
            </div>

            {message.text && (
              <MessageBanner type={message.type} text={message.text} />
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleReset}
                disabled={revokeLoading}
                className="px-4 py-2 text-sm text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={revokeLoading}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white px-6 py-2 rounded-md text-sm font-semibold transition-colors"
              >
                {revokeLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Revoking...</>
                  : <><XCircle className="w-4 h-4" /> Confirm Revocation</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Success State */}
      {revoked && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-gray-200 dark:border-slate-700 p-6">
          <MessageBanner type="success" text={message.text} />
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleReset}
              className="text-sm text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white underline"
            >
              Revoke another certificate
            </button>
            <button
              onClick={() => navigate('/')}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Return to dashboard
            </button>
          </div>
        </div>
      )}

      {/* Lookup message (not found / already revoked) when no cert shown */}
      {!certificate && !revoked && message.text && (
        <MessageBanner type={message.type} text={message.text} />
      )}
    </div>
    </>
  );
};

const ConfirmDialog = ({
  recipientName,
  onConfirm,
  onCancel,
}: {
  recipientName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700 w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 id="confirm-title" className="text-base font-semibold text-gray-900 dark:text-white">
              Confirm Certificate Revocation
            </h2>
            <p id="confirm-desc" className="mt-1 text-sm text-gray-600 dark:text-slate-300">
              You are about to permanently revoke the certificate for{' '}
              <strong className="text-gray-900 dark:text-white">{recipientName}</strong>.
            </p>
          </div>
        </div>

        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-4 py-3 mb-6">
          <p className="text-sm text-red-700 dark:text-red-300">
            This action <strong>cannot be undone</strong>. The revocation will be published to the
            Certificate Revocation List and all verified parties will be notified.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <XCircle className="w-4 h-4" />
            Yes, Revoke Certificate
          </button>
        </div>
      </div>
    </div>
  );
};

const MessageBanner = ({ type, text }: { type: Message['type']; text: string }) => {
  const styles = {
    success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300',
    error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300',
    '': '',
  };
  const icons = {
    success: <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />,
    error: <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />,
    '': null,
  };
  return (
    <div className={`flex gap-2 border rounded-md px-4 py-3 text-sm ${styles[type ?? '']}`} role="alert">
      {icons[type ?? '']}
      <span>{text}</span>
    </div>
  );
};


export default RevokeCertificate;
