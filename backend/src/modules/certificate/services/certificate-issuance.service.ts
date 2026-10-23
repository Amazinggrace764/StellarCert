import { Injectable, ConflictException, Logger, NotFoundException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CreateCertificateDto } from '../dto/create-certificate.dto';
import { Certificate } from '../entities/certificate.entity';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { DuplicateDetectionConfig } from '../interfaces/duplicate-detection.interface';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { WebhookEvent } from '../../webhooks/entities/webhook-subscription.entity';
import { MetadataSchemaService } from '../../metadata-schema/services/metadata-schema.service';
import { CryptoUtils } from '../../../common/utils/crypto.utils';
import { SorobanService } from '../../stellar/services/soroban.service';

export interface SyncChainResult {
  id: string;
  alreadySynced: boolean;
  stellarTransactionHash: string | undefined;
}

@Injectable()
export class CertificateIssuanceService {
  private readonly logger = new Logger(CertificateIssuanceService.name);

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
    private readonly duplicateDetectionService: DuplicateDetectionService,
    private readonly webhooksService: WebhooksService,
    private readonly metadataSchemaService: MetadataSchemaService,
    private readonly dataSource: DataSource,
    private readonly sorobanService: SorobanService,
  ) {}

  async issue(
    createCertificateDto: CreateCertificateDto,
    duplicateConfig?: DuplicateDetectionConfig,
    overrideReason?: string,
  ): Promise<Certificate> {
    // Check for duplicates if config is provided
    if (duplicateConfig?.enabled) {
      const duplicateCheck =
        await this.duplicateDetectionService.checkForDuplicates(
          createCertificateDto,
          duplicateConfig,
        );

      if (duplicateCheck.isDuplicate) {
        if (duplicateCheck.action === 'block') {
          throw new ConflictException({
            message: 'Certificate issuance blocked due to potential duplicate',
            details: duplicateCheck,
          });
        } else if (duplicateCheck.action === 'warn' && !overrideReason) {
          throw new ConflictException({
            message:
              'Warning: Potential duplicate detected. Override reason required.',
            details: duplicateCheck,
            requiresOverride: true,
          });
        }
      }
    }

    if (
      createCertificateDto.metadataSchemaId &&
      createCertificateDto.metadata
    ) {
      const validationResult = await this.metadataSchemaService.validate(
        createCertificateDto.metadataSchemaId,
        createCertificateDto.metadata,
      );
      if (!validationResult.valid) {
        throw new ConflictException({
          message: 'Certificate metadata failed schema validation',
          errors: validationResult.errors,
          schemaId: validationResult.schemaId,
          schemaVersion: validationResult.schemaVersion,
        });
      }
    }

    // Validate any client-supplied expiry is in the future. This mirrors the
    // on-chain `set_certificate_expiry` guard so the DB and chain agree.
    if (createCertificateDto.expiresAt) {
      const expiryTime = new Date(createCertificateDto.expiresAt).getTime();
      if (Number.isNaN(expiryTime)) {
        throw new BadRequestException('expiresAt must be a valid date');
      }
      if (expiryTime <= Date.now()) {
        throw new BadRequestException(
          'expiresAt must be in the future',
        );
      }
    }

    // Create a QueryRunner for transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let savedCertificate: Certificate;

    try {
      const certificateId = await this.generateCertificateId();
      // Reject over-long IDs at the owning boundary so a bad ID—
      // whether supplied or generated— can never reach the CRL Merkle leaf
      // construction and cause a revocation DoS.
      this.assertCertificateIdFitsMerkleLeaf(certificateId);
      const verificationCode =
        createCertificateDto.verificationCode ||
        (await this.generateVerificationCode());
      const certificate = queryRunner.manager.create(Certificate, {
        ...createCertificateDto,
        certificateId,
        expiresAt:
          createCertificateDto.expiresAt || this.calculateDefaultExpiry(),
        verificationCode,
        isDuplicate: false,
      });

      savedCertificate = await queryRunner.manager.save(certificate);

      // If this was an override, mark it appropriately
      if (overrideReason) {
        savedCertificate.isDuplicate = true;
        savedCertificate.overrideReason = overrideReason;
        savedCertificate = await queryRunner.manager.save(savedCertificate);
      }

      // Attempt on-chain issuance BEFORE committing so a failure can
      // be rolled back and never leaves an orphaned record.
      if (this.sorobanService?.isConfigured()) {
        try {
          const txHash = await this.sorobanService.issueCertificate(
            savedCertificate.id,
            savedCertificate.issuerStellarAddress,
            savedCertificate.recipientStellarAddress,
            savedCertificate.verificationCode,
            Math.floor(new Date(savedCertificate.expiresAt).getTime() / 1000),
          );
          savedCertificate.stellarTransactionHash = txHash;
          savedCertificate = await queryRunner.manager.save(savedCertificate);
        } catch (chainError) {
          // Rollback the database record so no orphan remains.
          await queryRunner.rollbackTransaction();
          this.logger.error(
            `On-chain issuance failed for certificate ${savedCertificate.id}; DB colled back: ${chainError.message}`,
            chainError.stack,
          );
          throw new ServiceUnavailableException({
            message:
              'Failed to issue certificate on-chain; no certificate record was persisted',
            cause: chainError.message,
          });
        }
      }

      // Commit the transaction only after the on-chain call succeeds
      await queryRunner.commitTransaction();

      this.logger.log(
        `Certificate issued: ${savedCertificate.id} for ${createCertificateDto.recipientEmail}`,
      );

      // Trigger webhook event (outside transaction)
      await this.webhooksService.triggerEvent(
        WebhookEvent.CERTIFICATE_ISSUED,
        savedCertificate.issuerId,
        {
          id: savedCertificate.id,
          recipientEmail: savedCertificate.recipientEmail,
          recipientName: savedCertificate.recipientName,
          title: savedCertificate.title,
          issuedAt: savedCertificate.issuedAt,
          status: savedCertificate.status,
        },
      );

      return savedCertificate;
    } catch (error) {
      // Rollback transaction on error if it is still active
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error(
        `Failed to issue certificate: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      // Release the QueryRunner
      await queryRunner.release();
    }
  }

  /**
   * Re-attempt on-chain issuance for a certificate that is missing a
   * `stellarTransactionHash` (e.g. an orphaned record from a prior failure).
   */
  async syncChain(id: string): Promise<SyncChainResult> {
    const certificate = await this.certificateRepository.findOne({ where: { id } });
    if (!certificate) {
      throw new NotFoundException(`Certificate ${id} not found`);
    }

    if (certificate.stellarTransactionHash) {
      return {
        id,
        alreadySynced: true,
        stellarTransactionHash: certificate.stellarTransactionHash,
      };
    }

    if (!this.sorobanService?.isConfigured()) {
      throw new ServiceUnavailableException(
        'Soroban is not configured; cannot sync chain issuance',
      );
    }

    // Refuse to sync a certificate whose expiry has already passed; the
    // on-chain contract rejects past expiries and we want a clear error.
    const expiryTime = Math.floor(new Date(certificate.expiresAt).getTime() / 1000);
    if (!Number.isFinite(expiryTime) || expiryTime <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException(
        'Cannot sync chain issuance for a certificate with a past expiry',
      );
    }

    const txHash = await this.sorobanService.issueCertificate(
      certificate.id,
      certificate.issuerStellarAddress,
      certificate.recipientStellarAddress,
      certificate.verificationCode,
      expiryTime,
    );

    await this.certificateRepository.update(id, {
      stellarTransactionHash: txHash,
    });

    this.logger.log(`Synched certificate ${id} to chain ${txHash}`);

    return {
      id,
      alreadySynced: false,
      stellarTransactionHash: txHash,
    };
  }

  /**
   * Ensure a certificate ID fits into the fixed leaf buffer used by the
   * CRL Merkle root builder. IDs longer than the buffer would panic the
   * chain side and permanently block revocations for the issuer.
   */
  private assertCertificateIdFitsMerkleLeaf(certificateId: string): void {
    const byteLength = Buffer.byteLength(certificateId, 'utf-8');
    if (byteLength > MAX_CERTIFICATE_ID_BYTES) {
      this.logger.warn(
        `Rejecting certificate ID of ${byteLength} bytes (> ${MAX_CERTIFICATE_ID_BYTES})`,
      );
      throw new BadRequestException({
        message: `Certificate ID exceeds the maximum of ${MAX_CERTIFICATE_ID_BYTES} bytes`,
        certificateIdByteLength: byteLength,
        maxCertificateIdBytes: MAX_CERTIFICATE_ID_BYTES,
      });
    }
  }

  private calculateDefaultExpiry(): Date {
    // Use UTC to align with the backend's UTC-based validation and avoid
    // timezone-dependent expiry dates.
    const expiry = new Date();
    expiry.setUTCFullYear(expiry.getUTCFullYear() + 1); // Default 1 year expiry
    return expiry;
  }

  /**
   * Generates a cryptographically secure 8-character verification code
   * and retries on collision against the unique DB constraint.
   */
  private async generateVerificationCode(): Promise<string> {
    const maxRetries = 10;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const code = CryptoUtils.generateAlphanumericCode(8);
      const exists = await this.certificateRepository.findOne({
        where: { verificationCode: code },
        select: ['id'],
      });
      if (!exists) return code;
    }
    throw new ConflictException(
      'Failed to generate a unique verification code after multiple attempts',
    );
  }

  /**
   * Generates a cryptographically secure certificate ID (`CERT-<YEAR>-<8 chars>`)
   * and retries on collision against the unique DB constraint.
   */
  private async generateCertificateId(): Promise<string> {
    // Use the UTC вер so certificate IDs are stable across timezones.
    const year = new Date().getUTCFullYear();
    const maxRetries = 10;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const suffix = CryptoUtils.generateAlphanumericCode(8);
      const certificateId = `CERT-${year}-${suffix}`;
      const exists = await this.certificateRepository.findOne({
        where: { certificateId },
        select: ['id'],
      });
      if (!exists) return certificateId;
    }
    throw new ConflictException(
      'Failed to generate a unique certificate ID after multiple attempts',
    );
  }
}
