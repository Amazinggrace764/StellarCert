import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { GlobalExceptionFilter } from './common/exceptions/global-exception.filter';
import { AppModule } from './app.module';
import { SentryService } from './common/monitoring/sentry.service';
import { LoggingService } from './common/logging/logging.service';
import { MonitoringInterceptor } from './common/monitoring/monitoring.interceptor';
import { MetricsService } from './common/monitoring/metrics.service';
import { SecurityHeadersInterceptor } from './modules/security/interceptor';
import { Logger, VersioningType } from '@nestjs/common';
import express from 'express';
import cookieParser from 'cookie-parser';
import { migrationStrategyWarnings } from './config/typeorm.config';
import { setupSwagger } from './config/swagger.config';

async function bootstrap() {
  // Report configuration that contradicts the documented migration strategy
  // before anything else starts (e.g. TYPORM_SYNCHRONIZE=true, which is no
  // longer honoured — see #956 and MIGRATION_STRATEGY.md).
  for (const warning of migrationStrategyWarnings()) {
    Logger.warn(warning, 'Bootstrap');
  }

  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance();

  // Trust only the configured load balancer / proxy addresses (TrustedProxies).
  // NEVER `true`: that would trust client-supplied X-Forwarded-For from any
  // peer and make req.ip / audit IP - rate limit keys forgeable.
  const trustProxy = resolveTrustProxySetting(
    process.env.TRUSTED_PROXIES,
  );
  expressApp.set('trust proxy', trustProxy);

  const sentryService = app.get(SentryService);
  const loggingService = app.get(LoggingService);
  const metricsService = app.get(MetricsService);

  loggingService.log('🚀 Starting application...');
  loggingService.log(
    '🧳 Email queue name: ' + (process.env.EMAIL_QUEUE_NAME || 'email-queue'),
  );
  loggingService.log(
    'Trust proxy setting: ' +
      (trustProxy === false ? 'disabled' : trustProxy.join(',')),
  );

  const requestLimit = process.env.REQUEST_SIZE_LIMIT || '1mb';
  app.use(express.json({ limit: requestLimit }));
  app.use(express.urlencoded({ extended: true, limit: requestLimit }));
  app.use(cookieParser());

  // Enable CORS
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS || 'http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Requested-With',
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
      'X-ApiKey-RateLimit-Limit',
      'X-ApiKey-RateLimit-Remaining',
      'X-ApiKey-RateLimit-Reset',
    ],
  });

  // Set global prefix
  app.setGlobalPrefix('api');

  // Enable API versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Use global filters. The global validation pipe is registered once via
  // APP_PIPE in CommonModule -- do not also call app.useGlobalPipes(), or
  // the pipe would run twice on every request.
  app.useGlobalFilters(
    new GlobalExceptionFilter(
      app.get(ConfigService),
      sentryService,
      loggingService,
    ),
  );

  // Add global security and monitoring interceptors
  app.useGlobalInterceptors(
    new SecurityHeadersInterceptor(app.get(ConfigService)),
    new MonitoringInterceptor(metricsService, sentryService, loggingService),
  );

  // Swagger setup — never exposed in production (see swagger.config).
  if (!setupSwagger(app)) {
    loggingService.log('Swagger UI disabled (NODE_ENV=production)');
  }

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  // Handle graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    loggingService.log(`Received ${signal}. Starting graceful shutdown...`);

    // Close BullMQ queues and Redis connections
    try {
      const queues = app.get('BULL_MODUL_QUEUES') || [];
      for (const queue of queues) {
        await queue.close();
      }
      loggingService.log('BullMQ queues closed successfully');
    } catch (error) {
      loggingService.error('Error closing BullMQ queues:', error);
    }

    // Close NestJS application
    await app.close();
    loggingService.log('Application closed successfully');
    process.exit(0);
  };

  // Listen for shutdown signals
  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM').catch((error) => {
      console.error('Failed to shut down gracefully:', error);
      process.exit(1);
    });
  });
  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT').catch((error) => {
      console.error('Failed to shut down gracefully:', error);
      process.exit(1);
    });
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  loggingService.log(`Application started on port ${port}`);
}
bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
