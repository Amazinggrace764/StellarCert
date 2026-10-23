import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate, CertificateStatus } from '../entities/certificate.entity';
import { Verification } from '../entities/verification.entity';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { WebhookEvent } from '../../webhooks/entities/webhook-subscription.entity';

@Injectable()
export class CertificateVerificationService {
  private readonly logger = new Logger(CertificateVerificationService.name);

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    @InjectRepository(Verification)
    private readonly verificationRepository: Repository<Verification>,
    private readonly webhooksService: WebhooksService,
  ) {}

  /**
   * A certificate is valid only when it is `Active` and not time-expired.
   * This is the single source of truth for validity and must match the
   * owning boundary (e.g. `is_valid` in the Rust core). Any non-`Active` status
   * (`Revoked`, `Suspended`, `Expired`, `Frozen`) makes the certificate invalid.
   */
  isCertificateValid(certificate: Certificate): boolean {
    const statusValid = certificate.status === CertificateStatus.ACTIVE;
    const notTimeExpired =
      !certificate.expiresAt ||
      new Date(certificate.expiresAt).getTime() > Date.now();
    return statusValid && notTimeExpired;
  }

  async findByVerificationCode(verificationCode: string): Promise<Certificate> {
    const certificate = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.verificationCode = :verificationCode', {
        verificationCode,
      })
      // Deliberately NOT filtered to status='active'. Verification has to be
      // able to answer "this certificate was revoked" or "this one is frozen";
      // filtering non-active rows out here made every one of them come back as
      // "Certificate not found", which is both wrong and the opposite of what
      // a revocation check is for. The mapper classifies the status instead.
      //
      // Expiry is different: an expired certificate is not a valid
      // verification result, regardless of whether the expiration job has
      // already flipped its status. Reject here so expired certificates cannot
      // pass verification or emit a CERTIFICATE_VERIFIED webhook.
      .andWhere(
        '(certificate.expiresAt IS NULL OR certificate.expiresAt > NOW())',
      )
      .getOne();

    if (!certificate) {
      throw new NotFoundException(
        'Certificate not found or invalid verification code',
      );
    }

    return certificate;
  }

  async verifyCertificate(verificationCode: string): Promise<Certificate> {
    try {
      const certificate = await this.findByVerificationCode(verificationCode);

      // Classify the certificate at the owning boundary. A certificate that is
      // not active (including Frozen) or time-expired is not a valid
      // verification and must not be recorded as a successful one.
      const valid = this.isCertificateValid(certificate);

      // Record the verification attempt with its actual outcome.
      await this.verificationRepository.save({
        certificate,
        success: valid,
        verifiedAt: new Date(),
      });

      if (!valid) {
        this.logger.warn(
          `Certificate verification rejected: ${certificate.id} (status=${certificate.status}) with code: ${verificationCode}`,
        );
        throw new NotFoundException(
          'Certificate not found or invalid verification code',
        );
      }

      this.logger.log(
        `Certificate verified: ${certificate.id} with code: ${verificationCode}`,
      );

      // Trigger webhook event
      await this.webhooksService.triggerEvent(
        WebhookEvent.CERTIFICATE_VERIFIED,
        certificate.issuerId,
        {
          id: certificate.id,
          verificationCode,
          verifiedAt: new Date(),
          recipientEmail: certificate.recipientEmail,
        },
      );

      return certificate;
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Option: Record failed verification in DB too
        this.logger.warn(
          `Failed verification attempt with code: ${verificationCode}`,
        );
      }
      throw error;
    }
  }

  async getVerificationHistory(certificateId: string): Promise<Verification[]> {
    return this.verificationRepository.find({
      where: { certificate: { id: certificateId } as any },
      order: { verifiedAt: 'DESC' },
    });
  }
}
