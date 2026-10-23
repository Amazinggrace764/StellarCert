# API Versioning System

This module provides comprehensive API versioning support for the StellarWave backend, enabling backward-compatible changes and graceful deprecation of endpoints.

## Features

- **URL-based versioning** (`/api/v1/`, `/api/v2/`)
- **Version-specific controllers** for clean separation
- **Deprecation headers** for client notification
- **Migration guides endpoint** for developers
- **Version compatibility tests** for reliability
- **Graceful deprecation** with sunset dates

## Quick Start

### 1. Enable Versioning

Versioning is already enabled in `main.ts`:

```typescript
app.enableVersioning({
  type: VersioningType.URI,
  defaultVersion: '1',
});
```

### 2. Create Versioned Controllers

```typescript
import { Controller, Get, Version } from '@nestjs/common';

// Version 1 Controller
@Controller({ path: 'users', version: '1' })
export class UsersV1Controller {
  @Get()
  findAll() {
    return { version: 'v1', users: [] };
  }
}

// Version 2 Controller
@Controller({ path: 'users', version: '2' })
export class UsersV2Controller {
  @Get()
  findAll() {
    return { version: 'v2', users: [], metadata: {} };
  }
}
```

### 3. Mark Deprecated Endpoints

```typescript
import { Deprecated } from './common/versioning';
import { ApiVersion } from './common/versioning';

@Controller({ path: 'users', version: '1' })
export class UsersV1Controller {
  @Get()
  @Deprecated(ApiVersion.V1, '2025-12-31', '/api/v2/users')
  findAll() {
    return { users: [] };
  }
}
```

## API Endpoints

### Get Version Information

```bash
GET /api/versions
```

Response:

```json
{
  "currentVersion": "1",
  "supportedVersions": ["1", "2"],
  "versions": [
    {
      "version": "1",
      "deprecated": false
    },
    {
      "version": "2",
      "deprecated": false
    }
  ]
}
```

### Get Migration Guide

```bash
GET /api/versions/migration-guide?from=1&to=2
```

Response:

```json
{
  "fromVersion": "1",
  "toVersion": "2",
  "breakingChanges": [
    "Authentication endpoints now require API key",
    "Date fields now use ISO 8601 format"
  ],
  "newFeatures": [
    "Batch certificate operations",
    "Enhanced search capabilities"
  ],
  "migrationSteps": [
    "Update authentication to include API key header",
    "Update date parsing to handle ISO 8601 format"
  ]
}
```

## Deprecation Headers

When calling a deprecated endpoint, the following headers are returned:

```
Deprecation: true
X-API-Deprecated-Since: 1
Sunset: 2025-12-31
Link: </api/v2/endpoint>; rel="alternate"
X-API-Deprecation-Info: This endpoint is deprecated. Please check the documentation for alternatives.
```

## Usage Examples

### Accessing Versioned Endpoints

```bash
# Version 1
curl http://localhost:3000/api/v1/auth/login

# Version 2
curl http://localhost:3000/api/v2/auth/login

# Default version (v1)
curl http://localhost:3000/api/auth/login
```

### Creating a New Version

1. **Update version enum** (`version.enum.ts`):

```typescript
export enum ApiVersion {
  V1 = '1',
  V2 = '2',
  V3 = '3', // Add new version
}

export const CURRENT_VERSION = ApiVersion.V3;
export const SUPPORTED_VERSIONS = [ApiVersion.V1, ApiVersion.V2, ApiVersion.V3];
export const DEPRECATED_VERSIONS: ApiVersion[] = [ApiVersion.V1];
```

2. **Create new controller**:

```typescript
@Controller({ path: 'auth', version: '3' })
export class AuthV3Controller {
  // New implementation
}
```

3. **Update migration guide** in `version.service.ts`:

```typescript
const guides: Record<string, MigrationGuideDto> = {
  '2-3': {
    fromVersion: ApiVersion.V2,
    toVersion: ApiVersion.V3,
    breakingChanges: ['...'],
    newFeatures: ['...'],
    migrationSteps: ['...'],
  },
};
```

4. **Mark old version as deprecated**:

```typescript
@Controller({ path: 'auth', version: '2' })
export class AuthV2Controller {
  @Post('login')
  @Deprecated(ApiVersion.V2, '2026-12-31', '/api/v3/auth/login')
  async login() {
    // ...
  }
}
```

## Best Practices

1. **Maintain backward compatibility** within a version
2. **Document breaking changes** in migration guides
3. **Set sunset dates** for deprecated versions (6-12 months)
4. **Test version compatibility** thoroughly
5. **Communicate changes** to API consumers early
6. **Keep at least 2 versions** supported simultaneously
7. **Use semantic versioning** principles

## Testing

Run versioning tests:

```bash
# Unit tests
npm test -- version.service.spec.ts
npm test -- version.controller.spec.ts
npm test -- deprecation.interceptor.spec.ts

# E2E tests
npm run test:e2e -- versioning.e2e-spec.ts
```

## Configuration

Update version configuration in `version.enum.ts`:

```typescript
export const CURRENT_VERSION = ApiVersion.V2;
export const SUPPORTED_VERSIONS = [ApiVersion.V1, ApiVersion.V2];
export const DEPRECATED_VERSIONS: ApiVersion[] = [ApiVersion.V1];
```

## Architecture

```
versioning/
├── version.enum.ts              # Version definitions
├── decorators/
│   └── api-version.decorator.ts # Version decorators
├── interceptors/
│   └── deprecation.interceptor.ts # Deprecation headers
├── services/
│   └── version.service.ts       # Version logic
├── controllers/
│   └── version.controller.ts    # Version endpoints
├── dto/
│   └── version-info.dto.ts      # DTOs
└── versioning.module.ts         # Module definition
```

## Migration Strategy

### Phase 1: Preparation (Month 1-2)

- Announce new version
- Publish migration guide
- Provide code examples

### Phase 2: Transition (Month 3-8)

- Both versions supported
- Deprecation headers active
- Monitor usage metrics

### Phase 3: Sunset (Month 9-12)

- Increase deprecation warnings
- Direct support to new version
- Final migration deadline

### Phase 4: Removal (Month 12+)

- Remove old version
- Archive documentation
- Update all references

## Troubleshooting

### Version not recognized

- Check `SUPPORTED_VERSIONS` in `version.enum.ts`
- Verify controller version decorator
- Ensure versioning is enabled in `main.ts`

### Deprecation headers not showing

- Verify `@Deprecated()` decorator is applied
- Check `DeprecationInterceptor` is registered
- Confirm interceptor is in module providers

### Migration guide not found

- Add guide to `version.service.ts`
- Use correct version format (e.g., '1-2')
- Verify version parameters in request

## Support

For questions or issues with API versioning:

1. Check this documentation
2. Review migration guides at `/api/versions/migration-guide`
3. Contact the backend team
