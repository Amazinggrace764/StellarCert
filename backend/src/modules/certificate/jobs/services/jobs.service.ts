import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { EnqueueEmailDto, EnqueuePdfDto } from '../dto/create-job.dto';

@Injectable()
export class JobsService {
  constructor(@InjectQueue('certificate-jobs') private jobQueue: Queue) {}

  async enqueueEmailJob(payload: EnqueueEmailDto) {
    await this.jobQueue.add('send-email', payload, {
      attempts: 3,
      backoff: 5000,
    });
  }

  async enqueuePdfJob(payload: EnqueuePdfDto) {
    await this.jobQueue.add('generate-pdf', payload, {
      attempts: 3,
      backoff: 5000,
    });
  }

  async enqueueExpirationCheck() {
    await this.jobQueue.add(
      'expiration-check',
      {},
      { repeat: { cron: '0 0 * * *' } },
    );
  }
}
