export interface CertificateStatistics {
  totalCertificates: number;
  activeCertificates: number;
  revokedCertificates: number;
  expiredCertificates: number;
  pendingCertificates: number;
  issuanceTrend: IssuanceTrendItem[];
  topIssuers: TopIssuer[];
  verificationStats: VerificationStatistics;
}

export interface IssuanceTrendItem {
  date: string;
  count: number;
}

export interface TopIssuer {
  issuerId: string;
  issuerName: string;
  certificateCount: number;
}

export interface VerificationStatistics {
  totalVerifications: number;
  successfulVerifications: number;
  failedVerifications: number;
  averageVerificationsPerCertificate: number;
}
