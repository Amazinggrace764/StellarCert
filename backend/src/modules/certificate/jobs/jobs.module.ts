import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { JobsService } from './services/jobs.service';
import { JobsProcessor } from './services/jobs.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'certificate-jobs',
    }),
    BullBoardModule.forFeature({
      name: 'certificate-jobs',
      adapter: BullAdapter,
    }),
  ],
  providers: [JobsService, JobsProcessor],
  exports: [JobsService],
})
export class JobsModule {}
