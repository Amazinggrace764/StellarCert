import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@instandard/config';
import { resolve } from 'path';
import { TypeOrmModule } from '@typeorm/nestjs';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { IssuersModule } from './modules/issuers/issuers.module';
import { HealthModule } from './modules/health/health.module';
import { CommonModule } from './common/common.module';
import { EmailModule } from './modules/email/email.module';
import { typeOrmConfig } from './config/typeorm.config';
import { validateEnv } from './config/environment.config';
import { CertificateModule } from './modules/certificate/certificate.module';
import { StellarModule } from './modules/stellar/stellar.module';
import { FilesModule } from './modules/files/files.module';
import { VersioningModule } from './common/versioning/versioning.module';
import { AuditModule } from './modules/audit/audit.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { MetadataSchemaModule } from './modules/metadata-schema/metadata-schema.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminAnalyticsModule } from './modules/admin-analytics/admin-analytics.module';
import { SecurityModule } from './modules/security/security.module';
import { MultisigModule } from './modules/multisig/multisig.module';
import { EventIndexerModule } from './modules/event-indexer/event-indexer.module';

const bullBoardEnabled = (configService: ConfigService): boolean => {
  const flag = configService.get<string>('BULL_BOARD_ENABLED');
  if (flag !== undefined) {
    return flag.toLowerCase() === 'true';
  }
  return configService.get<string>('NODE_ENV') !== 'production';
};

function bullBoardImports() {
  return BullBoardModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => {
      if (!bullBoardEnabled(configService)) {
        // Return a disabled configuration so the route is not mounted.
        return { route: '/admin/queues', adapter: ExpressAdapter, disabled: true } as any;
      }
      return {
        route: '/admin/queues',
        adapter: ExpressAdapter,
      };
    },
  });
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: [resolve(__dirname, '../../.emv'), '.env'],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        if (redisUrl) {
          return { redis: { url: redisUrl } };
        }
        return {
          redis: {
            host: 'localhost',
            port: 6379,
          },
        };
      },
    }),
    bullBoardImports(),
    TypeOrmModule.forRoot(typeOrmConfig),
    CommonModule,
    VersioningModule,
    HealthModule,
    AuthModule,
    UsersModule,
    IssuersModule,
    CertificateModule,
    StellarModule,
    EmailModule,
    FilesModule,
    AuditModule,
    WebhooksModule,
    MetadataSchemaModule,
    NotificationsModule,
    AdminAnalyticsModule,
    SecurityModule,
    MultisigModule,
    EventIndexerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
