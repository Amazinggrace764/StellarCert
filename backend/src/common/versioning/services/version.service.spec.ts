import { Test, TestingModule } from '@nestjs/testing';
import { VersionService } from './version.service';
import {
  ApiVersion,
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
} from '../version.enum';

describe('VersionService', () => {
  let service: VersionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VersionService],
    }).compile();

    service = module.get<VersionService>(VersionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getVersionInfo', () => {
    it('should return current version and supported versions', () => {
      const result = service.getVersionInfo();

      expect(result).toHaveProperty('currentVersion');
      expect(result).toHaveProperty('supportedVersions');
      expect(result).toHaveProperty('versions');
      expect(result.currentVersion).toBe(CURRENT_VERSION);
      expect(result.supportedVersions).toEqual(SUPPORTED_VERSIONS);
    });

    it('should return version details for each supported version', () => {
      const result = service.getVersionInfo();

      expect(result.versions).toHaveLength(SUPPORTED_VERSIONS.length);
      result.versions.forEach((version) => {
        expect(version).toHaveProperty('version');
        expect(version).toHaveProperty('deprecated');
        expect(SUPPORTED_VERSIONS).toContain(version.version);
      });
    });
  });

  describe('getMigrationGuide', () => {
    it('should return migration guide for v1 to v2', () => {
      const result = service.getMigrationGuide(ApiVersion.V1, ApiVersion.V2);

      expect(result).toHaveProperty('fromVersion', ApiVersion.V1);
      expect(result).toHaveProperty('toVersion', ApiVersion.V2);
      expect(result).toHaveProperty('breakingChanges');
      expect(result).toHaveProperty('newFeatures');
      expect(result).toHaveProperty('migrationSteps');
      expect(Array.isArray(result.breakingChanges)).toBe(true);
      expect(Array.isArray(result.newFeatures)).toBe(true);
      expect(Array.isArray(result.migrationSteps)).toBe(true);
    });

    it('should return default guide for unknown version pairs', () => {
      const result = service.getMigrationGuide(ApiVersion.V2, ApiVersion.V1);

      expect(result.migrationSteps).toContain(
        'No migration guide available for this version pair',
      );
    });
  });

  describe('isVersionSupported', () => {
    it('should return true for supported versions', () => {
      SUPPORTED_VERSIONS.forEach((version) => {
        expect(service.isVersionSupported(version)).toBe(true);
      });
    });

    it('should return false for unsupported versions', () => {
      expect(service.isVersionSupported('999')).toBe(false);
      expect(service.isVersionSupported('invalid')).toBe(false);
    });
  });

  describe('isVersionDeprecated', () => {
    it('should return false for current version', () => {
      expect(service.isVersionDeprecated(CURRENT_VERSION)).toBe(false);
    });

    it('should return false for non-deprecated versions', () => {
      expect(service.isVersionDeprecated(ApiVersion.V1)).toBe(false);
    });
  });
});
