import { UserRole, UserStatus } from '../entities/user.entity';

export interface IUser {
  id: string;
  email: string;
  username?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  profilePicture?: string;
  role: UserRole;
  status: UserStatus;
  stellarPublicKey?: string;
  isEmailVerified: boolean;
  isActive: boolean;
  metadata?: Record<string, any>;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserWithPassword extends IUser {
  password: string;
}

export interface IUserPublic {
  id: string;
  email: string;
  username?: string;
  firstName: string;
  lastName: string;
  profilePicture?: string;
  role: UserRole;
  stellarPublicKey?: string;
  isEmailVerified: boolean;
  createdAt: Date;
}

export interface IUserSession {
  id: string;
  email: string;
  role: UserRole;
  isEmailVerified: boolean;
}

export interface ITokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface IAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ILoginResponse {
  user: IUserPublic;
  tokens: IAuthTokens;
}

export interface IPasswordResetRequest {
  email: string;
}

export interface IPasswordReset {
  token: string;
  newPassword: string;
}

export interface IEmailVerification {
  token: string;
}

export interface IUserFilter {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  status?: UserStatus;
  isActive?: boolean;
  isEmailVerified?: boolean;
  search?: string;
}

export interface ISortOptions {
  field: string;
  order: 'ASC' | 'DESC';
}
