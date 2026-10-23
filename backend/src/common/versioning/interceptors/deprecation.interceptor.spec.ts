import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { DeprecationInterceptor } from './deprecation.interceptor';
import { ApiVersion } from '../version.enum';

describe('DeprecationInterceptor', () => {
  let interceptor: DeprecationInterceptor;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeprecationInterceptor,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    interceptor = module.get<DeprecationInterceptor>(DeprecationInterceptor);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should not add headers when endpoint is not deprecated', (done) => {
    const mockResponse = {
      setHeader: jest.fn(),
    };

    const mockContext = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;

    const mockCallHandler: CallHandler = {
      handle: () => of('test'),
    };

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);

    interceptor.intercept(mockContext, mockCallHandler).subscribe(() => {
      expect(mockResponse.setHeader).not.toHaveBeenCalled();
      done();
    });
  });

  it('should add deprecation headers when endpoint is deprecated', (done) => {
    const mockResponse = {
      setHeader: jest.fn(),
    };

    const mockContext = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;

    const mockCallHandler: CallHandler = {
      handle: () => of('test'),
    };

    const deprecationMetadata = {
      since: ApiVersion.V1,
      sunsetDate: '2025-12-31',
      alternativeEndpoint: '/api/v2/endpoint',
    };

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(deprecationMetadata);

    interceptor.intercept(mockContext, mockCallHandler).subscribe(() => {
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Deprecation',
        'true',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-API-Deprecated-Since',
        ApiVersion.V1,
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Sunset',
        '2025-12-31',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Link',
        '</api/v2/endpoint>; rel="alternate"',
      );
      done();
    });
  });

  it('should add deprecation headers without optional fields', (done) => {
    const mockResponse = {
      setHeader: jest.fn(),
    };

    const mockContext = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;

    const mockCallHandler: CallHandler = {
      handle: () => of('test'),
    };

    const deprecationMetadata = {
      since: ApiVersion.V1,
    };

    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(deprecationMetadata);

    interceptor.intercept(mockContext, mockCallHandler).subscribe(() => {
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Deprecation',
        'true',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-API-Deprecated-Since',
        ApiVersion.V1,
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'X-API-Deprecation-Info',
        'This endpoint is deprecated. Please check the documentation for alternatives.',
      );
      done();
    });
  });
});
