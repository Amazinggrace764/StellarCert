# Email Notification Service - Implementation Guide

## Overview

This guide provides step-by-step instructions for integrating the Email Notification Service into existing modules (Auth, Certificates, and Users).

## Architecture

The Email Notification Service consists of:

1. **EmailService** - Core service for sending emails with template rendering
2. **EmailQueueService** - Queue management for asynchronous email processing
3. **EmailQueueProcessor** - Background job processor using Bull
4. **EmailController** - REST API endpoints for email operations
5. **Email Templates** - Handlebars templates for email content

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

Create or update your `.env` file:

```env
# Email Service
EMAIL_SERVICE=smtp
EMAIL_HOST=smtp.mailtrap.io
EMAIL_PORT=587
EMAIL_USERNAME=your_username
EMAIL_PASSWORD=your_password
EMAIL_FROM=noreply@stellarcert.com

# Redis (required for queuing)
REDIS_URL=redis://localhost:6379

# Application
APP_URL=https://stellarcert.com
```

### 3. Start Redis

Email queuing requires Redis. Start it locally:

```bash
# Using Docker
docker run -d -p 6379:6379 redis:latest

# Or using Homebrew (macOS)
brew services start redis

# Or using apt (Linux)
sudo systemctl start redis-server
```

### 4. Start the Application

```bash
npm run start:dev
```

## Integration Examples

### Auth Module Integration

Update [src/modules/auth/auth.service.ts](../../auth/auth.service.ts):

```typescript
import { Injectable } from '@nestjs/common';
import { EmailQueueService } from '../email/email-queue.service';

@Injectable()
export class AuthService {
  constructor(
    // ... existing dependencies
    private emailQueueService: EmailQueueService,
  ) {}

  async register(registerDto: RegisterDto) {
    // Create user
    const user = await this.usersService.create(registerDto);
    
    // Generate verification token
    const verificationToken = this.generateToken(user.id);
    
    // Queue verification email
    await this.emailQueueService.queueVerificationEmail({
      to: user.email,
      userName: user.firstName,
      verificationLink: `${process.env.APP_URL}/auth/verify-email?token=${verificationToken}`,
    });

    return { user, message: 'Registration successful. Check your email to verify.' };
  }

  async requestPasswordReset(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Generate reset token
    const resetToken = this.generateToken(user.id);
    
    // Save token to database with expiration
    await this.usersService.setPasswordResetToken(user.id, resetToken);

    // Queue password reset email
    await this.emailQueueService.queuePasswordReset({
      to: user.email,
      userName: user.firstName,
      resetLink: `${process.env.APP_URL}/auth/reset-password?token=${resetToken}`,
    });

    return { message: 'Password reset link sent to your email' };
  }

  async verifyEmail(token: string) {
    const user = await this.usersService.findByVerificationToken(token);
    if (!user) {
      throw new BadRequestException('Invalid or expired token');
    }

    // Mark email as verified
    await this.usersService.markEmailAsVerified(user.id);

    return { message: 'Email verified successfully' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.usersService.findByPasswordResetToken(token);
    if (!user) {
      throw new BadRequestException('Invalid or expired token');
    }

    // Update password
    await this.usersService.updatePassword(user.id, newPassword);

    return { message: 'Password reset successfully' };
  }
}
```

Update [src/modules/auth/auth.module.ts](../../auth/auth.module.ts):

```typescript
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { EmailModule } from '../email/email.module';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    UsersModule,
    EmailModule, // Add this
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '3600s' },
    }),
  ],
  providers: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
```

### Certificates Module Integration

Update [src/modules/certificates/certificates.service.ts](../../certificates/certificates.service.ts):

