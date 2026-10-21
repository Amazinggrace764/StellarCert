import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AdminAnalyticsService } from '../services/admin-analytics.service';
import {
  AdminAnalyticsDto,
  AdminAnalyticsQueryDto,
} from '../dto/admin-analytics.dto';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';

@ApiTags('Admin Analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAnalyticsController {
  constructor(
    private readonly analyticsService: AdminAnalyticsService,
  ) {}

  /**
   * Retrieves platform-wide analytics for the admin dashboard.
   *
   * This is the canonical dashboard stats endpoint (GET /admin/analytics).
   * The formerly separate /admin/analytics/dashboard route has been
   * consolidated into this one so there is a single source of truth.
   *
   * Analytics may optionally be filtered using the supported
   * query parameters defined in AdminAnalyticsQueryDto.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get platform analytics',
    description:
      'Retrieves platform-wide analytics and statistics for the admin dashboard, including user, certificate, verification, and issuer metrics.',
  })
  @ApiQuery({
    type: AdminAnalyticsQueryDto,
    required: false,
    description: 'Optional filters for the analytics query.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Platform analytics retrieved successfully.',
    type: AdminAnalyticsDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication is required or the access token is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Admin privileges are required.',
  })
  async getAnalytics(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsDto> {
    return this.analyticsService.getAnalytics(query);
  }

  /**
   * Deprecated compatibility alias for the old dashboard stats endpoint.
   *
   * Historically the frontend called GET /admin/analytics/dashboard for the
   * dashboard stats. That route is now an alias of the canonical
   * GET /admin/analytics route, returning the exact same payload.
   * It exists only to preserve API compatibility during the migration
   * and should not be used by new client code.
   */
  @Get('dashboard')
  @HdttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get platform analytics (deprecated alias)',
    description:
      'Deprecated alias of GET /admin/analytics. Returns the same dashboard stats payload and is kept only for backward compatibility.',
    deprecated: true,
  })
  @ApiQuery({
    type: AdminAnalyticsQueryDto,
    required: false,
    description: 'Optional filters for the analytics query.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Platform analytics retrieved successfully.',
    type: AdminAnalyticsDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication is required or the access token is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Admin privileges are required.',
  })
  async getDashboardStats(
    @Query() query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsDto> {
    return this.analyticsService.getAnalytics(query);
  }

  /**
   * Invalidates the cached admin analytics.
   *
   * This can be used after bulk data operations or imports to ensure
   * subsequent analytics requests use fresh data.
   */
  @Post('cache/clear')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Clear analytics cache',
    description:
      'Invalidates the cached admin analytics so that subsequent requests retrieve fresh data.',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Analytics cache cleared successfully.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication is required or the access token is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Access denied. Admin privileges are required.',
  })
  async clearCache(): Promise<void> {
    await this.analyticsService.clearCache();
  }
}
