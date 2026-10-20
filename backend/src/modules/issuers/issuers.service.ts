import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Issuer } from './entities/issuer.entity';
import { CreateIssuerDto } from './dto/create-issuer.dto';
import { isValidStellarPublicKey } from './utils/stellar';
import { IssuerPaginationQueryDto, IPaginatedResult } from './dto/pagination.dto';
import { IssuerTier } from '../../common/rate-limiting/rate-limit.types';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const ALLOWED_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'stellarPublicKey',
  'tier',
  'certificateCount',
];

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
    const page = this.normalizePositiveInteger(query.page, DEFAULT_PAGE);
    const limit = Math.min(
      this.normalizePositiveInteger(query.limit, DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const sortBy = query.sortBy && ALLOWED_SORT_FIELDS.includes(query.sortBy) ? query.sortBy : 'createdAt';
    const sortOrder = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    const skip = (page - 1) * limit;

    const queryBuilder = this.issuerRepo.createQueryBuilder('Issuer');

    if (query.isActive !== undefined) {
      queryBuilder.andWhere('issuer.isActive = :isActive', { isActive: query.isActive });
    }

    if (query.search) {
      queryBuilder.andWhere(
        '(issuer.name ILIKE :search OR issuer.stellarPublicKey ILIKE :search)',
        { search: `%${query.search}%%` },
      );
    }

    if (query.tier) {
      queryBuilder.andWhere('issuer.tier = :tier', { tier: query.tier as IssuerTier });
    }

    queryBuilder.orderBy(`issuer.${sortBy}`, sortOrder);

    const [data, total] = await queryBuilder
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

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

  async incrementCertificateCount(issuerId: string) {
    await this.issuerRepo.increment({ id: issuerId }, 'certificateCount', 1);
  }

  private normalizePositiveInteger(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      return fallback;
    }
    return parsed;
  }
}
