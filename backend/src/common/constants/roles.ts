/**
 * Application role constants
 */
export enum UserRole {
  ADMIN = 'admin',
  ISSUER = 'issuer',
  USER = 'user',
  AUDITOR = 'auditor',
  RECIPIENT = 'recipient',
  VERIFIER = 'verifier',
}

/**
 * All role values derived dynamically from the enum.
 * Use this instead of hardcoding role lists so new roles are never omitted.
 */
export const ALL_USER_ROLES: ReadonlyArray<UserRole> = Object.values(UserRole);

export const ROLE_HIERARCHY = {
  [UserRole.ADMIN]: [
    UserRole.ADMIN,
    UserRole.ISSUER,
    UserRole.USER,
    UserRole.AUDITOR,
    UserRole.RECIPIENT,
    UserRole.VERIFIER,
  ],
  [UserRole.ISSUER]: [UserRole.ISSUER, UserRole.USER, UserRole.RECIPIENT],
  [UserRole.AUDITOR]: [UserRole.AUDITOR, UserRole.USER, UserRole.VERIFIER],
  [UserRole.VERIFIER]: [UserRole.VERIFIER, UserRole.USER],
  [UserRole.RECIPIENT]: [UserRole.RECIPIENT, UserRole.USER],
  [UserRole.USER]: [UserRole.USER],
};

export const PUBLIC_ROUTES = [
  'auth/login',
  'auth/register',
  'auth/refresh',
  'health',
  'health/status',
];
