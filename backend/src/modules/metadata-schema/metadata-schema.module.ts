import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetadataSchema } from './entities/metadata-schema.entity';
import { MetadataSchemaService } from './services/metadata-schema.service';
import { MetadataSchemaController } from './controllers/metadata-schema.controller';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [TypeOrmModule.forFeature([MetadataSchema]), CommonModule],
  controllers: [MetadataSchemaController],
  providers: [MetadataSchemaService],
  exports: [MetadataSchemaService],
})
export class MetadataSchemaModule {}
