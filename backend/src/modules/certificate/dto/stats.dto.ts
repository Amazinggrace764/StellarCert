import { IsOptional, IsDateString, IsUUID } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class StatsQueryDto {
  @ApiPropertyOptional({
    description: 'Start date for filtering',
    example: '2026-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date for filtering',
    example: '2026-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by issuer ID',
    example: '5f1e8a8d-8f58-4c8b-88d4-5d0a8c9dbf2a',
  })
  @IsOptional()
  @IsUUID()
  issuerId?: string;
}

export class IssuanceTrendDto {
  @ApiProperty({
    description: 'Date for the issuance count',
    example: '2026-04-01',
  })
  date: string;

  @ApiProperty({
    description: 'Number of certificates issued on this date',
    example: 42,
  })
  count: number;
}

export class TopIssuerDto {
  @ApiProperty({
    description: 'Issuer UUID',
    example: '5f1e8a8d-8f58-4c8b-88d4-5d0a8c9dbf2a',
  })
  issuerId: string;

  @ApiProperty({
    description: 'Issuer display name',
    example: 'Stellar Academy',
  })
  issuerName: string;

  @ApiProperty({
    description: 'Number of certificates issued by this issuer',
    example: 320,
  })
  certificateCount: number;
}

export class VerificationStatsDto {
  @ApiProperty({
    description: 'Total verifications executed',
    example: 820,
  })
  totalVerifications: number;

  @ApiProperty({
    description: 'Successful verification count',
    example: 790,
  })
  successfulVerifications: number;

  @ApiProperty({
    description: 'Failed verification count',
    example: 30,
  })
  failedVerifications: number;

  @ApiProperty({
    description: 'Daily verification count',
    example: 120,
  })
  dailyVerifications: number;

  @ApiProperty({
    description: 'Weekly verification count',
    example: 560,
  })
  weeklyVerifications: number;
}

export class CertificateStatsDto {
  @ApiProperty({
    description: 'Total number of certificates',
    example: 1280,
  })
  totalCertificates: number;

  @ApiProperty({
    description: 'Number of active certificates',
    example: 1024,
  })
  activeCertificates: number;

  @ApiProperty({
    description: 'Number of revoked certificates',
    example: 128,
  })
  revokedCertificates: number;

  @ApiProperty({
    description: 'Number of expired certificates',
    example: 128,
  })
  expiredCertificates: number;

  @ApiProperty({
    description: 'Trend of certificate issuance over time',
    type: [IssuanceTrendDto],
  })
  issuanceTrend: IssuanceTrendDto[];

  @ApiProperty({
    description: 'Top certificate issuers by volume',
    type: [TopIssuerDto],
  })
  topIssuers: TopIssuerDto[];

  @ApiProperty({
    description: 'Verification statistics summary',
    type: VerificationStatsDto,
  })
  verificationStats: VerificationStatsDto;
}
