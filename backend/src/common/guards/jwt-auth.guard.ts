import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';
import { AuthException } from '../exceptions';
import { ErrorCode } from '../constants/error-codes';
import { Request } from 'express';
import { JwtManagementService } from '../../modules/auth/services/jwt.service';
import { UsersService } from '../../modules/users/users.service';

/**
 * Canonical shape attached to `req.user` by JwtAuthGuard.
 * `id` and `sub` are aliases for the same user id so both
 * `@CurrentUser('id')` and `@CurrentUser('sub')` resolve correctly,
 * regardless of which guard authenticated the request.
 */
export interface AuthenticatedUser {
  id: string;
  sub: string;
  email: string;
  role: string;
}

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

/**
 * JWT Authentication Guard
 * Validates JWT tokens from the Authorization header, enforces the
 * token blacklist (logout), and re-loads the user to verify existence
 * and active status on every protected request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private configService: ConfigService,
    private jwtManagementService: JwtManagementService,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if the route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new AuthException(
        ErrorCode.UNAUTHORIZED,
        'Missing authentication token',
      );
    }

    // Enforce the blacklist before accepting the token. Logout writes
    // blacklist entries here, so this is the owning boundary that must consult
    // them. A cache fault must fail closed (deny) rather than silently
    // accepting a revoked token.
    let isBlacklisted: boolean;
    try {
      isBlacklisted =
        await this.jwtManagementService.isTokenBlacklisted(token);
    } catch {
      throw new AuthException(
        ErrorCode.UNAUTHORIZED,
        'Unable to validate token status',
      );
    }

    if (isBlacklisted) {
      throw new AuthException(
        ErrorCode.TOKEN_INVALID,
        'Token has been revoked',
      );
    }

    let payload: any;
    try {
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

      if (!secret) {
        throw new AuthException(
          ErrorCode.UNAUTHORIZED,
          'JWT configuration is missing',
        );
      }

      payload = this.tokenServiceVerify(token, secret);
    } catch (error: unknown) {
      if (error instanceof AuthException) {
        throw error;
      }
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AuthException(ErrorCode.TOKEN_EXPIRED, 'Token has expired');
      }
      throw new AuthException(ErrorCode.TOKEN_INVALID, 'Invalid token');
    }

    // Re-load the user so suspended/deleted accounts cannot keep
    // authenticating with a still-valid token.
    const user = await this.usersService.findOneById(payload.sub);
    if (!user) {
      throw new AuthException(ErrorCode.TOKEN_INVALID, 'User not found');
    }
    if (!user.isActive) {
      throw new AuthException(
        ErrorCode.TOKEN_INVALID,
        'User account is inactive',
      );
    }

    // Single canonical req.user shape: id and sub are aliases of the same
    // user id, so @CurrentUser('id') and @CurrentUser('sub') both resolve.
    request.user = {
      id: payload.sub,
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    return true;
  }

  private tokenServiceVerify(token: string, secret: string): any {
    return this.jwtService.verify(token, { secret });
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }

    const [scheme, token] = authHeader.split(' ');
    return scheme === 'Bearer' ? token : undefined;
  }
}
