export interface StellarCertificateData {
  certificateId: string;
  recipientName: string;
  recipientEmail: string;
  title: string;
  issuerId: string;
  issuedAt: string; // ISO string
  expiresAt?: string; // ISO string
  verificationCode: string;
}

export interface StellarTransactionData {
  hash: string;
  ledger?: number;
  memo: string;
  sequenceNumber?: string;
  successful: boolean;
  createdAt?: string;
}
