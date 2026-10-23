/*
 * User roles in the system
 */
export enum UserRole {
  ADMIN = "admin",
  ISSUER = "issuer",
  RECIPIENT = "recipient",
  VERIFIER = "verifier",
  AUDITOR = "auditor",
  USER = "user",
}

/**
 * Basic User profile information
 *
 * Note: `firstName` and `lastName` are optional because not every
 * authentication flow (e.g. Stellar-only sign-in, invite acceptance, or not
 * legacy accounts migrated from an email-only store) doesn't know the user's name.
 * Consumers must not assume these fields are present; use `getUserDisplayName`
 * (or an explicit `'firstName' in user' guard) instead of accessing them directly.
 */
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
  isEmailVerified?: boolean;
  stellarPublicKey?: string;
  organization?: string;
  username?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
  profilePicture?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Return a human-readable display name for a user, falling back through
 * username -> email local-part -> email when the first/last name are not
 * available. This is the single source of truth for displaying a user's name
 * and replaces ad-hoc 'firstName' in user' guards scattered across the app.
 */
export function getUserDisplayName(
  user: Pick<User, "email" | "firstName" | "lastName" | "username"> | null | undefined,
): string {
  if (!user) {
    return "";
  }

  const first = typeof user.firstName === "string" ? user.firstName.trim() : "";
  const last = typeof user.lastName === "string" ? user.lastName.trim() : "";
  const full = [first, last].filter(Boolean).join(" ");
  if (full) {
    return full;
  }

  if (user.username && user.username.trim()) {
    return user.username.trim();
  }

  if (user.email) {
    const [localPart] = user.email.split("@");
    return localPart || user.email;
  }

  return "";
}

/**
 * Authentication Response from login/register
 *
 * When `requiresEmailVerification` is true, the account was created but
 * has not yet been verified. Callers MUST not treat this as an authenticated
 * session: do not persist tokens or redirect into protected routes. Instead,
 * show a "check your email" state. Tokens are optional here because the
 * backend may omit them for unverified accounts.
 */
export interface AuthResponse {
  user: User;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  requiresEmailVerification?: boolean;
}

/**
 * Type guard: true when an auth response represents a registration/login
 * that must not establish an authenticated session until email verification
 * completes.
 */
export function requiresEmailVerification(
  response: Pick<AuthResponse, "requiresEmailVerification" | "user"> | null | undefined,
): boolean {
  if (!response) {
    return false;
  }
  if (response.requiresEmailVerification === true) {
    return true;
  }
  // Fall back to the user record so a stale/omitted flag cannot bypass the
  // verification gate.
  return response.user?.isEmailVerified === false;
}

/**
 * Certificate data model
 */
export interface Certificate {
  id: string;
  serialNumber: string;
  recipientName: string;
  recipientEmail: string;
  title: string;
  courseName: string;
  issuerName: string;
  issueDate: string;
  expiryDate?: string;
  status: "active" | "revoked" | "expired" | "frozen";
  pdfUrl?: string; // Link to certificate file
  txHash?: string; // Stellar transaction hash
  cid?: string; // IPFS cID for certificate file/metadata
  metadata?: Record<string, unknown>;
  frozenAt?: string;
  freezeReason?: string;
  unfreezeAt?: string;
  /**
   * Id of the user who owns this certificate. Used by the wallet to
   * determine whether the current user may perform owner-only actions
   * (download, transfer, revoke). May be absent on legacy responses.
   */
  ownerId?: string;
  /**
   * Id of the user who issued this certificate. Used by the wallet to
   * determine whether the current user may perform issuer-owned actions
   * (revoke). May be absent on legacy responses.
   */
  issuerId?: string;
}

/**
 * Determine whether a user may perform owner-only actions (download,
 * transfer, revoke) on a certificate. Only the certificate owner (or an
 * admin) is allowed; verifiers and other roles are not.
 */
export function canPerformOwnerActions(
  user: Pick<User, "id" | "role"> | null | undefined,
  certificate: Pick<Certificate, "ownerId"> | null | undefined,
): boolean {
  if (!user || !certificate) {
    return false;
  }
  if (user.role === UserRole.ADMIN) {
    return true;
  }
  return Boolean(certificate.ownerId) && certificate.ownerId === user.id;
}

/**
 * Determine whether a user may perform issuer-owned actions (revoke) on a
 * certificate. Only the issuing user (or an admin) is allowed.
 */
export function canPerformIssuerActions(
  user: Pick<User, "id" | "role"> | null | undefined,
  certificate: Pick<Certificate, "issuerId"> | null | undefined,
): boolean {
  if (!user || !certificate) {
    return false;
  }
  if (user.role === UserRole.ADMIN) {
    return true;
  }
  return Boolean(certificate.issuerId) && certificate.issuerId === user.id;
}

