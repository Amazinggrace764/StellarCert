import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { VersionController } from './controllers/version.controller';
import { VersionService } from './services/version.service';
import { DeprecationInterceptor } from './interceptors/deprecation.interceptor';

@Module({
  controllers: [VersionController],
  providers: [
    VersionService,
    {
      provide: APP_INTERCEPTOR,
      useClass: DeprecationInterceptor,
    },
  ],
  exports: [VersionService],
})
export class VersioningModule {}
