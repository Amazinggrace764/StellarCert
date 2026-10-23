import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Certificate } from '../entities/certificate.entity';

export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

@Injectable()
export class CertificateSearchService {
  private readonly logger = new Logger(CertificateSearchService.name);

  constructor(
    @InjectRepository(Certificate)
    private readonly certificateRepository: Repository<Certificate>,
  ) {}

  async findAll(
    page = 1,
    limit = 10,
    issuerId?: string,
    status?: string,
  ): Promise<{ certificates: Certificate[]; total: number }> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .orderBy('certificate.issuedAt', 'DESC');

    if (issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', { issuerId });
    }

    if (status) {
      queryBuilder.andWhere('certificate.status = :status', { status });
    }

    const total = await queryBuilder.getCount();
    const certificates = await queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // Bump TTL for the certificates surfaced by this paginated read path.
    await this.bumpCertificateTtlsBulk(
      certificates.map((certificate) => certificate.id),
    );

    return { certificates, total };
  }

  async findOne(id: string): Promise<Certificate> {
    const certificate = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.id = :id', { id })
      .getOne();

    if (!certificate) {
      throw new NotFoundException(`Certificate with ID ${id} not found`);
    }

    // Bump TTL on read so hot entries are not archived/evicted while still valid.
    await this.bumpCertificateTtl(id);

    return certificate;
  }

  /**
   * Maintenance entry point to extend the storage TTL of a certificate entry.
   *
   * Certificates are stored as persistent entries whose TTL is otherwise only
   * refreshed on write. Read paths call this to keep hot entries alive, and it
   * can also be invoked manually (e.g. after restoring an archived entry) to
   * re-establish a fresh TTL window.
   */
  async bumpCertificateTtl(id: string): Promise<void> {
    await this.bumpCertificateTtlsBulk([id]);
  }

  /**
   * Bulk TTL bump for a set of certificate ids. Best-effort: never fail a read
   * because of a TTL refresh failure.
   */
  private async bumpCertificateTtlsBulk(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    try {
      await this.certificateRepository
        .createQueryBuilder()
        .update(Certificate)
        .set({ updatedAt: () => 'CURRENT_TIMESTAMP' })
        .whereInIds(ids)
        .execute();
    } catch (error) {
      // TTL bumping is best-effort; never fail a read because of it.
      this.logger.warn(
        `Failed to bump TTL for ${ids.length} certificate entries: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Periodic maintenance: refresh TTL for all non-expired certificates so that
   * entries which are valid for years are not silently archived from storage.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async refreshCertificateTtls(): Promise<void> {
    const result = await this.certificateRepository
      .createQueryBuilder()
      .update(Certificate)
      .set({ updatedAt: () => 'CURRENT_TIMESTAMP' })
      .where('status != :status', { status: 'expired' })
      .execute();

    this.logger.log(
      `Refreshed TTL for ${result.affected ?? 0} certificate entries`,
    );
  }

  async getCertificatesByRecipient(email: string): Promise<Certificate[]> {
    const certificates = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.recipientEmail = :email', { email })
      .orderBy('certificate.issuedAt', 'DESC')
      .getMany();

    await this.bumpCertificateTtlsBulk(
      certificates.map((certificate) => certificate.id),
    );

    return certificates;
  }

  async getCertificatesByIssuer(issuerId: string): Promise<Certificate[]> {
    const certificates = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.issuerId = :issuerId', { issuerId })
      .orderBy('certificate.issuedAt', 'DESC')
      .getMany();

    await this.bumpCertificateTtlsBulk(
      certificates.map((certificate) => certificate.id),
    );

    return certificates;
  }

  async getDuplicateCertificates(): Promise<Certificate[]> {
    const certificates = await this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .where('certificate.isDuplicate = :isDuplicate', { isDuplicate: true })
      .orderBy('certificate.issuedAt', 'DESC')
      .getMany();

    await this.bumpCertificateTtlsBulk(
      certificates.map((certificate) => certificate.id),
    );

    return certificates;
  }

  async exportCertificates(
    issuerId?: string,
    status?: string,
  ): Promise<Certificate[]> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer')
      .orderBy('certificate.issuedAt', 'DESC');

    if (issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', { issuerId });
    }

    if (status) {
      queryBuilder.andWhere('certificate.status = :status', { status });
    }

    const certificates = await queryBuilder.take(1000).getMany();

    await this.bumpCertificateTtlsBulk(
      certificates.map((certificate) => certificate.id),
    );

    return certificates;
  }

  async search(
    query: string,
    filters?: {
      issuerId?: string;
      status?: string;
      recipientEmail?: string;
    },
  ): Promise<Certificate[]> {
    const queryBuilder = this.certificateRepository
      .createQueryBuilder('certificate')
      .leftJoinAndSelect('certificate.issuer', 'issuer');

    // Text search across multiple fields (case-insensitive, wildcards in term escaped)
    if (query) {
      const escapedPattern = `%\\${escapeLikePattern(query)}%%`;
      queryBuilder.andWhere(
        "(certificate.title ILIKE :query ESCAPE '\\\\' OR certificate.recipientName ILIKE :query ESCAPE '\\\\' OR certificate.recipientEmail ILIKE :query ESCAPE '\\\\')",
        { query: escapedPattern },
      );
    }

    // Apply filters
    if (filters?.issuerId) {
      queryBuilder.andWhere('certificate.issuerId = :issuerId', {
        issuerId: filters.issuerId,
      });
    }

    if (filters?.status) {
      queryBuilder.andWhere('certificate.status = :status', {
        status: filters.status,
      });
    }

    if (filters?.recipientEmail) {
      queryBuilder.andWhere('certificate.recipientEmail = :recipientEmail', {
        recipientEmail: filters.recipientEmail,
      });
    }

    const certificates = await queryBuilder
      .orderBy('certificate.issuedAt', 'DESC')
      .getMany();

    // Bump TTL for the certificates surfaced by this read path.
    await this.bumpCertificateTtlsBulk(
      certificates.map((certificate) => certificate.id),
    );

    return certificates;
  }
}
