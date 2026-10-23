import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthException } from '../exceptions';
import { ErrorCode } from '../constants/error-codes';
import { ROLE_HIERARCHY, UserRole } from '../constants/roles';
import { User } from '../../modules/users/entities/user.entity';

interface RequestWithUser extends Request {
  user: User;
}

/**
 * Role-based Access Control Guard
 * Checks if the current user has the required roles
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new AuthException(
        ErrorCode.UNAUTHORIZED,
        'User information not found in request',
      );
    }

    const userRole = user.role;

    if (!userRole) {
      throw new AuthException(ErrorCode.UNAUTHORIZED, 'User role not found');
    }

    // Check if user has any of the required roles
    const hasRequiredRole = this.checkRoleHierarchy(userRole, requiredRoles);

    if (!hasRequiredRole) {
      throw new AuthException(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        `User role '${userRole}' is not authorized to access this resource`,
      );
    }

    return true;
  }

  /**
   * Check if user role has permission to access required roles
   * Uses role hierarchy to determine permissions
   */
  private checkRoleHierarchy(
    userRole: UserRole,
    requiredRoles: UserRole[],
  ): boolean {
    const allowedRoles = ROLE_HIERARCHY[userRole];

    if (!allowedRoles) {
      return false;
    }

    return requiredRoles.some((role) => allowedRoles.includes(role));
  }
}
