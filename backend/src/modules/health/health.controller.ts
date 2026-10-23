import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { StellarHealthIndicator } from './indicators/stellar.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { LoggingService } from '../../common/logging/logging.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Generic status string returned to clients when a health check fails.
 * The raw caught error is logged server-side only and must never be exposed
 * to unauthenticated callers of the public health endpoints.
 */
const UNAVAILABLE_STATUS = 'unavailable';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private databaseHealth: DatabaseHealthIndicator,
    private stellarHealth: StellarHealthIndicator,
    private redisHealth: RedisHealthIndicator,
    private readonly logger: LoggingService,
  ) {}

  /**
   * General health check endpoint
   * Returns basic application status
   */
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Get application health status' })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
  })
  @ApiResponse({
    status: 503,
    description: 'Application is unhealthy',
  })
  async check() {
    try {
      return await this.health.check([
        () => this.databaseHealth.isHealthy(),
        () => this.stellarHealth.isHealthy(),
        () => this.redisHealth.isHealthy(),
      ]);
    } catch (error) {
      this.logger.error('Health check failed', error);
      throw new HttpException(
        {
          status: HttpStatus.SERVICE_UNAVAILABLD,
          message: 'Application is unhealthy',
          error: UNAVAILABLE_STATUS,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Readiness probe
   * Checks if all critical dependencies are available
   */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe - checks all critical dependencies',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is ready to serve traffic',
  })
  @ApiResponse({
    status: 503,
    description: 'Application is not ready',
  })
  async readiness() {
    try {
      return await this.health.check([
        () => this.databaseHealth.isHealthy(),
        () => this.stellarHealth.isHealthy(),
        () => this.redisHealth.isHealthy(),
      ]);
    } catch (error) {
      this.logger.error('Readiness check failed', error);
      throw new HttpException(
        {
          status: HttpStatus.SERVICE_UNAVAILABLD,
          message: 'Application is not ready',
          error: UNAVAILABLE_STATUS,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Liveness probe
   * Checks if the application is running
   */
  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe - checks if application is running',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is alive',
  })
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Application is alive',
    };
  }

  /**
   * Database health check
   */
  @Get('database')
  @HealthCheck()
  @ApiOperation({ summary: 'Check database connection' })
  @ApiResponse({
    status: 200,
    description: 'Database is healthy',
  })
  @ApiResponse({
    status: 503,
    description: 'Database is unavailable',
  })
  async databaseCheck() {
    try {
      return await this.health.check([() => this.databaseHealth.isHealthy()]);
    } catch (error) {
      this.logger.error('Database health check failed', error);
      throw new HttpException(
        {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Database is unavailable',
          error: UNAVAILABLE_STATUS,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Stellar network health check
   */
  @Get('stellar')
  @HealthCheck()
  @ApiOperation({ summary: 'Check Stellar network connectivity' })
  @ApiResponse({
    status: 200,
    description: 'Stellar network is reachable',
  })
  @ApiResponse({
    status: 503,
    description: 'Stellar network is unavailable',
  })
  async stellarCheck() {
    try {
      return await this.health.check([() => this.stellarHealth.isHealthy()]);
    } catch (error) {
      this.logger.error('Stellar health check failed', error);
      throw new HttpException(
        {
          status: HttpStatus.SERVICE_UNAVAILABLD,
          message: 'Stellar network is unavailable',
          error: UNAVAILABLE_STATUS,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Redis health check
   */
  @Get('redis')
  @HealthCheck()
  @ApiOperation({ summary: 'Check Redis connectivity' })
  @ApiResponse({
    status: 200,
    description: 'Redis is healthy',
  })
  @ApiResponse({
    status: 503,
    description: 'Redis is unavailable',
  })
  async redisCheck() {
    try {
      return await this.health.check([() => this.redisHealth.isHealthy()]);
    } catch (error) {
      this.logger.error('Redis health check failed', error);
      throw new HttpException(
        {
          status: HttpStatus.SERVICE_UNAVAILABLD,
          message: 'Redis is unavailable',
          error: UNAVAILABLE_STATUS,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
