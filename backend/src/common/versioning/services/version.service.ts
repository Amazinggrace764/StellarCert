import { Injectable } from '@nestjs/common';
import {
  ApiVersion,
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
  DEPRECATED_VERSIONS,
} from '../version.enum';
import {
  ApiVersionsResponseDto,
  MigrationGuideDto,
  VersionInfoDto,
} from '../dto/version-info.dto';

@Injectable()
export class VersionService {
  /**
   * Get information about all API versions
   */
  getVersionInfo(): ApiVersionsResponseDto {
    const versions: VersionInfoDto[] = SUPPORTED_VERSIONS.map((version) => ({
      version,
      deprecated: DEPRECATED_VERSIONS.includes(version),
      sunsetDate: this.getSunsetDate(version),
      recommendedVersion: DEPRECATED_VERSIONS.includes(version)
        ? CURRENT_VERSION
        : undefined,
    }));

    return {
      currentVersion: CURRENT_VERSION,
      supportedVersions: SUPPORTED_VERSIONS,
      versions,
    };
  }

  /**
   * Get migration guide between two versions
   */
  getMigrationGuide(
    fromVersion: ApiVersion,
    toVersion: ApiVersion,
  ): MigrationGuideDto {
    // This is a placeholder implementation
    // In a real application, you would store migration guides in a database or configuration
    const guides: Record<string, MigrationGuideDto> = {
      '1-2': {
        fromVersion: ApiVersion.V1,
        toVersion: ApiVersion.V2,
        breakingChanges: [
          'Authentication endpoints now require API key in addition to JWT',
          'Certificate response format changed to include additional metadata',
          'Date fields now use ISO 8601 format instead of Unix timestamps',
        ],
        newFeatures: [
          'Batch certificate operations',
          'Enhanced search capabilities with filters',
          'Webhook support for certificate events',
          'Rate limiting headers in responses',
        ],
        migrationSteps: [
          'Update authentication to include API key header',
          'Update date parsing to handle ISO 8601 format',
          'Review and update certificate response handling',
          'Test all endpoints with new response format',
          'Update error handling for new error codes',
        ],
      },
    };

    const key = `${fromVersion}-${toVersion}`;
    return (
      guides[key] || {
        fromVersion,
        toVersion,
        breakingChanges: [],
        newFeatures: [],
        migrationSteps: ['No migration guide available for this version pair'],
      }
    );
  }

  /**
   * Check if a version is supported
   */
  isVersionSupported(version: string): boolean {
    return SUPPORTED_VERSIONS.includes(version as ApiVersion);
  }

  /**
   * Check if a version is deprecated
   */
  isVersionDeprecated(version: string): boolean {
    return DEPRECATED_VERSIONS.includes(version as ApiVersion);
  }

  /**
   * Get sunset date for a deprecated version
   */
  private getSunsetDate(version: ApiVersion): string | undefined {
    // This would typically come from configuration
    const sunsetDates: Partial<Record<ApiVersion, string>> = {
      // Example: [ApiVersion.V1]: '2025-12-31',
    };

    return sunsetDates[version];
  }
}
