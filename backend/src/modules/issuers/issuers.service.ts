import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, ILike } from 'typeorm';
import { Issuer } from './entities/issuer.entity';
import { CreateIssuerDto } from './dto/create-issuer.dto';
import { isValidStellarPublicKey } from './utils/stellar';
import { IssuerPaginationQueryDto, IPaginatedResult } from './dto/pagination.dto';
import { IssuerTier } from '../../common/rate-limiting/rate-limit.types';

@Injectable()
export class IssuersService {
  constructor(
    @InjectRepository(Issuer)
    private readonly issuerRepo: Repository<Issuer>,
  ) {}

  async createIssuer(dto: CreateIssuerDto) {
    if (!isValidStellarPublicKey(dto.stellarPublicKey)) {
      throw new BadRequestException('Invalid Stellar public key');
    }
    const issuer = this.issuerRepo.create(dto);
    return this.issuerRepo.save(issuer);
  }

  async removeIssuer(id: string) {
    const issuer = await this.issuerRepo.findOne({ where: { id } });
    if (!issuer) throw new NotFoundException('Issuer not found');
    return this.issuerRepo.remove(issuer);
  }

  async listIssuers(query: IssuerPaginationQueryDto): Promise<IPaginatedResult<Issuer>> {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'DESC', isActive, search, tier } = query;
    const skip = (page - 1) * limit;

    const queryBuilder = this.issuerRepo.createQueryBuilder('issuer');

    if (isActive !== undefined) {
      queryBuilder.andWhere('issuer.isActive = :isActive', { isActive });
    }

    if (search) {
      queryBuilder.andWhere(
        '(issuer.name ILIKE :search OR issuer.stellarPublicKey ILIKE :search)',
        { search: `%${search}%%` },
      );
    }

    if (tier) {
      queryBuilder.andWhere('issuer.tier = :tier', { tier: tier as IssuerTier });
    }

    const allowedSortFields = ['createdAt', 'updatedAt', 'name', 'stellarPublicKey', 'tier', 'certificateCount'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    queryBuilder.orderBy(`issuer.${sortField}`, sortOrder);

    const [data, total] = await queryBuilder
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Increment the issuer's certificate counter.
   *
   * Accepts an optional TypeORM EntityManager so the increment can participate
   * in a transaction owned by the caller (e.g. the certificate issuance flow).
   * When no manager is provided, the default repository connection is used.
   */
  async incrementCertificateCount(
    issuerId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(Issuer)
      : this.issuerRepo;
    await repo.increment({ id: issuerId }, 'certificateCount', 1);
  }
}
