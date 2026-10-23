import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../../common/common.module';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { CorsMiddleware } from './middleware/cors.middleware';
import { InputSanitizationMiddleware } from './middleware/input-sanitization.middleware';
import { SecurityHeadersInterceptor } from './interceptor';
import { RateLimitStorageModule } from './rate-limit-storage.module';

@Module({
  imports: [ConfigModule, CommonModule, RateLimitStorageModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SecurityHeadersInterceptor,
    },
  ],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Input sanitization is no longer applied globally as a per-command
    // mutating middleware. Sanitization is scoped to specific fields at the
    // validation boundary (see InputSanitizationMiddleware), preserving
    // legitimate \n/\r/\t content in multi-line and tab-delimited data.
    consumer.apply(CorsMiddleware).forRoutes({
      path: '{*path}',
      method: RequestMethod.ALL,
    });
  }
}
