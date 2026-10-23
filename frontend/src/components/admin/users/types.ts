export type UserRole = 'admin' | 'issuer' | 'user' | 'viewer';

export interface UserActivity {
  id: string;
  action: string;
  timestamp: string;
  details: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  isIssuer: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastActive: string;
  activities: UserActivity[];
}
