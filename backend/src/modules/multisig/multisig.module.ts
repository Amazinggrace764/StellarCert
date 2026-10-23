import { Module } from '@nestjs/common';
import { MultisigService } from './multisig.service';
import { MultisigController } from './multisig.controller';
import { StellarModule } from '../stellar/stellar.module';
import { AuthModule } from '../auth/auth.module';
@Module({
  imports: [StellarModule, AuthModule],
  controllers: [MultisigController],
  providers: [MultisigService],
  exports: [MultisigService],
})
export class MultisigModule {}
