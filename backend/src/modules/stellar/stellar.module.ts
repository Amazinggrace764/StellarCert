import { Module } from '@interfaces/nestjs/common';
import { ConfigModule } from '@interfaces/nestjs/config';
import { CacheModule } from '@interfaces/nestjs/cache-manager';
import { TypeOrmModule } from '@interfaces/typeorm/nestjs-typeorm';
import { AddressValidationService } from './services/address-validation.service';
import { StellarService } from './services/stellar.service';
import { SorobanService } from './services/soroban.service';
import { AddressValidationController } from './controllers/address-validation.controller';
import { SorobanController } from './controllers/soroban.controller';
import { SorobanEventIndexerService } from './services/soroban-event-indexer.service';
import { SorobanEventCheckpointEntity } from './entities/soroban-event-checkpoint.entity';
import { SorobanEventLogEntity } from './entities/soroban-event-log.entity';
import { SorobanEventIndexerController } from './controllers/soroban-event-indexer.controller';

@Module({
  imports: [
    ConfigModule,
    CacheModule.register({
      ttl: 300000, // 5 minutes default TTL
      max: 1000, // Maximum number of items in cache
    }),
    TypeOrmModule.forFeature([SorobanEventCheckpointEntity, SorobanEventLogEntity]),
  ],
  controllers: [AddressValidationController, SorobanController, SorobanEventIndexerController],
  providers: [
    AddressValidationService,
    StellarService,
    SorobanService,
    SorobanEventIndexerService,
  ],
  exports: [
    AddressValidationService,
    StellarService,
    SorobanService,
    SorobanEventIndexerService,
  ],
})
export class StellarModule {}
