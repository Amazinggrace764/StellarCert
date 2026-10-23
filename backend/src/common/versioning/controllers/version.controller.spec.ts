import { Test, TestingModule } from '@nestjs/testing';
import { VersionController } from './version.controller';
import { VersionService } from '../services/version.service';
import { ApiVersion } from '../version.enum';

describe('VersionController', () => {
  let controller: VersionController;
  let service: VersionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VersionController],
      providers: [VersionService],
    }).compile();

    controller = module.get<VersionController>(VersionController);
    service = module.get<VersionService>(VersionService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getVersions', () => {
    it('should return version information', () => {
      const result = controller.getVersions();

      expect(result).toHaveProperty('currentVersion');
      expect(result).toHaveProperty('supportedVersions');
      expect(result).toHaveProperty('versions');
    });

    it('should call version service', () => {
      const spy = jest.spyOn(service, 'getVersionInfo');
      controller.getVersions();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('getMigrationGuide', () => {
    it('should return migration guide', () => {
      const result = controller.getMigrationGuide(ApiVersion.V1, ApiVersion.V2);

      expect(result).toHaveProperty('fromVersion');
      expect(result).toHaveProperty('toVersion');
      expect(result).toHaveProperty('breakingChanges');
      expect(result).toHaveProperty('newFeatures');
      expect(result).toHaveProperty('migrationSteps');
    });

    it('should call version service with correct parameters', () => {
      const spy = jest.spyOn(service, 'getMigrationGuide');
      controller.getMigrationGuide(ApiVersion.V1, ApiVersion.V2);

      expect(spy).toHaveBeenCalledWith(ApiVersion.V1, ApiVersion.V2);
    });
  });
});
