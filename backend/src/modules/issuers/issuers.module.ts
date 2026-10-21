import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module'; // Import AuthModule
import { Issuer } from './entities/issuer.entity';
import { IssuersService } from './issuers.service';
import { IssuersController } from './issuers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Issuer]),
    AuthModule, // Add this - now JwtService will be available
  ],
  providers: [IssuersService],
  controllers: [IssuersController],
  exports: [IssuersService],
})
export class IssuersModule {}
