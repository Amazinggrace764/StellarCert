import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsString,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { UserRole, UserStatus } from '../entities/user.entity';

export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 10,
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class UserFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search term for email, first name, or last name',
    example: 'john',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by email',
    example: 'user@example.com',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    description: 'Filter by first name',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({
    description: 'Filter by last name',
    example: 'Doe',
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    description: 'Filter by user role',
    enum: UserRole,
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Filter by user status',
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by email verification status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isEmailVerified?: boolean;
}
