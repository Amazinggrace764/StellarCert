import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '../../users/entities/user.entity';

/**
 * Enforces that ISSUER and ADMIN users have 2FA enabled before accessing
 * protected resources.  Apply this guard after JwtAuthGuard.
 */
@Injectable()
export class TwoFactorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();

    if (!user) return false;

    const requiresTwoFactor =
      user.role === UserRole.ISSUER || user.role === UserRole.ADMIN;

    if (requiresTwoFactor && !user.twoFactorEnabled) {
      throw new ForbiddenException(
        '2FA must be enabled for issuer and admin accounts',
      );
    }

    return true;
  }
}
