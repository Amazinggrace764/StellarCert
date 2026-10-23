import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MetadataSchemaService } from './metadata-schema.service';
import { MetadataSchema, FieldType } from '../entities/metadata-schema.entity';
import { CreateMetadataSchemaDto } from '../dto/metadata-schema.dto';
import { LoggingService } from '../../../common/logging/logging.service';

describe('MetadataSchemaService', () => {
  let service: MetadataSchemaService;
  let repository: Repository<MetadataSchema>;

  const baseSchemaDto: CreateMetadataSchemaDto = {
    name: 'course-certificate',
    description: 'Schema for course completion certificates',
    version: '1.0.0',
    fields: [
      {
        name: 'courseName',
        type: FieldType.STRING,
        required: true,
        minLength: 1,
        maxLength: 200,
      },
      {
        name: 'grade',
        type: FieldType.STRING,
        required: false,
        enumValues: ['A', 'B', 'C', 'D', 'F'],
      },
      { name: 'completionDate', type: FieldType.DATE, required: true },
      {
        name: 'score',
        type: FieldType.NUMBER,
        required: false,
        min: 0,
        max: 100,
      },
      { name: 'passed', type: FieldType.BOOLEAN, required: true },
      { name: 'instructorEmail', type: FieldType.EMAIL, required: false },
      { name: 'courseUrl', type: FieldType.URL, required: false },
    ],
    requiredFields: ['courseName', 'completionDate', 'passed'],
    allowCustomFields: true,
  };

  const savedSchema: MetadataSchema = {
    id: 'schema-uuid-1',
    name: baseSchemaDto.name,
    description: (baseSchemaDto.description as string) || null,
    version: baseSchemaDto.version,
    fields: baseSchemaDto.fields,
    requiredFields: (baseSchemaDto.requiredFields as string[]) || null,
    allowCustomFields: true,
    issuerId: null,
    isActive: true,
    previousVersionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRepository = {
    create: jest
      .fn()
      .mockImplementation((dto) => ({ ...dto, id: 'schema-uuid-1' })),
    save: jest
      .fn()
      .mockImplementation((entity) =>
        Promise.resolve({ ...savedSchema, ...entity }),
      ),
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetadataSchemaService,
        {
          provide: getRepositoryToken(MetadataSchema),
          useValue: mockRepository,
        },
        {
          provide: LoggingService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MetadataSchemaService>(MetadataSchemaService);
    repository = module.get<Repository<MetadataSchema>>(
      getRepositoryToken(MetadataSchema),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new schema', async () => {
      mockRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      const result = await service.create(baseSchemaDto);
      expect(result.name).toBe(baseSchemaDto.name);
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should reject duplicate name+version', async () => {
      mockRepository.findOne.mockResolvedValueOnce(savedSchema);
      await expect(service.create(baseSchemaDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findOne', () => {
    it('should return a schema by id', async () => {
      mockRepository.findOne.mockResolvedValue(savedSchema);
      const result = await service.findOne('schema-uuid-1');
      expect(result.id).toBe('schema-uuid-1');
    });

    it('should throw NotFoundException for missing schema', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update mutable fields without changing version', async () => {
      mockRepository.findOne.mockResolvedValueOnce(savedSchema);
      const result = await service.update('schema-uuid-1', {
        description: 'Updated description',
      });
      expect(result.description).toBe('Updated description');
      expect(result.version).toBe(savedSchema.version);
    });

    it('should reject mutating the version', async () => {
      mockRepository.findOne.mockResolvedValueOnce(savedSchema);
      await expect(
        service.update('schema-uuid-1', { version: '2.0.0' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should allow setting the same version value', async () => {
      mockRepository.findOne.mockResolvedValueOnce(savedSchema);
      const result = await service.update('schema-uuid-1', {
        version: savedSchema.version,
        description: 'Same version',
      });
      expect(result.version).toBe(savedSchema.version);
    });

    it('should reject renaming to a colliding name+version', async () => {
      const conflictingSchema = {
        ...savedSchema,
        id: 'schema-uuid-2',
        name: 'other-schema',
      };
      mockRepository.findOne
        .mockResolvedValueOnce(savedSchema)
        .mockResolvedValueOnce(conflictingSchema);

      await expect(
        service.update('schema-uuid-1', { name: 'other-schema' }),
      ).rejects.toThrow(ConflictException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should allow renaming when no conflict exists', async () => {
      mockRepository.findOne
        .mockResolvedValueOnce(savedSchema)
        .mockResolvedValueOnce(null);

      const result = await service.update('schema-uuid-1', {
        name: 'renamed-schema',
      });
      expect(result.name).toBe('renamed-schema');
      expect(result.version).toBe(savedSchema.version);
    });

    it('should throw NotFoundException when schema does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      await expect(
        service.update('missing', { description: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('upgradeSchema', () => {
    it('should reject downgrade', async () => {
      // upgradeSchema resolves the current schema via findLatestByName (findOne)
      mockRepository.findOne.mockResolvedValueOnce(savedSchema);

      const downgradeDto = { ...baseSchemaDto, version: '0.9.0' };
      await expect(
        service.upgradeSchema('course-certificate', downgradeDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validate', () => {
    beforeEach(() => {
      mockRepository.findOne.mockResolvedValue(savedSchema);
    });

    it('should pass valid metadata', async () => {
      const metadata = {
        courseName: 'Stellar Smart Contracts',
        completionDate: '2026-02-20',
        passed: true,
        score: 95,
        grade: 'A',
      };

      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail on missing required fields', async () => {
      const metadata = { grade: 'A' };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      const requiredErrors = result.errors.filter(
        (e) => e.constraint === 'required',
      );
      expect(requiredErrors.length).toBe(3);
    });

    it('should fail on type mismatch - string expected', async () => {
      const metadata = {
        courseName: 123,
        completionDate: '2026-02-20',
        passed: true,
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'courseName' && e.constraint === 'type',
        ),
      ).toBe(true);
    });

    it('should fail on type mismatch - number expected', async () => {
      const metadata = {
        courseName: 'Course',
        completionDate: '2026-02-20',
        passed: true,
        score: 'not-a-number',
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'score' && e.constraint === 'type',
        ),
      ).toBe(true);
    });

    it('should fail on type mismatch - boolean expected', async () => {
      const metadata = {
        courseName: 'Course',
        completionDate: '2026-02-20',
        passed: 'yes',
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'passed' && e.constraint === 'type',
        ),
      ).toBe(true);
    });

    it('should fail on invalid enum value', async () => {
      const metadata = {
        courseName: 'Course',
        completionDate: '2026-02-20',
        passed: true,
        grade: 'S',
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'grade' && e.constraint === 'enum',
        ),
      ).toBe(true);
    });

    it('should fail on invalid date', async () => {
      const metadata = {
        courseName: 'Course',
        completionDate: 'not-a-date',
        passed: true,
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'completionDate' && e.constraint === 'type',
        ),
      ).toBe(true);
    });

    it('should fail on invalid email', async () => {
      const metadata = {
        courseName: 'Course',
        completionDate: '2026-02-20',
        passed: true,
        instructorEmail: 'not-an-email',
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === 'instructorEmail' && e.constraint === 'email',
        ),
      ).toBe(true);
    });

    it('should fail on invalid URL', async () => {
      const metadata = {
        courseName: 'Course',
        completionDate: '2026-02-20',
        passed: true,
        courseUrl: 'not-a-url',
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'courseUrl' && e.constraint === 'url',
        ),
      ).toBe(true);
    });

    it('should fail on number out of range - min', async () => {
      const metadata = {
        courseName: 'Course',
        completionDate: '2026-02-20',
        passed: true,
        score: -5,
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'score' && e.constraint === 'min',
        ),
      ).toBe(true);
    });

    it('should fail on number out of range - max', async () => {
      const metadata = {
        courseName: 'Course',
        completionDate: '2026-02-20',
        passed: true,
        score: 150,
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'score' && e.constraint === 'max',
        ),
      ).toBe(true);
    });

    it('should fail on string too short', async () => {
      const metadata = {
        courseName: '',
        completionDate: '2026-02-20',
        passed: true,
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'courseName' && e.constraint === 'minLength',
        ),
      ).toBe(true);
    });

    it('should allow custom fields when enabled', async () => {
      const metadata = {
        courseName: 'Course',
        completionDate: '2026-02-20',
        passed: true,
        customField: 'extra data',
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(true);
    });

    it('should reject custom fields when disabled', async () => {
      const strictSchema = { ...savedSchema, allowCustomFields: false };
      mockRepository.findOne.mockResolvedValue(strictSchema);

      const metadata = {
        courseName: 'Course',
        completionDate: '2026-02-20',
        passed: true,
        unauthorized: 'nope',
      };
      const result = await service.validate('schema-uuid-1', metadata);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.constraint === 'noCustomFields')).toBe(
        true,
      );
    });

    it('should fail on null metadata', async () => {
      const result = await service.validate('schema-uuid-1', null as any);
      expect(result.valid).toBe(false);
      expect(result.errors[0].constraint).toBe('type');
    });
  });

  describe('validateAgainstSchema - nested objects', () => {
    it('should validate nested object fields', () => {
      const nestedSchema: MetadataSchema = {
        ...savedSchema,
        fields: [
          {
            name: 'address',
            type: FieldType.OBJECT,
            required: true,
            properties: [
              { name: 'street', type: FieldType.STRING, required: true },
              { name: 'city', type: FieldType.STRING, required: true },
              {
                name: 'zip',
                type: FieldType.STRING,
                required: true,
              },
            ],
          },
        ],
      };

      const result = service.validateAgainstSchema(nestedSchema, {
        address: {
          street: '123 Main St',
          city: 'St. Louis',
          zip: '63101',
        },
      });
      expect(result.valid).toBe(true);
    });

    it('should fail on missing nested required field', () => {
      const nestedSchema: MetadataSchema = {
        ...savedSchema,
        fields: [
          {
            name: 'address',
            type: FieldType.OBJECT,
            required: true,
            properties: [
              { name: 'street', type: FieldType.STRING, required: true },
              { name: 'city', type: FieldType.STRING, required: true },
            ],
          },
        ],
      };

      const result = service.validateAgainstSchema(nestedSchema, {
        address: { street: '123 Main St' },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === 'address.city' && e.constraint === 'required',
        ),
      ).toBe(true);
    });
  });
});
