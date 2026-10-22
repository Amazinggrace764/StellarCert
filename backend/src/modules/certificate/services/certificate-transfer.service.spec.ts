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
  });

  describe('approveTransfer', () => {
    it('rejects completion when certificate owner no longer matches transfer.fromOwner (double-transfer)', async () => {
      const mockTransfer = {
        id: 'transfer-2',
        certificateId: 'cert-1',
        fromOwner: 'owner-a',
        fromEmail: 'a@example.com',
        fromName: 'Owner A',
        toEmail: 'c@example.com',
        toName: 'Owner C',
        confirmationCode: '654321',
        status: TransferStatus.PENDING,
      };

      transferRepo.findOne.mockResolvedValue(mockTransfer);
      // Certificate was already transferred to owner B by a prior completion.
      certRepo.findOne.mockResolvedValue({
        id: 'cert-1',
        title: 'Blockchain Certified Developer',
        issuerId: 'issuer-1',
        owner: 'owner-b',
        recipientEmail: 'b@example.com',
        recipientName: 'Owner B',
        status: 'active',
        metadata: {},
      });

      await expect(
        service.approveTransfer(
          'transfer-2',
          '654321',
          { id: 'approver-1', role: UserRole.ADMIN },
          '127.0.0.1',
        ),
      ).rejects.toThrow();

      expect(certRepo.save).not.toHaveBeenCalled();
      expect(emailService.sendTransferCompletedNotice).not.toHaveBeenCalled();
    });

    it('rejects completion when certificate is no longer active', async () => {
      const mockTransfer = {
        id: 'transfer-3',
        certificateId: 'cert-1',
        fromOwner: 'owner-a',
        fromEmail: 'a@example.com',
        fromName: 'Owner A',
        toEmail: 'b@example.com',
        toName: 'Owner B',
        confirmationCode: '111111',
        status: TransferStatus.PENDING,
      };

      transferRepo.findOne.mockResolvedValue(mockTransfer);
      certRepo.findOne.mockResolvedValue({
        id: 'cert-1',
        title: 'Blockchain Certified Developer',
        issuerId: 'issuer-1',
        owner: 'owner-a',
        recipientEmail: 'a@example.com',
        recipientName: 'Owner A',
        status: 'revoked',
        metadata: {},
      });

      await expect(
        service.approveTransfer(
          'transfer-3',
          '111111',
          { id: 'approver-1', role: UserRole.ADMIN },
          '127.0.0.1',
        ),
      ).rejects.toThrow();

      expect(certRepo.save).not.toHaveBeenCalled();
      expect(emailService.sendTransferCompletedNotice).not.toHaveBeenCalled();
    });

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
  });
});