/**
 * Certificate Transfer model (#286)
 */
export interface CertificateTransfer {
  id: string;
  certificateId: string;
  fromUserId: string;
  toEmail: string;
  toUserId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  initiationReason?: string;
  rejectionReason?: string;
  confirmationCode?: string;
  createdAt: string;
  updatedAt: string;
  certificate?: Certificate;
}

/**
 * Event payload emitted when a certificate transfer is initiated.
 * Mirrors the on-chain `TransferInitiatedEvent` so off-chain indexers and
 * the intended new owner can react to a pending transfer.
 */
export interface TransferInitiatedEvent {
  transferId: string;
  certificateId: string;
  fromOwner: string;
  toOwner: string;
}

export interface InitiateTransferDto {
  certificateId: string;
  newOwnerEmail: string;
  newOwnerName: string;
  reason?: string;
}

export interface ApproveTransferDto {
  transferId: string;
  confirmationCode?: string;
}

export interface RejectTransferDto {
  transferId: string;
  reason?: string;
}

/**
 * Request payload for creating a certificate
 */
export interface CreateCertificateData {
  title: string;
  description: string;
  recipientName: string;
  recipientEmail: string;
  courseName: string;
  issuerName: string;
  issueDate: string;
  issuerId: string;
  recipientId?: string;
  expiryDate?: string;
  templateId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Verification result details
 */
export interface VerificationResult {
  isValid: boolean;
  status?: "valid" | "revoked" | "expired" | "not_found";
  certificate?: Certificate;
  verificationDate?: string;
  verifiedAt?: string;
  stellarProof?: {
    txHash: string;
    ledger: number;
    timestamp: string;
  };
  message?: string;
  verificationId?: string;
}

/**
 * Certificate Template model
 */
export interface CertificateTemplate {
  id: string;
  name: string;
  description?: string;
  layoutUrl: string;
  fields: string[];
  issuerId: string;
}

export interface IssuanceTrendPoint {
  date: string;
  count: number;
}

export interface StatusDistribution {
  active: number;
  revoked: number;
  expired: number;
}

export type ActivityType = "issue" | "verify" | "revoke";

export interface ActivityItem {
  type: ActivityType;
  date: string;
  description: string;
}

/**
 * Dashboard / Analytics Summary
 */
export interface DashboardStats {
  totalCertificates: number;
  activeCertificates: number;
  revokedCertificates: number;
  expiredCertificates?: number;
  totalVerifications: number;
  verifications24h: number;
  totalUsers: number;
  issuanceTrend?: IssuanceTrendPoint[];
  statusDistribution?: StatusDistribution;
  recentActivity: ActivityItem[];
}

export interface UsersByRoleStats {
  users: number;
  issuers: number;
  admins: number;
  total: number;
}

export interface UsersByStatusStats {
  active: number;
  inactive: number;
  suspended: number;
  pendingVerification: number;
}

export interface CertificatesByStatusStats {
  active: number;
  revoked: number;
  expired: number;
  total: number;
}

export interface TopIssuerAnalytics {
  issuerId: string;
  issuerName: string;
  certificateCount: number;
  percentage: number;
}

export interface VerificationTrends {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  last24Hours: number;
  last7Days: number;
  last30Days: number;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface AdminAnalytics {
  usersByRole: UsersByRoleStats;
  usersByStatus: UsersByStatusStats;
  certificatesByStatus: CertificatesByStatusStats;
  topIssuers: TopIssuerAnalytics[];
  verificationTrends: VerificationTrends;
  userRegistrationTrend: TrendPoint[];
  certificateIssuanceTrend: TrendPoint[];
  totalIssuers: number;
}

export interface AuditLogItem {
  id: string;
  action: string;
  description: string;
  userId?: string;
  resourceId?: string;
  resourceType?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  createdAt?: string;
  errorMessage?: string;
  userEmail?: string;
}

export interface AuditLogSearchResponse {
  data: AuditLogItem[];
  total: number;
}

export interface AuditStatistics {
  total: number;
  byAction?: Record<string, number>;
  byUser?: Record<string, number>;
  byResourceType?: Record<string, number>;
}

/**
 * Standard API error response
 */
export interface ApiErrorResponse {
  message: string;
  statusCode: number;
  error?: string;
  details?: unknown;
}

export type ApiErrorData = ApiErrorResponse;

/**
 * API Error class that extends Error for proper instanceof checks
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, error?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.error = error;
    this.details = details;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
}

/**
 * Helper to extract error message from unknown error
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'An unexpected error occurred';
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CertificateExportFilters {
  search?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface LoginCredentials {
  email: string;
  password?: string;
  [key: string]: unknown;
}

export interface RegisterData {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  [key: string]: unknown;
}

export interface ProfileUpdateData {
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
  organization?: string;
  profilePicture?: string;
}
