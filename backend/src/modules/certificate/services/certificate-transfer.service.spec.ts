import { CertificateTransferService } from './certificate-transfer.service';
import { TransferStatus } from '../entities/certificate-transfer.entity';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { UserRole } from '../../../common/constants/roles';

describe('CertificateTransferService', () => {
  let service: CertificateTransferService;
  let transferRepo: any;
  let certRepo: any;
  let auditService: any;
  let notificationsService: any;
  let logger: any;
  let userRepo: any;
  let emailService: any;

  beforeEach(() => {
    transferRepo = {
      create: jest.fn((dto) => ({ id: 'transfer-1', ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      findOne: jest.fn(),
    };

    certRepo = {
      findOne: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    userRepo = {
      findOne: jest.fn(),
    };

    emailService = {
      sendTransferConfirmationCode: jest.fn().mockResolvedValue(undefined),
      sendTransferCompletedNotice: jest.fn().mockResolvedValue(undefined),
    };

    service = new CertificateTransferService(
      transferRepo,
      certRepo,
      auditService,
      notificationsService,
      logger,
      userRepo,
      emailService,
    );
  });

  describe('initiateTransfer', () => {
    it('sends confirmation code to toEmail (notification & email), not initiator', async () => {
      const mockCert = {
        id: 'cert-1',
        title: 'Blockchain Certified Developer',
        issuerId: 'issuer-1',
        recipientEmail: 'old@example.com',
        recipientName: 'Old Owner',
        status: 'active',
      };
      certRepo.findOne.mockResolvedValue(mockCert);

      const recipientUser = {
        id: 'user-recipient-99',
        email: 'newowner@example.com',
        firstName: 'New',
        lastName: 'Owner',
      };
      userRepo.findOne.mockResolvedValue(recipientUser);

      const dto = {
        certificateId: 'cert-1',
        newOwnerEmail: 'newowner@example.com',
        newOwnerName: 'New Owner',
        reason: 'Change of legal name/address',
      };

      const result = await service.initiateTransfer(
        dto,
        { id: 'issuer-1', role: UserRole.ISSUER },
        '127.0.0.1',
      );

      expect(result).toBeDefined();
      const code = result.confirmationCode!;
      expect(code).toBeDefined();

      // 1. Initiator notification must NOT contain confirmationCode
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'issuer-1',
        NotificationType.INFO,
        'Certificate Transfer Initiated',
        expect.not.stringContaining(code),
      );

      // 2. Intended recipient user notification MUST contain confirmationCode
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'user-recipient-99',
        NotificationType.INFO,
        'Certificate Transfer Confirmation Code',
        expect.stringContaining(code),
      );

      // 3. Email MUST be sent to newOwnerEmail with confirmationCode
      expect(emailService.sendTransferConfirmationCode).toHaveBeenCalledWith({
        to: 'newowner@example.com',
        recipientName: 'New Owner',
        certificateTitle: 'Blockchain Certified Developer',
        certificateId: 'cert-1',
        confirmationCode: code,
      });
    });

    it('still sends the confirmation email to toEmail when the recipient has no account', async () => {
      const mockCert = {
        id: 'cert-2',
        title: 'Certified Architect',
        issuerId: 'issuer-1',
        recipientEmail: 'old@example.com',
        recipientName: 'Old Owner',
        status: 'active',
      };
      certRepo.findOne.mockResolvedValue(mockCert);
      userRepo.findOne.mockResolvedValue(null);

      const dto = {
        certificateId: 'cert-2',
        newOwnerEmail: 'unregistered@example.com',
        newOwnerName: 'Unregistered Owner',
        reason: 'Handover',
      };

      const result = await service.initiateTransfer(
        dto,
        { id: 'issuer-1', role: UserRole.ISSUER },
        '127.0.0.1',
      );

      // No recipient user notification, but email still goes out to toEmail
      expect(notificationsService.createNotification).not.toHaveBeenCalledWith(
        expect.anything(),
        NotificationType.INFO,
        'Certificate Transfer Confirmation Code',
        expect.anything(),
      );
      expect(emailService.sendTransferConfirmationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'unregistered@example.com',
          confirmationCode: result.confirmationCode,
        }),
      );
    });

    it('logs a confirmation email failure without failing the transfer', async () => {
      const mockCert = {
        id: 'cert-3',
        title: 'Certified Dev',
        issuerId: 'issuer-1',
        recipientEmail: 'old@example.com',
        recipientName: 'Old Owner',
        status: 'active',
      };
      certRepo.findOne.mockResolvedValue(mockCert);
      userRepo.findOne.mockResolvedValue(null);
      emailService.sendTransferConfirmationCode.mockRejected(
        new Error('SMTP down'),
      );

      const dto = {
        certificateId: 'cert-3',
        newOwnerEmail: 'newowner@example.com',
        newOwnerName: 'New Owner',
        reason: 'Handover',
      };

      await expect(
        service.initiateTransfer(
          dto,
          { id: 'issuer-1', role: UserRole.ISSUER },
          '127.0.0.1',
        ),
      ).resolves.toBeDefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('approveTransfer', () => {
    it('notifies both approver and recipient (toEmail) on completion', async () => {
      const mockTransfer = {
        id: 'transfer-1',
        certificateId: 'cert-1',
        fromEmail: 'old@example.com',
        fromName: 'Old Owner',
        toEmail: 'newowner@example.com',
        toName: 'New Owner',
        confirmationCode: '123456',
        status: TransferStatus.PENDING,
        certificate: {
          id: 'cert-1',
          title: 'Blockchain Certified Developer',
          issuerId: 'issuer-1',
          recipientEmail: 'old@example.com',
          recipientName: 'Old Owner',
          status: 'active',
          metadata: {},
        },
      };

      transferRepo.findOne.mockResolvedValue(mockTransfer);
      certRepo.findOne.mockResolvedValue(mockTransfer.certificate);

      const recipientUser = {
        id: 'user-recipient-99',
        email: 'newowner@example.com',
        firstName: 'New',
      };
      userRepo.findOne.mockResolvedValue(recipientUser);

      await service.approveTransfer(
        'transfer-1',
        '123456',
        { id: 'approver-1', role: UserRole.ADMIN },
        '127.0.0.1',
      );

      // Approver notification
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'approver-1',
        NotificationType.SUCCESS,
        'Certificate Transfer Completed',
        expect.stringContaining('newowner@example.com'),
      );

      // Recipient user notification
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'user-recipient-99',
        NotificationType.SUCCESS,
        'Certificate Transfer Completed',
        expect.stringContaining('successfully transferred to your account'),
      );

      // Completion email to new owner
      expect(emailService.sendTransferCompletedNotice).toHaveBeenCalledWith({
        to: 'newowner@example.com',
        recipientName: 'New Owner',
        certificateTitle: 'Blockchain Certified Developer',
        certificateId: 'cert-1',
      });
    });

    it('still sends the completion email to toEmail when the recipient has no account', async () => {
      const mockTransfer = {
        id: 'transfer-2',
        certificateId: 'cert-2',
        fromEmail: 'old@example.com',
        fromName: 'Old Owner',
        toEmail: 'unregistered@example.com',
        toName: 'Unregistered',
        confirmationCode: '654321',
        status: TransferStatus.PENDING,
        certificate: {
          id: 'cert-2',
          title: 'Certified Architect',
          issuerId: 'issuer-1',
          recipientEmail: 'old@example.com',
          recipientName: 'Old Owner',
          status: 'active',
          metadata: {},
        },
      };

      transferRepo.findOne.mockResolvedValue(mockTransfer);
      certRepo.findOne.mockResolvedValue(mockTransfer.certificate);
      userRepo.findOne.mockResolvedValue(null);

      await service.approveTransfer(
        'transfer-2',
        '654321',
        { id: 'approver-1', role: UserRole.ADMIN },
        '127.0.0.1',
      );

      // No recipient user notification, but completion email still goes out
      expect(notificationsService.createNotification).not.toHaveBeenCalledWith(
        expect.anything(),
        NotificationType.SUCCESS,
        'Certificate Transfer Completed',
        expect.stringContaining('your account'),
      );
      expect(emailService.sendTransferCompletedNotice).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'unregistered@example.com' }),
      );
    });

    it('rejects the transfer when the confirmation code is invalid', async () => {
      const mockTransfer = {
        id: 'transfer-3',
        certificateId: 'cert-3',
        fromEmail: 'old@example.com',
        toEmail: 'newowner@example.com',
        confirmationCode: '111111',
        status: TransferStatus.PENDING,
        certificate: {
          id: 'cert-3',
          title: 'Certified Dev',
          issuerId: 'issuer-1',
          recipientEmail: 'old@example.com',
          recipientName: 'Old Owner',
          status: 'active',
          metadata: {},
        },
      };
      transferRepo.findOne.mockResolvedValue(mockTransfer);

      await expect(
        service.approveTransfer(
          'transfer-3',
          'wrong-code',
          { id: 'approver-1', role: UserRole.ADMIN },
          '127.0.0.1',
        ),
      ).rejectsToThrow('Invalid confirmation code');
      expect(certRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('rejectTransfer', () => {
    it('notifies the intended new owner (toEmail) on rejection', async () => {
      const mockTransfer = {
        id: 'transfer-4',
        certificateId: 'cert-4',
        fromEmail: 'old@example.com',
        toEmail: 'newowner@example.com',
        confirmationCode: '222222',
        initiatedBy: 'issuer-1',
        status: TransferStatus.PENDING,
        certificate: {
          id: 'cert-4',
          title: 'Certified Dev',
          issuerId: 'issuer-1',
          recipientEmail: 'old@example.com',
          recipientName: 'Old Owner',
          status: 'active',
          metadata: {},
        },
      };
      transferRepo.findOne.mockResolvedValue(mockTransfer);
      userRepo.findOne.mockResolvedValue({
        id: 'user-recipient-99',
        email: 'newowner@example.com',
      });

      await service.rejectTransfer(
        'transfer-4',
        'Wrong recipient',
        { id: 'issuer-1', role: UserRole.ISSUER },
        '127.0.0.1',
      );

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'user-recipient-99',
        NotificationType.WARNING,
        'Certificate Transfer Rejected',
        expect.stringContaining('was rejected'),
      );
    });
  });
});
