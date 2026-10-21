import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { EmailQueueService } from './email-queue.service';
import { EmailQueueProcessor, EMAIL_QUEUE_NAME } from './email-queue.processor';

@Global() // Add this
@Module({
  imports: [
    BullModule.registerQueue({
      name: EMAIL_QUEUE_NAME,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
    BullBoardModule.forFeature({
      name: EMAIL_QUEUE_NAME,
      adapter: BullAdapter,
    }),
  ],
  controllers: [EmailController],
  providers: [EmailService, EmailQueueService, EmailQueueProcessor],
  exports: [EmailService, EmailQueueService],
})
export class EmailModule {}
