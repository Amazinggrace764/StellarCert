import { CertificateStatus } from '../constants/certificate-status.enum';

export interface VerificationResult {
  isValid: boolean;
  certificate?: VerifiedCertificateData;
  stellarVerified?: boolean;
  stellarTransactionHash?: string;
  verifiedAt: Date;
  message: string;
}

export interface VerifiedCertificateData {
  id: string;
  certificateId: string;
  recipientName: string;
  recipientEmail: string;
  title: string;
  issuerName: string;
  issuedAt: Date;
  expiresAt: Date | null;
  status: CertificateStatus;
  verificationCount: number;
}
