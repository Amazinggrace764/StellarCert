import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../constants/roles';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for a controller method
 * @param roles - Array of roles that are allowed to access the method
 *
 * @example
 * @Get('profile')
 * @Roles(UserRole.ADMIN, UserRole.USER)
 * getProfile() {}
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
