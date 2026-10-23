import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'isPublic';

/**
 * Decorator to mark a route as public (no authentication required)
 *
 * @example
 * @Post('login')
 * @Public()
 * login() {}
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
