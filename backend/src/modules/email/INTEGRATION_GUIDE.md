# Email Service Integration Guide

This guide shows how to integrate the Email Notification Service with existing modules in your application.

## Quick Integration Steps

### 1. Update Module Imports

Add `EmailModule` to your feature module's imports:

```typescript
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule, /* other imports */],
  providers: [YourService],
  controllers: [YourController],
})
export class YourModule {}
```

### 2. Inject Email Services

Inject the email service into your service:

```typescript
constructor(
  private emailQueueService: EmailQueueService,
  // or use EmailService for immediate sending
  // private emailService: EmailService,
) {}
```

### 3. Call Email Methods

Use the email service in your business logic.

---

## Auth Module Integration

### Update auth.module.ts

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default_secret_key_for_dev',
      signOptions: { expiresIn: parseInt(process.env.JWT_EXPIRES_IN || '3600', 10) },
    }),
    UsersModule,
    EmailModule, // Add this
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

### Update auth.service.ts

```typescript
import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { EmailQueueService } from '../email/email-queue.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailQueueService: EmailQueueService,
  ) {}

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }
    
    const payload = { email: user.email, sub: user.id, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    
    return {
      accessToken,
      expiresIn: 3600,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    // Check if user already exists
    const existingUser = await this.usersService.findOneByEmail(registerDto.email);
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(registerDto.password, 12);
    
    // Create user
    const newUser = await this.usersService.create({
      email: registerDto.email,
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      password: hashedPassword,
    });
    
    // Queue verification email
    await this.emailQueueService.queueVerificationEmail({
      to: newUser.email,
      userName: `${newUser.firstName} ${newUser.lastName}`,
      verificationLink: `${process.env.APP_URL}/auth/verify?token=${this.generateVerificationToken(newUser.id)}`,
    });
    
    const payload = { email: newUser.email, sub: newUser.id, role: newUser.role };
    const accessToken = this.jwtService.sign(payload);
    
    return {
      accessToken,
      expiresIn: 3600,
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
      },
    };
  }

  async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const user = await this.usersService.findOneByEmail(email);
    
    if (!user) {
      // Don't reveal if user exists for security
      return { success: true, message: 'If email exists, password reset link has been sent' };
    }

    const resetToken = this.generateResetToken(user.id);
    
    // Queue password reset email
    await this.emailQueueService.queuePasswordReset({
      to: user.email,
      userName: `${user.firstName} ${user.lastName}`,
      resetLink: `${process.env.APP_URL}/auth/reset-password?token=${resetToken}`,
    });

    return { success: true, message: 'Password reset email has been sent' };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const userId = this.verifyResetToken(token);
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    await this.usersService.updatePassword(userId, hashedPassword);

    return { success: true, message: 'Password has been reset successfully' };
  }

  private generateVerificationToken(userId: string): string {
    return this.jwtService.sign({ sub: userId, type: 'verify' }, { expiresIn: '24h' });
  }

  private generateResetToken(userId: string): string {
    return this.jwtService.sign({ sub: userId, type: 'reset' }, { expiresIn: '1h' });
  }

  private verifyResetToken(token: string): string {
    try {
      const payload = this.jwtService.verify(token);
      if (payload.type !== 'reset') {
        throw new Error('Invalid token type');
      }
      return payload.sub;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
  }

  private async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (user) {
      const userWithPassword = await this.usersService['userRepository'].findByEmailWithPassword(email);
      if (userWithPassword && await bcrypt.compare(pass, userWithPassword.password)) {
        const { password, ...result } = userWithPassword;
        return result;
      }
    }
    return null;
  }
}
```

---

## Certificate Module Integration

