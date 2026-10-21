# Common Module Documentation

A comprehensive, production-ready common module for the StellarWave backend. Provides reusable components, decorators, guards, interceptors, and utilities shared across all backend modules.

## Features

### 🔐 Authentication & Authorization
- **JWT Auth Guard**: Validates JWT tokens from Authorization headers
- **Roles Guard**: Enforces role-based access control (RBAC)
- **Decorators**:
  - `@Roles()`: Specify required roles for endpoints
  - `@CurrentUser()`: Inject authenticated user into handlers
  - `@Public()`: Mark routes as public (skip authentication)

### 🛡️ Request/Response Handling
- **Validation Pipe**: Global validation with custom error messages
- **Response Interceptor**: Standardized API response format
- **Logging Interceptor**: Request/response logging with correlation IDs
- **Timeout Interceptor**: Request timeout handling (30s default)

### ⚠️ Error Handling
- **Global Exception Filter**: Centralized exception handling
- **Custom Exceptions**:
  - `ValidationException`: Input validation errors
  - `StellarException`: Blockchain-related errors
  - `CertificateException`: Certificate operation errors
  - `AuthException`: Authentication/authorization errors
  - `NotFoundException`: Resource not found
  - `ConflictException`: Resource conflict
- **Error Codes & Messages**: Standardized error definitions

### 🛠️ Utilities & Helpers

#### Validation Utils
```typescript
import { ValidationUtils } from '@common/utils';

ValidationUtils.isStellarAddress('GXXXX...');
ValidationUtils.isValidEmail('user@example.com');
ValidationUtils.isFutureDate(new Date());
ValidationUtils.hasExpired(expiryDate);
ValidationUtils.isStrongPassword('MyPass123!@#');
```

#### Crypto Utils
```typescript
import { CryptoUtils } from '@common/utils';

// Password hashing
const hash = await CryptoUtils.hashPassword('password');
const isMatch = await CryptoUtils.comparePassword('password', hash);

// Token generation
const token = CryptoUtils.generateToken(32);
const code = CryptoUtils.generateNumericCode(6);

// HMAC signatures
const signature = CryptoUtils.createHMAC(data, secret);
const isValid = CryptoUtils.verifyHMAC(data, signature, secret);
```

#### Transform Utils
```typescript
import { TransformUtils } from '@common/utils';

TransformUtils.removeUndefined(obj);
TransformUtils.toCamelCase(snakeCase);
TransformUtils.pick(obj, ['id', 'name']);
TransformUtils.deepClone(obj);
TransformUtils.merge(obj1, obj2);
TransformUtils.formatDateISO(date);
```

#### String Utils
```typescript
import { StringUtils } from '@common/utils';

StringUtils.slug('Hello World');
StringUtils.truncate(text, 50);
StringUtils.capitalize('hello');
StringUtils.mask('email@example.com', '*', 2);
```

### 📋 Constants
- **User Roles**: ADMIN, ISSUER, AUDITOR, USER
- **Error Codes**: Comprehensive error code definitions
- **Status Constants**: Certificate and account statuses
- **Request Configuration**: Timeout, page size limits

## Usage Examples

### Using Guards & Decorators

```typescript
import { Controller, Get, Post } from '@nestjs/common';
import { Roles, CurrentUser, Public } from '@common/decorators';
import { UserRole } from '@common/constants';

@Controller('users')
export class UsersController {
  // Public route
  @Post('login')
  @Public()
  login() {}

  // Protected route - all authenticated users
  @Get('profile')
  getProfile(@CurrentUser() user: any) {
    return { id: user.id };
  }

  // Admin only
  @Get('all')
  @Roles(UserRole.ADMIN)
  getAllUsers(@CurrentUser() user: any) {
    return [];
  }

  // Multiple roles
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  deleteUser(@Param('id') id: string) {}
}
```

### Custom Exception Handling