```typescript
import { Injectable } from '@nestjs/common';
import { EmailQueueService } from '../email/email-queue.service';

@Injectable()
export class CertificatesService {
  constructor(
    // ... existing dependencies
    private emailQueueService: EmailQueueService,
  ) {}

  async issueCertificate(issueDto: IssueCertificateDto) {
    // Create certificate
    const certificate = await this.certificateRepository.save({
      ...issueDto,
      issuedAt: new Date(),
      status: 'active',
    });

    // Get issuer info
    const issuer = await this.issuersService.findById(issueDto.issuerId);

    // Queue certificate issued email
    await this.emailQueueService.queueCertificateIssued({
      to: issueDto.recipientEmail,
      certificateId: certificate.id,
      recipientName: issueDto.recipientName,
      certificateName: certificate.name,
      issuerName: issuer.name,
    });

    return certificate;
  }

  async revokeCertificate(id: string, reason: string, revokedBy: string) {
    const certificate = await this.certificateRepository.findOne(id);
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }

    // Update certificate status
    const revoked = await this.certificateRepository.save({
      ...certificate,
      status: 'revoked',
      revokedAt: new Date(),
      revokedBy,
      revocationReason: reason,
    });

    // Queue revocation notice email
    await this.emailQueueService.queueRevocationNotice({
      to: certificate.recipientEmail,
      recipientName: certificate.recipientName,
      certificateId: certificate.id,
      certificateName: certificate.name,
      reason,
      revocationDate: new Date().toISOString(),
    });

    return revoked;
  }

  async bulkIssueCertificates(bulkDto: BulkIssueCertificateDto) {
    const issued = [];
    const issuer = await this.issuersService.findById(bulkDto.issuerId);

    for (const cert of bulkDto.certificates) {
      const certificate = await this.issueCertificate({
        ...cert,
        issuerId: bulkDto.issuerId,
      });
      issued.push(certificate);

      // Email is automatically queued in issueCertificate()
    }

    return issued;
  }
}
```

Update [src/modules/certificates/certificates.module.ts](../../certificates/certificates.module.ts):

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CertificatesService } from './certificates.service';
import { CertificatesController } from './certificates.controller';
import { CertificateEntity } from './entities/certificate.entity';
import { EmailModule } from '../email/email.module';
import { IssuersModule } from '../issuers/issuers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CertificateEntity]),
    EmailModule, // Add this
    IssuersModule,
  ],
  providers: [CertificatesService],
  controllers: [CertificatesController],
  exports: [CertificatesService],
})
export class CertificatesModule {}
```

### Users Module Integration

Update [src/modules/users/users.service.ts](../../users/users.service.ts):

```typescript
import { Injectable } from '@nestjs/common';
import { EmailQueueService } from '../email/email-queue.service';

@Injectable()
export class UsersService {
  constructor(
    // ... existing dependencies
    private emailQueueService: EmailQueueService,
  ) {}

  async updateProfile(userId: string, updateDto: UpdateUserDto) {
    const user = await this.userRepository.findOne(userId);
    
    // If email is being changed, require verification
    if (updateDto.email && updateDto.email !== user.email) {
      const verificationToken = this.generateToken(userId);
      
      // Queue new email verification
      await this.emailQueueService.queueVerificationEmail({
        to: updateDto.email,
        userName: user.firstName,
        verificationLink: `${process.env.APP_URL}/auth/verify-email?token=${verificationToken}`,
      });

      // Update with unverified email
      user.email = updateDto.email;
      user.emailVerified = false;
    }

    // Update other profile fields
    Object.assign(user, updateDto);
    return await this.userRepository.save(user);
  }

  async notifyWelcome(userId: string) {
    const user = await this.userRepository.findOne(userId);
    
    // You can create a welcome email template and add it to email service
    // For now, we can use the verification email as welcome
    const verificationToken = this.generateToken(userId);
    
    await this.emailQueueService.queueVerificationEmail({
      to: user.email,
      userName: user.firstName,
      verificationLink: `${process.env.APP_URL}/auth/verify-email?token=${verificationToken}`,
    });
  }
}
```

Update [src/modules/users/users.module.ts](../../users/users.module.ts):

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserEntity } from './entities/user.entity';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    EmailModule, // Add this
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
```

## Testing the Integration

### 1. Test Email Endpoint

```bash
curl -X POST http://localhost:3000/email/send-certificate-issued \
  -H "Content-Type: application/json" \
  -d '{
    "to": "user@example.com",
    "certificateId": "cert-123",
    "recipientName": "John Doe",
    "certificateName": "AWS Certified Solutions Architect",
    "issuerName": "Amazon Web Services"
  }'
```

