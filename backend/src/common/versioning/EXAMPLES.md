# API Versioning Examples

## Example 1: Creating a New Version

### Step 1: Update Version Enum

```typescript
// backend/src/common/versioning/version.enum.ts
export enum ApiVersion {
  V1 = '1',
  V2 = '2',
}

export const CURRENT_VERSION = ApiVersion.V2;
export const SUPPORTED_VERSIONS = [ApiVersion.V1, ApiVersion.V2];
export const DEPRECATED_VERSIONS: ApiVersion[] = [];
```

### Step 2: Create V2 Controller

```typescript
// backend/src/modules/auth/v2/auth-v2.controller.ts
import { Controller, Post, Body } from '@nestjs/common';

@Controller({ path: 'auth', version: '2' })
export class AuthV2Controller {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const result = await this.authService.login(loginDto);

    // V2 adds metadata
    return {
      ...result,
      metadata: {
        version: '2',
        timestamp: new Date().toISOString(),
      },
    };
  }
}
```

### Step 3: Register Controller

```typescript
// backend/src/modules/auth/auth.module.ts
import { AuthV2Controller } from './v2/auth-v2.controller';

@Module({
  controllers: [AuthController, AuthV1Controller, AuthV2Controller],
  // ...
})
export class AuthModule {}
```

## Example 2: Deprecating an Endpoint

### Mark V1 as Deprecated

```typescript
// backend/src/modules/auth/v1/auth-v1.controller.ts
import { Deprecated } from '@/common/versioning';
import { ApiVersion } from '@/common/versioning';

@Controller({ path: 'auth', version: '1' })
export class AuthV1Controller {
  @Post('login')
  @Deprecated(ApiVersion.V1, '2025-12-31', '/api/v2/auth/login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}
```

### Update Version Configuration

```typescript
// backend/src/common/versioning/version.enum.ts
export const CURRENT_VERSION = ApiVersion.V2;
export const SUPPORTED_VERSIONS = [ApiVersion.V1, ApiVersion.V2];
export const DEPRECATED_VERSIONS: ApiVersion[] = [ApiVersion.V1];
```

## Example 3: Client Migration

### Before (V1)

```typescript
// Client code using V1
const response = await fetch('http://localhost:3000/api/v1/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123',
  }),
});

const data = await response.json();
// V1 Response: { token: '...', user: {...} }
```

### After (V2)

```typescript
// Client code using V2
const response = await fetch('http://localhost:3000/api/v2/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123',
  }),
});

const data = await response.json();
// V2 Response: {
//   token: '...',
//   user: {...},
//   metadata: {
//     version: '2',
//     timestamp: '2024-01-01T00:00:00Z',
//     expiresIn: 3600
//   }
// }
```

## Example 4: Handling Deprecation Headers

### Client Code

```typescript
const response = await fetch('http://localhost:3000/api/v1/auth/login', {
  method: 'POST',
  // ...
});

// Check for deprecation
if (response.headers.get('Deprecation') === 'true') {
  const deprecatedSince = response.headers.get('X-API-Deprecated-Since');
  const sunsetDate = response.headers.get('Sunset');
  const alternativeUrl = response.headers.get('Link');

  console.warn(`
    API Deprecation Warning:
    - Deprecated since version: ${deprecatedSince}
    - Sunset date: ${sunsetDate}
    - Alternative: ${alternativeUrl}
  `);

  // Log to monitoring service
  logDeprecationWarning({
    endpoint: '/api/v1/auth/login',
    deprecatedSince,
    sunsetDate,
  });
}
```

## Example 5: Version-Specific Features

### V1: Basic Response

```typescript
@Controller({ path: 'certificates', version: '1' })
export class CertificatesV1Controller {
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return {
      id,
      name: 'Certificate',
      issuedAt: 1640995200, // Unix timestamp
    };
  }
}
```

### V2: Enhanced Response with ISO Dates

```typescript
@Controller({ path: 'certificates', version: '2' })
export class CertificatesV2Controller {
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return {
      id,
      name: 'Certificate',
      issuedAt: '2022-01-01T00:00:00Z', // ISO 8601
      metadata: {
        version: '2',
        format: 'iso8601',
      },
    };
  }
}
```

## Example 6: Testing Versioned Endpoints

### Unit Test

```typescript
describe('AuthV2Controller', () => {
  let controller: AuthV2Controller;
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthV2Controller],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthV2Controller>(AuthV2Controller);
    service = module.get<AuthService>(AuthService);
  });

  it('should return v2 response with metadata', async () => {
    const mockResult = { token: 'abc', user: {} };
    jest.spyOn(service, 'login').mockResolvedValue(mockResult);

    const result = await controller.login({
      email: 'test@example.com',
      password: 'pass',
    });

    expect(result).toHaveProperty('metadata');
    expect(result.metadata.version).toBe('2');
    expect(result.metadata).toHaveProperty('timestamp');
  });
});
```