```typescript
import { StellarException, CertificateException, ValidationException } from '@common/exceptions';
import { ErrorCode } from '@common/constants';

// Validation error
throw new ValidationException('Invalid data', {
  email: 'Invalid email format',
  age: 'Must be at least 18'
});

// Certificate error
throw new CertificateException(
  ErrorCode.CERTIFICATE_NOT_FOUND,
  'Certificate with ID xyz not found'
);

// Stellar blockchain error
throw new StellarException(
  ErrorCode.INVALID_STELLAR_ADDRESS,
  'Invalid Stellar public key'
);
```

### Validation Examples

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;
}
```

## API Response Format

### Success Response (200)
```json
{
  "statusCode": 200,
  "message": "Request successful",
  "data": { ... },
  "timestamp": "2024-01-23T10:30:00.000Z",
  "path": "/api/users/123",
  "correlationId": "req-12345"
}
```

### Error Response (400-500)
```json
{
  "errorCode": "VALIDATION_ERROR",
  "message": "Validation failed",
  "details": {
    "email": "Invalid email format"
  },
  "timestamp": "2024-01-23T10:30:00.000Z",
  "path": "/api/users",
  "correlationId": "req-12345"
}
```

## Environment Variables

```env
JWT_SECRET=your-secret-key-here
SENTRY_DSN=https://your-sentry-dsn@sentry.io/...
NODE_ENV=development|production
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

## Architecture

```
common/
├── constants/          # Shared constants (roles, error codes, statuses)
├── decorators/         # Route decorators (@Roles, @CurrentUser, @Public)
├── exceptions/         # Custom exceptions and filters
├── guards/            # Authentication and authorization guards
├── interceptors/      # Request/response interceptors
├── utils/             # Reusable utility functions
├── pipes/             # Custom pipes (validation)
├── dto/               # Data transfer objects
├── filters/           # Exception filters (legacy)
├── logging/           # Logging services
├── monitoring/        # Monitoring and metrics
├── common.module.ts   # Module definition
└── index.ts          # Export index
```

## Global Setup

The CommonModule is automatically registered in AppModule and provides:
- Global validation pipe for all requests
- Global exception filter for all errors
- Global guards for JWT auth and role-based access
- Global interceptors for response standardization, logging, and timeouts
- Middleware for correlation ID tracking and metrics

No additional setup is required in individual modules.

## Best Practices

1. **Always use custom exceptions** for consistency
2. **Mark public routes** with `@Public()` decorator
3. **Specify required roles** with `@Roles()` decorator
4. **Use validation utilities** for input validation
5. **Use crypto utilities** for password and token handling
6. **Use transform utilities** for data manipulation
7. **Leverage correlation IDs** for request tracing

## Testing

```typescript
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '@common/guards';
import { RolesGuard } from '@common/guards';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(async => {
    const module = await Test.createTestingModule({
      providers: [JwtAuthGuard],
    }).compile();
    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('should allow public routes', () => {
    // Test implementation
  });
});
```

## Migration Guide

### From Old Filter to New Exception System
```typescript
// Old
import { HttpExceptionFilter } from '@common/filters';

// New
import { GlobalExceptionFilter } from '@common/exceptions';
```

### Adding Guards to Existing Controllers
```typescript
import { JwtAuthGuard } from '@common/guards';

// Module-level (if not using global registration)
providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }]
```

## Contributing

When adding new utilities:
1. Add to appropriate utils file
2. Export in utils/index.ts
3. Add unit tests
4. Update this documentation

## Performance Considerations

- JWT tokens are verified on every request (can be optimized with caching)
- Validation happens before business logic (prevents invalid data)
- Timeout is set to 30s (configurable via REQUEST_TIMEOUT_MS constant)
- Correlation ID tracking has minimal overhead

## Support

For issues or questions:
1. Check existing error codes in `constants/error-codes.ts`
2. Use appropriate custom exception
3. Include correlation ID in error reports
4. Check logs for detailed error information
