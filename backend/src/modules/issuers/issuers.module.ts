import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { StellarModule } from '../stellar/stellar.module';
import { Issuer } from './entities/issuer.entity';
import { IssuersService } from './issuers.service';
import { IssuersController } from './issuers.controller';
import { IssuerKeypairService } from './issuer-keypair.service';
import { IssuerKeypair } from './entities/issuer-keypair.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Issuer, IssuerKeypair]),
    AuthModule,
    StellarModule,
  ],
  providers: [IssuersService, IssuerKeypairService],
  controllers: [IssuersController],
  exports: [IssuersService, IssuerKeypairService],
})
export class IssuersModule {}
