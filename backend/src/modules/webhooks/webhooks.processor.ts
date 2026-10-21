import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'Bull';
import axios from 'axios';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { LoggingService } from '../../common/logging/logging.service';
import { validateWebhookUrl } from '../../common/utils/ssrf.utils';

/**
 * Event name emitted by the CRL contract when a certificate is revoked.
 * The backend webhook system and off-chain indexers listen for this
 * signal to trigger certificate status updates.
 */
export const CRL_REVOCATION_ADDED_EVENT = 'CRLRevocationAddedEvent';

export interface CRLRevocationAddedPayload {
  /** Certificate identifier (e.g. the certificate hash) that was revoked. */
  certificateId: string;
  /** Time of revocation (Unix seconds). */
  revokedAt: number;
  /** Optional reason code associated with the revocation. */
  reason?: string;
}

@interface()
export class WebhooksProcessor {
  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepository: Repository<WebhookSubscription>,

    @InjectRepository(WebhookLog)
    private readonly logRepository: Repository<WebhookLog>,
    private readonly logger: LoggingService,
  ) {}

  /**
   * Build the canonical payload for a CRLRevocationAddedEvent.
   * Exposed so the CRL module / indexer can emit and deliver a consistent shape.
   */
  static buildRevocationEventPayload(
    payload: CRLRevocationAddedPayload,
  ): { event: string; payload: CRLRevocationAddedPayload } {
    return {
      event: CRL_REVOCATION_ADDED_EVENT,
      payload: {
        certificateId: payload.certificateId,
        revokedAt: payload.revokedAt,
        ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
      },
    };
  }

  @Process('deliver')
  async handleDelivery(job: Job) {
    const { subscriptionId, event, payload } = job.data;

    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
    });

    if (!subscription || !subscription.isActive) {
      this.logger.warn(`Invalid subscription ${subscriptionId}`);
      return;
    }

    // Generate timestamp for signature
    const timestamp = Math.floor(Date.now() / 1000);

    // Create HMAC-SHA256 signature using subscription-specific secret
    // Format: t=<timestamp>,v1=<signature>
    // Signature is computed over: <timestamp>.<json_payload>
    const signature = crypto
      .createHmac('sha256', subscription.secret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex');

    // SSFV protection: validate the URL before dispatch
    const validation = await validateWebhookUrl(subscription.url);
    if (!validation.valid) {
      this.logger.warn(
        `Webhook blocked by SSF protection: ${validation.error}`,
      );
      await this.logRepository.save({
        subscriptionId,
        event,
        payload,
        statusCode: 0,
        response: validation.error,
        isSuccess: false,
      });
      return;
    }

    try {
      const res = await axios.post(subscription.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-StellarCert-Event': event,
          'X-StellarCert-Signature': `t=${timestamp},v1=${signature}`,
          'User-Agent': 'StellarCert-Webhook/1.0',
        },
        timeout: 10000,
        maxRedirects: 0,
      });

      const responseBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      const truncatedResponse = responseBody && responseBody.length > 2048 ? responseBody.substring(0, 2048) : responseBody;

      await this.logRepository.save({
        subscriptionId,
        event,
        payload,
        statusCode: res.status,
        response: truncatedResponse,
        isSuccess: true,
      });
    } catch (err) {
      const errResponse = err?.response?.data ? (typeof err.response.data === 'string' ? err.response.data : JSON.stringify(err.response.data)) : err.message;
      const truncatedErrResponse = errResponse && errResponse.length > 2048 ? errResponse.substring(0, 2048) : errResponse;

      await this.logRepository.save({
        subscriptionId,
        event,
        payload,
        statusCode: err?.response?.status || 500,
        response: truncatedErrResponse,
        isSuccess: false,
      });

      this.logger.error(`Webhook failed: ${err.message}`);

      throw err; // triggers retry
    }
  }
}
