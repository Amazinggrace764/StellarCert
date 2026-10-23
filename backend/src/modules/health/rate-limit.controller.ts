import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RateLimitService } from '../../common/rate-limiting/rate-limit.service';
import { IpRateLimitGuard } from '../../common/guards/ip-rate-limit.guard';

@ApiTags('rate-limit')
@Controller('rate-limit')
export class RateLimitController {
  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly ipRateLimitGuard: IpRateLimitGuard,
  ) {}

  @Get('usage')
  @ApiOperation({
    summary: 'Get current rate limit usage by issuer and route',
  })
  @ApiResponse({
    status: 200,
    description: 'Current rate limit usage',
  })
  getUsage() {
    return {
      windowMs: this.rateLimitService['windowMs'],
      data: this.rateLimitService.getUsageSummary(),
    };
  }

  @Get('verification-limits')
  @ApiOperation({
    summary: 'Get current IP-based rate limits for verification endpoint',
  })
  @ApiResponse({
    status: 200,
    description: 'Current IP rate limit status',
  })
  getVerificationLimits(@Query('ip') ip?: string) {
    if (ip) {
      return {
        ip,
        status: this.ipRateLimitGuard.getRateLimitStatus(ip),
      };
    }

    return {
      allLimits: this.ipRateLimitGuard.getAllRateLimits(),
    };
  }
}
