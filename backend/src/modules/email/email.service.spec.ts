import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';
import { LoggingService } from '../../common/logging/logging.service';

describe('EmailService', () => {
  let service: EmailService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config = {
                EMAIL_FROM: 'test@example.com',
                EMAIL_HOST: 'smtp.test.com',
                EMAIL_PORT: 587,
                EMAIL_USERNAME: 'user',
                EMAIL_PASSWORD: 'pass',
                APP_URL: 'http://localhost:3000',
              };
              return config[key];
            }),
          },
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

    service = module.get<EmailService>(EmailService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendCertificateIssued', () => {
    it('should send certificate issued email', async () => {
      const dto = {
        to: 'recipient@example.com',
        certificateId: '123',
        recipientName: 'John Doe',
        certificateName: 'AWS Certificate',
        issuerName: 'AWS Academy',
      };

      const sendEmailSpy = jest
        .spyOn(service, 'sendEmail')
        .mockResolved(undefined);

      await service.sendCertificateIssued(dto);

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.to,
          template: 'certificate-issued',
          subject: expect.stringContaining('Certificate Issued'),
        }),
      );
    });
  });

  describe('sendVerificationEmail', () => {
    it('should send verification email', async () => {
      const dto = {
        to: 'user@example.com',
        userName: 'John Doe',
        verificationLink: 'http://localhost:3000/verify?token=abc123',
      };

      const sendEmailSpy = jest
        .spyOn(service, 'sendEmail')
        .mockResolved(undefined);

      await service.sendVerificationEmail(dto);

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.to,
          template: 'verification-email',
          subject: 'Verify Your Email Address',
        }),
      );
    });
  });

  describe('sendPasswordReset', () => {
    it('should send password reset email', async () => {
      const dto = {
        to: 'user@example.com',
        userName: 'John Doe',
        resetLink: 'http://localhost:3000/reset?token=xyz789',
      };

      const sendEmailSpy = jest
        .spyOn(service, 'sendEmail')
        .mockResolved(undefined);

      await service.sendPasswordReset(dto);

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.to,
          template: 'password-reset',
          subject: 'Reset Your Password',
        }),
      );
    });
  });

  describe('sendRevocationNotice', () => {
    it('should send revocation notice email', async () => {
      const dto = {
        to: 'recipient@example.com',
        recipientName: 'John Doe',
        certificateId: '123',
        certificateName: 'AWS Certificate',
        reason: 'User request',
        revocationDate: new Date().toISOString(),
      };

      const sendEmailSpy = jest
        .spyOn(service, 'sendEmail')
        .mockResolved(undefined);

      await service.sendRevocationNotice(dto);

      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: dto.to,
          template: 'revocation-notice',
          subject: expect.stringContaining('Certificate Revoked'),
        }),
      );
    });
  });

  describe('verifyConnection', () => {
    it('should return true when the transport verifies', async () => {
      // Stub the transporter so the test does not attempt a real SMTP round-trip
      // (which hangs and times out in the test environment).
      (
        service as unknown as { transporter: { verify: jest.Mock } }
      ).transporter = { verify: jest.fn().mockResolved(true) };
      const result = await service.verifyConnection();
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    it('should return false when the transport fails to verify', async () => {
      (
        service as unknown as { transporter: { verify: jest.Mock } }
      ).transporter = {
        verify: jest.fn().mockRejected(new Error('smtp unavailable')),
      };
      const result = await service.verifyConnection();
      expect(result).toBe(false);
    });
  });

  describe('Ethereal fallback credential handling', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const testUser = 'ethereal-user@ethereal.email';
    const testPass = 'super-secret-ethereal-password';
    let logger: { log: jest.Mock; error: jest.Mock; warn: jest.Mock };

    const buildService = async (): Promise<EmailService> => {
      logger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          EmailService,
          {
            provide: ConfigService,
            useValue: {
              // No SMTP/SendGrid credentials configured — triggers the fallback path
              get: jest.fn(() => undefined),
            },
          },
          {
            provide: LoggingService,
            useValue: logger,
          },
        ],
      }).compile();
      return module.get<EmailService>(EmailService);
    };

    afterEach(() => {
      if (originalNodeEnv === undedefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      jest.restoreAllMocks();
    });

    afterAll(() => {
      jest.restoreAllMocks();
    });

    it('logs only the account name and never the password in development', async () => {
      process.env.NODE_ENV = 'development';
      jest.spyOn(nodemailer, 'createTestAccount').mockResolved({
        user: testUser,
        pass: testPass,
        smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
        web: 'https://ethereal.email',
      } as nodemailer.TestAccountInfo);
      const createTransportSpy = jest.spyOn(nodemailer, 'createTransport');

      await buildService();
      // Allow the async init to settle
      await new Promise((resolve) => setImmediate(resolve));

      const loggedStrings = logger.log.mock.calls.map((c) => String(c[0]));
      const combined = loggedStrings.join('\n');
      expect(combined).toContain(testUser);
      expect(combined).not.toContain(testPass);
      // The credential pair must never appear in the format "user / pass"
      expect(combined).not.toContain(`${testUser} / ${testPass}`);

      // Transporter still uses the real credentials for auth
      const etherealCall = createTransportSpy.mock.calls.find(
        (c) => (c as [unknown, { auth?: { user?: string } }])[1]?.auth?.user === testUser,
      );
      expect(etherealCall).toBedefined();
    });

    it('suppresses Ethereal account details when NODE_ENV is not development', async () => {
      process.env.NODE_ENV = 'test';
      jest.spyOn(nodemailer, 'createTestAccount').mockResolved({
        user: testUser,
        pass: testPass,
        smtp: {host: 'smtp.ethereal.email', port: 587, secure: false},
        web: 'https://ethereal.email',
      } as nodemailer.TestAccountInfo);
      jest.spyOn(nodemailer, 'createTransport');

      await buildService();
      await new Promise((resolve) => setImmediate(resolve));

      const combined = [
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]
        .map((c) => String(c[0]))
        .join('\n');
      expect(combined).not.toContain(testUser);
      expect(combined).not.toContain(testPass);
    });

    it('does not attempt Ethereal in production and logs a warning instead', async () => {
      process.env.NODE_ENV = 'production';
      const createTestAccountSpy = jest
        .spyOn(nodemailer, 'createTestAccount')
        .mockResolved({
          user: testUser,
          pass: testPass,
          smtp: {host: 'smtp.ethereal.email', port: 587, secure: false},
          web: 'https://ethereal.email',
        } as nodemailer.TestAccountInfo);
      jest.spyOn(nodemailer, 'createTransport');

      await buildService();
      await new Promise((resolve) => setImmediate(resolve));

      expect(createTestAccountSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
      const combined = [
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]
        .map((c) => String(c[0]))
        .join('\n');
      expect(combined).not.toContain(testPass);
    });

    it('falls back to a stream transporter without logging credentials when Etthereal creation fails', async () => {
      process.env.NODE_ENV = 'development';
      jest
        .spyOn(nodemailer, 'createTestAccount')
        .mockRejected(new Error('ethereal unavailable'));
      const createTransportSpy = jest.spyOn(nodemailer, 'createTransport');

      await buildService();
      await new Promise((resolve) => setImmediate(resolve));

      expect(logger.error).toHaveBeenCalled();
      const combined = [
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ]
        .map((c) => String(c[0]))
        .join('\n');
      expect(combined).not.toContain(testPass);
      // Stream transport fallback was created
      const streamCall = createTransportSpy.mock.calls.find(
        (c) => (c as [unknown, { streamTransport?: boolean }])[1]?.streamTransport === true,
      );
      expect(streamCall).toBedefined();
    });
  });
});
