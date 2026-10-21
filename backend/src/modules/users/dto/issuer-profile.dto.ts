import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class IssuerProfileStatsDto {
  @ApiProperty({
    description: 'Total number of certificates issued',
    example: 125,
  })
  totalCertificates: number;

  @ApiProperty({
    description: 'Active certificates count',
    example: 118,
  })
  activeCertificates: number;

  @ApiProperty({
    description: 'Revoked certificates count',
    example: 7,
  })
  revokedCertificates: number;

  @ApiProperty({
    description: 'Expired certificates count',
    example: 0,
  })
  expiredCertificates: number;

  @ApiProperty({
    description: 'Total verifications performed',
    example: 2847,
  })
  totalVerifications: number;

  @ApiPropertyOptional({
    description: 'Last login timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  lastLogin?: Date;
}

export class IssuerActivityItemDto {
  @ApiProperty({
    description: 'Activity ID',
    example: 'uuid-123',
  })
  id: string;

  @ApiProperty({
    description: 'Activity type',
    enum: [
      'ISSUE_CERTIFICATE',
      'REVOKE_CERTIFICATE',
      'VERIFY_CERTIFICATE',
      'UPDATE_PROFILE',
      'LOGIN',
    ],
  })
  @IsEnum([
    'ISSUE_CERTIFICATE',
    'REVOKE_CERTIFICATE',
    'VERIFY_CERTIFICATE',
    'UPDATE_PROFILE',
    'LOGIN',
  ])
  action: string;

  @ApiProperty({
    description: 'Activity description',
    example: 'Issued certificate to Alice Johnson',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'IP address where action occurred',
    example: '192.168.1.100',
  })
  @IsString()
  ipAddress: string;

  @ApiProperty({
    description: 'User agent/browser information',
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  })
  @IsString()
  userAgent: string;

  @ApiProperty({
    description: 'Activity timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  @IsDateString()
  timestamp: Date;
}

export class IssuerActivityResponseDto {
  @ApiProperty({
    description: 'List of recent activities',
    type: [IssuerActivityItemDto],
  })
  activities: IssuerActivityItemDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    example: {
      total: 50,
      page: 1,
      limit: 10,
      totalPages: 5,
    },
  })
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export class UpdateIssuerProfileDto {
  @ApiPropertyOptional({
    description: 'First name',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({
    description: 'Last name',
    example: 'Doe',
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    description: 'Username',
    example: 'johndoe',
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({
    description: 'Phone number',
    example: '+1234567890',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Profile picture URL',
    example: 'https://example.com/profile.jpg',
  })
  @IsOptional()
  @IsString()
  profilePicture?: string;

  @ApiPropertyOptional({
    description: 'Stellar public key',
    example: 'GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsOptional()
  @IsString()
  stellarPublicKey?: string;

  @ApiPropertyOptional({
    description: 'Organization name',
    example: 'StellarCert Academy',
  })
  @IsOptional()
  @IsString()
  organization?: string;
}