### 2. Test with Auth Service

```bash
# Register new user
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "SecurePassword123!",
    "firstName": "John",
    "lastName": "Doe"
  }'

# Should receive verification email
```

### 3. Monitor Queue

```typescript
// In any controller or service
constructor(private emailQueueService: EmailQueueService) {}

async getQueueStatus() {
  return await this.emailQueueService.getQueueStats();
}
```

## Email Template Customization

### Modifying Templates

Edit templates in `/src/modules/email/templates/`:

```handlebars
<!-- Example: certificate-issued.hbs -->
<h1>Certificate Issued!</h1>
<p>Dear {{recipientName}},</p>
<p>Your certificate "{{certificateName}}" has been issued by {{issuerName}}.</p>
<a href="{{certificateLink}}">View Certificate</a>
```

### Adding New Email Types

1. Create new template in `/src/modules/email/templates/my-template.hbs`
2. Add new DTO in `/src/modules/email/dto/send-my-email.dto.ts`
3. Add method to `EmailService`:
   ```typescript
   async sendMyEmail(dto: SendMyEmailDto): Promise<void> {
     const emailDto: SendEmailDto = {
       to: dto.to,
       subject: 'Your Subject',
       template: 'my-template',
       data: { /* template data */ }
     };
     await this.sendEmail(emailDto);
   }
   ```
4. Add processor method to `EmailQueueProcessor`
5. Add queue method to `EmailQueueService`

## Error Handling

### Handle Email Failures

```typescript
async issueCertificate(dto: IssueCertificateDto) {
  const certificate = await this.createCertificate(dto);

  try {
    await this.emailQueueService.queueCertificateIssued({
      to: dto.recipientEmail,
      // ...
    });
  } catch (error) {
    this.logger.error(`Failed to queue certificate email: ${error.message}`);
    // Don't fail the certificate creation, email can be retried manually
  }

  return certificate;
}
```

## Monitoring and Debugging

### Check Queue Status

```typescript
const stats = await this.emailQueueService.getQueueStats();
console.log('Active jobs:', stats.active);
console.log('Failed jobs:', stats.failed);
console.log('Completed jobs:', stats.completed);
```

### View Logs

The service logs all operations:
```
[EmailService] Template loaded: certificate-issued
[EmailQueueProcessor] Processing email job: 1
[EmailService] Email sent to user@example.com: 250 Message accepted
```

## Best Practices

1. **Always use EmailQueueService** - It ensures reliable async delivery
2. **Test with Mailtrap** - Free SMTP testing service
3. **Set appropriate expiration times** - For verification and reset tokens
4. **Handle failures gracefully** - Don't fail primary operations if email fails
5. **Monitor queue stats** - Track email delivery metrics
6. **Use descriptive subject lines** - Include certificate/action names
7. **Template testing** - Preview templates before sending

## Troubleshooting

### Emails not being sent

1. Check Redis is running: `redis-cli ping`
2. Verify SMTP credentials work
3. Check application logs for errors
4. Test connection: `await emailService.verifyConnection()`

### Redis connection errors

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

Solution: Start Redis server or update REDIS_URL in .env

### Template not found

```
Error: Template verification-email not found
```

Solution: Ensure template file exists and application reloaded

## Performance Tips

1. **Use queuing for non-urgent emails** - Improves user response time
2. **Set appropriate retry limits** - 3 attempts by default
3. **Monitor Redis memory** - Clear old job data regularly
4. **Batch operations** - Queue multiple emails together
5. **Use connection pooling** - For SMTP connections

## Security Considerations

1. Never commit SMTP credentials
2. Always use HTTPS in email links
3. Implement token expiration
4. Validate email addresses before sending
5. Log email attempts without sensitive data
6. Use environment variables for all credentials

## References

- [Nodemailer Documentation](https://nodemailer.com/)
- [Bull Queue Documentation](https://github.com/OptimalBits/bull)
- [Handlebars Documentation](https://handlebarsjs.com/)
- [SendGrid Documentation](https://sendgrid.com/docs/)
