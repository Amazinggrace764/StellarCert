import {
  Injectable,
  ConflictException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate } from '../entities/certificate.entity';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { WebhookEvent } from '../../webhooks/entities/webhook-subscription.entity';
import { UserRole } from '../../users/entities/user.entity';
import { CertificateStatus } from '../constants/certificate-status.enum';
import { CertificateIndexService } from './certificate-index.service';

/**
 * Boundary contract for synchronizing revocations with the CRL.
 *
 * The CRL is the authoritative source for revocation checks, so the main
 * contract status must only be flipped once the CRL entry has been written.
 * Implementations are expected to be idempotent: revoking an already-revoked
 * certificate must succeed without creating duplicate CRL entries.
 */
export interface CrlRevocationSync {
  revokeCertificate(
    certificateId: string,
    issuerId: string,
    reason?: string,
    revokedAt?: Date,
  ): Promise<void>;
}

@Injectable()
export class CertificateRevocationService {
  private readonly logger = new Logger(CertificateRevocationService.name);

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    @InjectRepository(Issuer)
    private readonly issuerRepository: Repository<Issuer>,
    private readonly webhooksService: WebhooksService,
    @Optional()
    private readonly crlRevocationSync?: CrlRevocationSync,
  ) {}

  /**
   * Maximum byte length of a certificate ID that can be safely included in a
   * CRL Merkle tree leaf. The on-chain `build_merkle_root` uses a fixed
   * 256-byte stack buffer, so over-long IDs would panic and permanently block
   * all further revocations for the issuer. Reject them at this boundary.
   */
  static readonly MAX_CERTIFICATE_ID_BYTES = 256;

  private assertRevocableId(id: string): void {
    if (typeof id !== 'string' || id.length === 0) {
      throw new BadRequestException('Certificate ID must be a non-empty string');
    }

    const byteLength = Buffer.byteLength(id, 'utf8');
    if (byteLength > CertificateRevocationService.MAX_CERTIFICATE_ID_BYTES) {
      throw new BadRequestException(
        `Certificate ID exceeds maximum length of ${CertificateRevocationService.MAX_CERTIFICATE_ID_BYTES} bytes (got ${byteLength})`,
      );
    }
  }

  async revoke(id: string, reason?: string): Promise<Certificate> {
    this.assertRevocableId(id);

    const certificate = await this.certificateRepository.findOne({
      where: { id },
    });

    if (!certificate) {
      throw new ConflictException(`Certificate with ID ${id} not found`);
    }

    if (certificate.status !== CertificateStatus.ACTIVE) {
      throw new ConflictException(
        `Certificate must be active to revoke. Current status: ${certificate.status}`,
      );
    }

    const revokedAt = new Date();

    // Synchronize the CRL first so a certificate can never be revoked in the
    // main contract while still passing CRL checks. The CRL write is
    // idempotent, so re-revoking an already-revoked certificate is safe.
    if (this.crlRevocationSync) {
      await this.crlRevocationSync.revokeCertificate(
        certificate.id,
        certificate.issuerId,
        reason,
        revokedAt,
      );
    } else {
      this.logger.warn(
        `CRL revocation sync is not configured; certificate ${id} was revoked in the main contract only`,
      );
    }

    certificate.status = CertificateStatus.REVOKED;
    certificate.metadata = {
      ...certificate.metadata,
      ...(reason ? { revocationReason: reason } : {}),
      revokedAt,
    };

    const savedCertificate = await this.certificateRepository.save(certificate);

    await this.certificateIndexService.removeCertId(
      savedCertificate.issuerId,
      savedCertificate.id,
    );

    this.logger.log(`Certificate revoked: ${id} with reason: ${reason}`);

    // Trigger webhook event
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_REVOKED,
      savedCertificate.issuerId,
      {
        id: savedCertificate.id,
        status: savedCertificate.status,
        revocationReason: reason,
        revokedAt,
      },
    );

    // Trigger CRL revocation added event so the backend webhook system and
    // off-chain indexers can detect CRL changes.
    await this.webhooksService.triggerEvent(
      WebhookEvent.CRL_REVOCATION_ADDED,
      savedCertificate.issuerId,
      {
        id: savedCertificate.id,
        status: savedCertificate.status,
        revocationReason: reason,
        revokedAt,
      },
    );

    return savedCertificate;
  }

  async freeze(
    id: string,
    reason?: string,
    durationDays?: number,
  ): Promise<Certificate> {
    const certificate = await this.certificateRepository.findOne({
      where: { id },
    });

    if (!certificate) {
      throw new ConflictException(`Certificate with ID ${id} not found`);
    }

    if (certificate.status !== CertificateStatus.ACTIVE) {
      throw new ConflictException(
        `Certificate must be active to freeze. Current status: ${certificate.status}`,
      );
    }

    const issuer = await this.issuerRepository.findOne({
      where: { id: certificate.issuerId },
    });

    if (!issuer || !issuer.isAuthorized) {
      throw new ConflictException(
        `Issuer ${certificate.issuerId} is not authorized to freeze certificates`,
      );
    }

    const frozenAt = new Date();
    const normalizedDurationDays =
      typeof durationDays === 'number' && Number.isFinite(durationDays)
        ? Math.max(1, Math.trunc(durationDays))
        : undefined;
    const unfreezeAt = normalizedDurationDays
      ? new Date(
          frozenAt.getTime() + normalizedDurationDays * 24 * 60 * 60 * 1000,
        )
      : undefined;

    certificate.status = CertificateStatus.FROZEN;
    certificate.metadata = {
      ...certificate.metadata,
      ...(reason ? { freezeReason: reason } : {}),
      frozenAt,
      ...(normalizedDurationDays
        ? { freezeDurationDays: normalizedDurationDays }
        : {}),
      ...(unfreezeAt ? { unfreezeAt } : {}),
    };

    const savedCertificate = await this.certificateRepository.save(certificate);

    this.logger.log(`Certificate frozen: ${id} with reason: ${reason}`);

    // Trigger webhook event
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_REVOKED, // Using existing revoked event, could add new freeze event
      savedCertificate.issuerId,
      {
        id: savedCertificate.id,
        status: savedCertificate.status,
        ...(reason ? { freezeReason: reason } : {}),
        frozenAt,
        ...(normalizedDurationDays
          ? { freezeDurationDays: normalizedDurationDays }
          : {}),
        ...(unfreezeAt ? { unfreezeAt } : {}),
      },
    );

    return savedCertificate;
  }

  async unfreeze(id: string, reason?: string): Promise<Certificate> {
    const certificate = await this.certificateRepository.findOne({
      where: { id },
    });

    if (!certificate) {
      throw new ConflictException(`Certificate with ID ${id} not found`);
    }

    if (certificate.status !== CertificateStatus.FROZEN) {
      throw new ConflictException(
        `Certificate must be frozen to unfreeze. Current status: ${certificate.status}`,
      );
    }

    certificate.status = CertificateStatus.ACTIVE;
    if (reason) {
      certificate.metadata = {
        ...certificate.metadata,
        unfreezeReason: reason,
        unfrozenAt: new Date(),
      };
    }

    const savedCertificate = await this.certificateRepository.save(certificate);

    this.logger.log(`Certificate unfrozen: ${id} with reason: ${reason}`);

    // Trigger webhook event
    await this.webhooksService.triggerEvent(
      WebhookEvent.CERTIFICATE_ISSUED, // Using existing issued event, could add new unfreeze event
      savedCertificate.issuerId,
      {
        id: savedCertificate.id,
        status: savedCertificate.status,
        unfreezeReason: reason,
        unfrozenAt: new Date(),
      },
    );

    return savedCertificate;
  }

  async bulkRevoke(
    certificateIds: string[],
    reason?: string,
    issuerId?: string,
    userRole?: string,
  ): Promise<{
    revoked: Certificate[];
    failed: { id: string; error: string }[];
  }> {
    const revoked: Certificate[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const id of certificateIds) {
      try {
        this.assertRevocableId(id);

        const certificate = await this.certificateRepository.findOne({
          where: { id },
        });

        if (!certificate) {
          throw new ConflictException(`Certificate with ID ${id} not found`);
        }

        if (userRole !== UserRole.ADMIN) {
          if (!issuerId) {
            failed.push({
              id,
              error: 'Issuer identity is required to revoke certificate',
            });
            continue;
          }

          if (certificate.issuerId !== issuerId) {
            failed.push({
              id,
              error:
                'Unauthorized to revoke certificate issued by another issuer',
            });
            continue;
          }
        }

        const revokedCertificate = await this.revoke(id, reason);
        revoked.push(revokedCertificate);
      } catch (error) {
        failed.push({
          id,
          error: error.message || 'Failed to revoke certificate',
        });
      }
    }

    this.logger.log(
      `Bulk revoke completed: ${revoked.length} revoked, ${failed.length} failed`,
    );

    return { revoked, failed };
  }
}