### E2E Test

```typescript
describe('Versioned Auth Endpoints (e2e)', () => {
  it('should access v1 endpoint', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'pass' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('token');
        expect(res.body).not.toHaveProperty('metadata');
      });
  });

  it('should access v2 endpoint with metadata', () => {
    return request(app.getHttpServer())
      .post('/api/v2/auth/login')
      .send({ email: 'test@example.com', password: 'pass' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('token');
        expect(res.body).toHaveProperty('metadata');
        expect(res.body.metadata.version).toBe('2');
      });
  });

  it('should return deprecation headers for v1', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'pass' })
      .expect(200)
      .expect((res) => {
        expect(res.headers['deprecation']).toBe('true');
        expect(res.headers['x-api-deprecated-since']).toBeDefined();
      });
  });
});
```

## Example 7: Migration Guide Implementation

### Add Migration Guide

```typescript
// backend/src/common/versioning/services/version.service.ts
const guides: Record<string, MigrationGuideDto> = {
  '1-2': {
    fromVersion: ApiVersion.V1,
    toVersion: ApiVersion.V2,
    breakingChanges: [
      'Date fields changed from Unix timestamps to ISO 8601 format',
      'Response includes metadata object',
      'Error codes updated to use standard HTTP status codes',
    ],
    newFeatures: [
      'Metadata in all responses',
      'ISO 8601 date format',
      'Enhanced error messages',
      'Request tracing support',
    ],
    migrationSteps: [
      '1. Update date parsing: new Date(timestamp * 1000) -> new Date(isoString)',
      '2. Handle metadata object in responses',
      '3. Update error handling for new error codes',
      '4. Test all endpoints with new response format',
      '5. Update API documentation',
    ],
  },
};
```

### Access Migration Guide

```bash
curl http://localhost:3000/api/versions/migration-guide?from=1&to=2
```

## Example 8: Gradual Rollout Strategy

### Phase 1: Soft Launch (Week 1-2)

```typescript
// Enable V2 but keep V1 as default
export const CURRENT_VERSION = ApiVersion.V1;
export const SUPPORTED_VERSIONS = [ApiVersion.V1, ApiVersion.V2];
export const DEPRECATED_VERSIONS: ApiVersion[] = [];
```

### Phase 2: Parallel Support (Month 1-6)

```typescript
// Both versions fully supported
export const CURRENT_VERSION = ApiVersion.V2;
export const SUPPORTED_VERSIONS = [ApiVersion.V1, ApiVersion.V2];
export const DEPRECATED_VERSIONS: ApiVersion[] = [];
```

### Phase 3: Deprecation (Month 7-12)

```typescript
// V1 deprecated, V2 is current
export const CURRENT_VERSION = ApiVersion.V2;
export const SUPPORTED_VERSIONS = [ApiVersion.V1, ApiVersion.V2];
export const DEPRECATED_VERSIONS: ApiVersion[] = [ApiVersion.V1];

// Mark all V1 endpoints
@Deprecated(ApiVersion.V1, '2025-12-31', '/api/v2/...')
```

### Phase 4: Sunset (Month 12+)

```typescript
// Remove V1 completely
export const CURRENT_VERSION = ApiVersion.V2;
export const SUPPORTED_VERSIONS = [ApiVersion.V2];
export const DEPRECATED_VERSIONS: ApiVersion[] = [];

// Remove V1 controllers from modules
```

## Example 9: Version Detection Middleware

```typescript
// Custom middleware to log version usage
@Injectable()
export class VersionLoggingMiddleware implements NestMiddleware {
  constructor(private logger: LoggingService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const version = req.path.match(/\/v(\d+)\//)?.[1] || 'default';

    this.logger.log(
      `API Version ${version} accessed: ${req.method} ${req.path}`,
    );

    // Track metrics
    this.trackVersionUsage(version, req.path);

    next();
  }

  private trackVersionUsage(version: string, path: string) {
    // Send to analytics/monitoring
  }
}
```

## Example 10: Automatic Version Negotiation

```typescript
// Future enhancement: Content negotiation
@Controller('auth')
export class AuthController {
  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Headers('Accept-Version') acceptVersion?: string,
  ) {
    const version = acceptVersion || CURRENT_VERSION;

    if (version === ApiVersion.V2) {
      return this.loginV2(loginDto);
    }

    return this.loginV1(loginDto);
  }
}
```

## Best Practices Summary

1. **Always provide migration guides** for breaking changes
2. **Set realistic sunset dates** (6-12 months minimum)
3. **Monitor version usage** to understand adoption
4. **Communicate early and often** about deprecations
5. **Test all versions** in your CI/CD pipeline
6. **Document changes clearly** in release notes
7. **Provide code examples** for migrations
8. **Support at least 2 versions** simultaneously
9. **Use semantic versioning** principles
10. **Automate deprecation warnings** in client SDKs
