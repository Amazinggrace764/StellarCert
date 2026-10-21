import { ApiProperty } from '@nestjs/swagger';

export class VersionInfoDto {
  @ApiProperty({ example: '1', description: 'API version number' })
  version: string;

  @ApiProperty({
    example: false,
    description: 'Whether this version is deprecated',
  })
  deprecated: boolean;

  @ApiProperty({
    example: '2024-12-31',
    required: false,
    description: 'Sunset date for deprecated versions',
  })
  sunsetDate?: string;

  @ApiProperty({
    example: 'v2',
    required: false,
    description: 'Recommended version to migrate to',
  })
  recommendedVersion?: string;
}

export class ApiVersionsResponseDto {
  @ApiProperty({ example: '1', description: 'Current API version' })
  currentVersion: string;

  @ApiProperty({
    type: [String],
    example: ['1', '2'],
    description: 'All supported versions',
  })
  supportedVersions: string[];

  @ApiProperty({
    type: [VersionInfoDto],
    description: 'Detailed version information',
  })
  versions: VersionInfoDto[];
}

export class MigrationGuideDto {
  @ApiProperty({ example: '1', description: 'Source version' })
  fromVersion: string;

  @ApiProperty({ example: '2', description: 'Target version' })
  toVersion: string;

  @ApiProperty({
    type: [String],
    description: 'Breaking changes in the new version',
  })
  breakingChanges: string[];

  @ApiProperty({
    type: [String],
    description: 'New features in the new version',
  })
  newFeatures: string[];

  @ApiProperty({ type: [String], description: 'Migration steps' })
  migrationSteps: string[];
}