### Update certificates.module.ts

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CertificatesService } from './certificates.service';
import { CertificatesController } from './certificates.controller';
import { Certificate } from './entities/certificate.entity';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Certificate]),
    EmailModule, // Add this
  ],
  controllers: [CertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
```

### Update certificates.service.ts (example)

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailQueueService } from '../email/email-queue.service';
import { Certificate } from './entities/certificate.entity';
import { IssueCertificateDto } from './dto/issue-certificate.dto';

@Injectable()
export class CertificatesService {
  constructor(
    @InjectRepository(Certificate)
    private certificateRepository: Repository<Certificate>,
    private emailQueueService: EmailQueueService,
  ) {}

  async issueCertificate(dto: IssueCertificateDto): Promise<Certificate> {
    // Create and save certificate
    const certificate = this.certificateRepository.create(dto);
    const savedCertificate = await this.certificateRepository.save(certificate);

    try {
      // Queue certificate issued email
      await this.emailQueueService.queueCertificateIssued({
        to: savedCertificate.recipientEmail,
        certificateId: savedCertificate.id,
        recipientName: savedCertificate.recipientName,
        certificateName: savedCertificate.name,
        issuerName: savedCertificate.issuerName,
      });
    } catch (error) {
      console.error('Failed to queue certificate issued email:', error);
      // Don't throw - certificate is already created, email can be retried
    }

    return savedCertificate;
  }

  async revokeCertificate(
    id: string,
    reason: string,
  ): Promise<Certificate> {
    const certificate = await this.certificateRepository.findOne({ where: { id } });
    
    if (!certificate) {
      throw new Error('Certificate not found');
    }

    // Update certificate status
    certificate.status = 'revoked';
    certificate.revokedAt = new Date();
    const updatedCertificate = await this.certificateRepository.save(certificate);

    try {
      // Queue revocation notice email
      await this.emailQueueService.queueRevocationNotice({
        to: certificate.recipientEmail,
        recipientName: certificate.recipientName,
        certificateId: certificate.id,
        certificateName: certificate.name,
        reason,
        revocationDate: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to queue revocation notice email:', error);
      // Don't throw - revocation is already processed
    }

    return updatedCertificate;
  }
}
```

---

## User Module Integration

### Update users.module.ts

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    EmailModule, // Add this
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

### Update users.service.ts (example)

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailQueueService } from '../email/email-queue.service';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private emailQueueService: EmailQueueService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const user = this.usersRepository.create(createUserDto);
    const savedUser = await this.usersRepository.save(user);

    // Email is handled by AuthService, not here
    return savedUser;
  }

  async updateProfile(id: string, updateData: any): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    
    if (!user) {
      throw new Error('User not found');
    }

    // If email is being changed, queue verification email
    if (updateData.email && updateData.email !== user.email) {
      const oldEmail = user.email;
      user.email = updateData.email;
      user.emailVerified = false;

      try {
        await this.emailQueueService.queueVerificationEmail({
          to: user.email,
          userName: `${user.firstName} ${user.lastName}`,
          verificationLink: `${process.env.APP_URL}/auth/verify?token=${this.generateVerificationToken(user.id)}`,
        });
      } catch (error) {
        console.error('Failed to queue verification email:', error);
        user.email = oldEmail; // Rollback
        throw error;
      }
    }

    return this.usersRepository.save(user);
  }

  async findOneByEmail(email: string): Promise<User | undefined> {
    return this.usersRepository.findOne({ where: { email } });
  }

  private generateVerificationToken(userId: string): string {
    // Implement token generation (can use JWT)
    return 'token';
  }
}
```

---

## Best Practices

### 1. Always Use Queue Service

```typescript
// ✅ Good - Async, non-blocking
await this.emailQueueService.queueCertificateIssued(dto);

// ⚠️ Only use for critical paths that need immediate delivery
await this.emailService.sendCertificateIssued(dto);
```

### 2. Handle Email Errors Gracefully

```typescript
try {
  await this.emailQueueService.queueCertificateIssued(dto);
} catch (error) {
  // Log the error but don't fail the main operation
  console.error('Failed to queue email:', error);
}
```

### 3. Generate Secure Tokens

```typescript
// Use JWT with proper expiration
const token = this.jwtService.sign(
  { sub: userId, type: 'verify' },
  { expiresIn: '24h' }
);
```

### 4. Monitor Email Queue

```typescript
// Check queue status periodically
const stats = await this.emailQueueService.getQueueStats();
if (stats.failed > 100) {
  // Alert: Too many failed emails
}
```

### 5. Environment-Specific Configuration

```typescript
// Use different email addresses for different environments
const emailFrom = process.env.NODE_ENV === 'production'
  ? 'noreply@stellarcert.com'
  : 'noreply-test@stellarcert.com';
```

---

## Testing Integration

```typescript
describe('AuthService with Email', () => {
  let service: AuthService;
  let emailQueueService: EmailQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: EmailQueueService,
          useValue: {
            queueVerificationEmail: jest.fn(),
            queuePasswordReset: jest.fn(),
          },
        },
        // ... other providers
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    emailQueueService = module.get<EmailQueueService>(EmailQueueService);
  });

  it('should queue verification email on registration', async () => {
    const registerDto = {
      email: 'test@example.com',
      password: 'password123',
      firstName: 'John',
      lastName: 'Doe',
    };

    const queueSpy = jest.spyOn(emailQueueService, 'queueVerificationEmail');
    await service.register(registerDto);

    expect(queueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        userName: 'John Doe',
      })
    );
  });
});
```

---

## Troubleshooting Integration

### Email Not Sent After Action

1. Check Redis is running: `redis-cli ping`
2. Verify environment variables are set
3. Check application logs for queue errors
4. Monitor queue: `emailQueueService.getQueueStats()`

### Double Email Sending

Ensure you're using either `emailService` OR `emailQueueService`, not both for the same action.

### Token Not Working in Email

Verify token generation and expiration:
```typescript
// Token should match verification type
const payload = this.jwtService.verify(token);
if (payload.type !== 'verify') throw new Error('Invalid token');
```
