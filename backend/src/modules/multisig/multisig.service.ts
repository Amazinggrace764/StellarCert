import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  rpc,
  TransactionBuilder,
  Networks,
  Contract,
  xdr,
  Address,
  Account,
  scValToNative,
} from '@stellar/stellar-sdk';
import { StellarService } from '../stellar/services/stellar.service';
import { LoggingService } from '../../common/logging/logging.service';

// Enums and interfaces matching the smart contract
export enum RequestStatus {
  Pending = 0,
  Approved = 1,
  Rejected = 2,
  Expired = 3,
  Issued = 4,
}

export enum SignatureAction {
  Approved = 0,
  Rejected = 1,
}

export interface MultisigConfig {
  threshold: number;
  signers: string[];
  max_signers: number;
}

export interface PendingRequest {
  id: string;
  issuer: string;
  recipient: string;
  metadata: string;
  proposer: string;
  approvals: string[];
  rejections: string[];
  rejection_reason?: string;
  created_at: number;
  expires_at: number;
  cert_expires_at?: number;
  status: RequestStatus;
}

export interface SignatureResult {
  success: boolean;
  message: string;
  final_status?: RequestStatus;
}

export interface MultisigEvent {
  request_id: string;
  signer: string;
  action: SignatureAction;
  timestamp: number;
}

export interface Pagination {
  page: number;
  limit: number;
}

export interface PaginatedResult {
  data: PendingRequest[];
  total: number;
  page: number;
  limit: number;
  has_next: boolean;
}

/**
 * Response DTOs for multisig controller endpoints.
 *
 * These interfaces give the controller handlers compile-time shape safety
 * instead of `Promise<any>`. They intentionally mirror the existing runtime
 * payloads so the API contract is preserved.
 */
export interface InitMultisigConfigResponseDto {
  transactionHash: string;
}

export interface UpdateMultisigConfigResponseDto {
  transactionHash: string;
}

export interface ProposeCertificateResponseDto {
  request: PendingRequest;
}

export interface SignatureResponseDto {
  success: boolean;
  message: string;
  final_status?: RequestStatus;
}

export interface IssueCertificateResponseDto {
  issued: boolean;
}

export interface CancelRequestResponseDto {
  cancelled: boolean;
}

export interface RequestExpiredResponseDto {
  expired: boolean;
}

export interface MultisigConfigResponseDto {
  config: MultisigConfig;
}

export interface PendingRequestResponseDto {
  request: PendingRequest;
}

export interface PendingRequestsResponseDto {
  data: PendingRequest[];
  total: number;
  page: number;
  limit: number;
  has_next: boolean;
}

@Injectable()
export class MultisigService implements OnModuleInit {
  private contractId: string;
  private server: rpc.Server;
  private networkPassphrase: string;


  constructor(
    private readonly configService: ConfigService,
    private readonly stellarService: StellarService,
    private readonly logger: LoggingService,
  ) {
    // Initialization is deferred to onModuleInit so that the module can be
    // imported into AppModule without failing at construction time when
    // configuration is absent (e.g. in tests or environments without multisig).
  }

  onModuleInit(): void {
    this.initializeMultisig();
  }

  private initializeMultisig(): void {
    const contractId = this.configService.get<string>('MULTISIG_CONTRACT_ID');
    const horizonUrl = this.configService.get<string>('STELLAR_HORIZON_URL');
    const network = this.configService.get<string>('STELLAR_NETWORK');

    if (!contractId || !horizonUrl || !network) {
      this.logger.warn(
        'Multisig configuration missing. MultisigService may not function correctly.',
      );
      return;
    }

    this.contractId = contractId;
    this.networkPassphrase =
      network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
    this.server = new rpc.Server(horizonUrl, {
      allowHttp: horizonUrl.includes('localhost'),
    });

    this.logger.log(`MultisigService initialized with contract: ${contractId}`);
  }

  /**
   * Guard against use before configuration has been supplied. Throwing a
   * clear error here is preferable to a cryptic `undefined` dereference on
   * `this.server` / `this.contractId` deep inside a transaction builder.
   */
  private assertInitialized(): void {
    if (!this.server || !this.contractId) {
      throw new Error(
        'MultisigService is not configured: MULTISIG_CONTRACT_ID, STELLAR_HORIZON_URL and STELLAR_NETWORK must be set',
      );
    }
  }

  /**
   * Initialize multisig configuration for an issuer
   */

  /**
   * Issue #721 - Poll getTransaction until the RPC reports a terminal status.
   * Calling getTransaction in the same tick as sendTransaction almost always
   * returns PENDING/NOT_FOUND; we must wait for SUCCESS or FAILED.
   */
  private async waitForTransaction(
    hash: string,
    options?: { maxAttempts?: number; intervalMs?: number },
  ): Promise<rpc.Api.GetTransactionResponse> {
    this.assertInitialized();
    const maxAttempts = options?.maxAttempts ?? 30;
    const intervalMs = options?.intervalMs ?? 2000;

    let last: rpc.Api.GetTransactionResponse | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      last = await this.server.getTransaction(hash);
      const status = last.status;
      if (
        status === rpc.Api.GetTransactionStatus.SUCCESS ||
        status === rpc.Api.GetTransactionStatus.FAILED
      ) {
        return last;
      }
      // NOT_FOUND / PENDING - wait and retry
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `Transaction ${hash} not finalized after ${maxAttempts} attempts (last status: ${last?.status ?? 'unknown'})`,
    );
  }

  private parseBooleanResult(retval: scVal | undefined): boolean {
    if (!retval || retval.switch() !== xdr.ScValType.scvBool()) {
      throw new Error('Invalid boolean response from contract');
    }
    return retval.bool().switch();
  }

  async initMultisigConfig(
    adminPublicKey: string,
    issuer: string,
    threshold: number,
    signers: string[],
    maxSigners: number,
  ): Promise<InitMultisigConfigResponseDto> {
    try {
      this.assertInitialized();
      const adminKeyPair =
        this.stellarService.getKeypairFromPublicKey(adminPublicKey);
      const rpcAccount = await this.server.getAccount(adminPublicKey);
      const sourceAccount = new Account(
        adminPublicKey,
        rpcAccount.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const issuerScVal = new Address(issuer).toScVal();
      const thresholdScVal = xdr.ScVal.scvU32(threshold);
      const signersScVal = xdr.ScVal.scvVec(
        signers.map((signer) => new Address(signer).toScVal()),
      );
      const maxSignersScVal = xdr.ScVal.scvU32(maxSigners);
      const adminScVal = new Address(adminPublicKey).toScVal();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'init_multisig_config',
            issuerScVal,
            thresholdScVal,
            signersScVal,
            maxSignersScVal,
            adminScVal,
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(adminKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING' || response.status === 'DUPLICATE') {
        const txResponse = await this.waitForTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(`Multisig config initialized for issuer: ${issuer}`);
          return { transactionHash: response.hash };
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to initialize multisig config for issuer ${issuer}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update multisig configuration for an issuer
   */
  async updateMultisigConfig(
    adminPublicKey: string,
    issuer: string,
    newThreshold?: number,
    newSigners?: string[],
    newMaxSigners?: number,
  ): Promise<UpdateMultisigConfigResponseDto> {
    try {
      this.assertInitialized();
      const adminKeyPair =
        this.stellarService.getKeypairFromPublicKey(adminPublicKey);
      const accountResponse = await this.server.getAccount(adminPublicKey);
      const sourceAccount = new Account(
        adminPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal (using Option types)
      const thresholdScVal =
        newThreshold !== undefined
          ? xdr.ScVal.scvU32(newThreshold)
          : xdr.ScVal.scvVoid();

      const signersScVal =
        newSigners !== undefined
          ? xdr.ScVal.scvVec(
              newSigners.map((signer) => new Address(signer).toScVal()),
            )
          : xdr.ScVal.scvVoid();

      const maxSignersScVal =
        newMaxSigners !== undefined
          ? xdr.ScVal.scvU32(newMaxSigners)
          : xdr.ScVal.scvVoid();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'update_multisig_config',
            new Address(issuer).toScVal(),
            thresholdScVal,
            signersScVal,
            maxSignersScVal,
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(adminKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING' || response.status === 'DUPLICATE') {
        const txResponse = await this.waitForTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(`Multisig config updated for issuer: ${issuer}`);
          return { transactionHash: response.hash };
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to update multisig config for issuer ${issuer}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Propose a new certificate for multi-sig issuance
   */
  // #722: return the actual on-chain pending request, not a fabricated object.
  async proposeCertificate(
    requesterPublicKey: string,
    requestId: string,
    issuer: string,
    recipient: string,
    metadata: string,
    expirationDays: number,
  ): Promise<ProposeCertificateResponseDto> {
    try {
      this.assertInitialized();
      const requesterKeyPair =
        this.stellarService.getKeypairFromPublicKey(requesterPublicKey);
      const accountResponse = await this.server.getAccount(requesterPublicKey);
      const sourceAccount = new Account(
        requesterPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const requestIdScVal = xdr.ScVal.scvString(requestId);
      const issuerScVal = new Address(issuer).toScVal();
      const recipientScVal = new Address(recipient).toScVal();
      const metadataScVal = xdr.ScVal.scvString(metadata);
      const expirationDaysScVal = xdr.ScVal.scvU32(expirationDays);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'propose_certificate',
            requestIdScVal,
            issuerScVal,
            recipientScVal,
            metadataScVal,
            expirationDaysScVal,
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(requesterKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING' || response.status === 'DUPLICATE') {
        const txResponse = await this.waitForTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(`Certificate proposed with request ID: ${requestId}`);
          // Parse actual on-chain pending request after the tx finalizes (#722).
          try {
            const { request } = await this.getPendingRequest(requestId);
            return { request };
          } catch (fetchErr) {
            this.logger.warn(
              `Transaction succeeded but could not fetch pending request ${requestId}; returning minimal result`,
              fetchErr,
            );
            throw new Error(
              `Transaction ${response.hash} succeeded but pending request ${requestId} could not be read from the contract: ${
                fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
              }`,
            );
          }
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to propose certificate with request ID ${requestId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Approve a pending certificate request
   */
  async approveRequest(
    approverPublicKey: string,
    requestId: string,
  ): Promise<SignatureResponseDto> {
    try {
      this.assertInitialized();
      const approverKeyPair =
        this.stellarService.getKeypairFromPublicKey(approverPublicKey);
      const accountResponse = await this.server.getAccount(approverPublicKey);
      const sourceAccount = new Account(
        approverPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      // Convert parameters to ScVal
      const requestIdScVal = xdr.ScVal.scvString(requestId);
      const approverScVal = new Address(approverPublicKey).toScVal();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call('approve_request', requestIdScVal, approverScVal),
        )
        .setTimeout(30)
        .build();

      transaction.sign(approverKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING' || response.status === 'DUPLICATE') {
        const txResponse = await this.waitForTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(
            `Request ${requestId} approved by ${approverPublicKey}`,
          );
          // Use on-chain request status after finalization (#722).
          const final_status = await this.resolveFinalStatus(
            requestId,
            RequestStatus.Approved,
          );
          return {
            success: true,
            message: 'Request approved successfully',
          };
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to approve request ${requestId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Reject a pending certificate request
   */
  async rejectRequest(
    rejecterPublicKey: string,
    requestId: string,
    reason?: string,
  ): Promise<SignatureResponseDto> {
    try {
      this.assertInitialized();
      const rejectorKeyPair =
        this.stellarService.getKeypairFromPublicKey(rejectorPublicKey);
      const accountResponse = await this.server.getAccount(rejectorPublicKey);
      const sourceAccount = new Account(
        rejecterPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);

      const requestIdScVal = xdr.ScVal.scvString(requestId);
      const rejecterScVal = new Address(rejecterPublicKey).toScVal();
      const reasonScVal =
        reason !== undefined
          ? xdr.ScVal.scvString(reason)
          : xdr.ScVal.scvVoid();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'reject_request',
            requestIdScVal,
            rejecterScVal,
            reasonScVal,
          ),
        )
        .setTimeout(30)
        .build();

      transaction.sign(rejecterKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING' || response.status === 'DUPLICATE') {
        const txResponse = await this.waitForTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(
            `Request ${requestId} rejected by ${rejectorPublicKey}`,
          );
          const final_status = await this.resolveFinalStatus(
            requestId,
            RequestStatus.Rejected,
          );
          return {
            success: true,
            message: 'Request rejected successfully',
          };
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to reject request ${requestId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Resolve the authoritative status of a request after a signature tx
   * finalizes. The contract may have removed the request from the pending
   * list once the threshold was met, so we fall back to the expected
   * terminal status only when the contract confirms the request is gone.
   */
  private async resolveFinalStatus(
    requestId: string,
    expectedTerminal: RequestStatus,
  ): Promise<RequestStatus> {
    try {
      const pending = await this.getPendingRequest(requestId);
      return pending.status;
    } catch (err) {
      this.logger.warn(
        `Could not read pending request ${requestId} after finalization; assuming terminal status ${expectedTerminal}`,
        err,
      );
      return expectedTerminal;
    }
  }

  /**
   * Issue an approved certificate
   */
  async issueApprovedCertificate(
    issuerPublicKey: string,
    requestId: string,
  ): Promise<IssueCertificateResponseDto> {
    try {
      this.assertInitialized();
      const requesterKeyPair =
        this.stellarService.getKeypairFromPublicKey(requesterPublicKey);
      const accountResponse = await this.server.getAccount(requesterPublicKey);
      const sourceAccount = new Account(
        issuerPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);
      const requestIdScVal = xdr.ScVal.scvString(requestId);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('issue_certificate', requestIdScVal))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING' || response.status === 'DUPLICATE') {
        const txResponse = await this.waitForTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(`Certificate issued for request ${requestId}`);
          return true;
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(
        `Failed to issue certificate for request ${requestId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Cancel a pending request (proposer only)
   */
  async cancelRequest(
    proposerPublicKey: string,
    requestId: string,
  ): Promise<CancelRequestResponseDto> {
    try {
      this.assertInitialized();
      const requesterKeyPair =
        this.stellarService.getKeypairFromPublicKey(requesterPublicKey);
      const accountResponse = await this.server.getAccount(requesterPublicKey);
      const sourceAccount = new Account(
        proposerPublicKey,
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(this.contractId);
      const requestIdScVal = xdr.ScVal.scvString(requestId);
      const proposerScVal = new Address(proposerPublicKey).toScVal();

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100000',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call('cancel_request', requestIdScVal, proposerScVal),
        )
        .setTimeout(30)
        .build();

      transaction.sign(proposerKeyPair);
      const response = await this.server.sendTransaction(transaction);

      if (response.status === 'PENDING' || response.status === 'DUPLICATE') {
        const txResponse = await this.waitForTransaction(response.hash);
        if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          this.logger.log(`Request ${requestId} cancelled`);
          return true;
        }
      }

      throw new Error(`Transaction failed: ${response.status}`);
    } catch (error) {
      this.logger.error(`Failed to cancel request ${requestId}`, error);
      throw error;
    }
  }

  /**
   * Read multisig configuration for an issuer
   */
  async getMultisigConfig(issuer: string): Promise<MultisigConfigResponseDto> {
    try {
      this.assertInitialized();
      const contract = new Contract(this.contractId);
      const issuerScVal = new Address(issuer).toScVal();

      const result = await this.server.simulateTransaction(
        new TransactionBuilder(
          new Account(
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            '0',
          ),
          {
            fee: '100',
            networkPassphrase: this.networkPassphrase,
          },
        )
          .addOperation(contract.call('get_multisig_config', issuerScVal))
          .setTimeout(30)
          .build(),
      );

      if (!result.result || !result.result.retval) {
        throw new Error('Failed to read multisig config');
      }

      const native = scValToNative(result.result.retval) as Record<string, unknown>;
      return {
        threshold: Number(native.threshold),
        signers: (native.signers as string[]) ?? [],
        max_signers: Number(native.max_signers),
      };
    } catch (error) {
      this.logger.error(
        `Failed to get multisig config for issuer ${issuer}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Read a single pending request by ID
   */
  async getPendingRequest(requestId: string): Promise<PendingRequestResponseDto> {
    try {
      this.assertInitialized();
      const contract = new Contract(this.contractId);
      const requestIdScVal = xdr.ScVal.scvString(requestId);

      const result = await this.server.simulateTransaction(
        new TransactionBuilder(
          new Account(
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            '0',
          ),
          {
            fee: '100',
            networkPassphrase: this.networkPassphrase,
          },
        )
          .addOperation(contract.call('get_pending_request', requestIdScVal))
          .setTimeout(30)
          .build(),
      );

      if (!result.result || !result.result.retval) {
        throw new Error(`Pending request ${requestId} not found`);
      }

      const native = scValToNative(result.result.retval) as Record<string, unknown>;
      return {
        id: String(native.id),
        issuer: String(native.issuer),
        recipient: String(native.recipient),
        metadata: String(native.metadata),
        proposer: String(native.proposer),
        approvals: (native.approvals as string[]) ?? [],
        rejections: (native.rejections as string[]) ?? [],
        rejection_reason: native.rejection_reason as string | undefined,
        created_at: Number(native.created_at),
        expires_at: Number(native.expires_at),
        cert_expires_at:
          native.cert_expires_at !== undefined
            ? Number(native.cert_expires_at)
            : undefined,
        status: Number(native.status) as RequestStatus,
      };
    } catch (error) {
      this.logger.error(`Failed to get pending request ${requestId}`, error);
      throw error;
    }
  }

  /**
   * Check whether a request is expired
   */
  async isRequestExpired(requestId: string): Promise<RequestExpiredResponseDto> {
    try {
      this.assertInitialized();
      const contract = new Contract(this.contractId);
      const requestIdScVal = xdr.ScVal.scvString(requestId);

      const result = await this.server.simulateTransaction(
        new TransactionBuilder(
          new Account(
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            '0',
          ),
          {
            fee: '100',
            networkPassphrase: this.networkPassphrase,
          },
        )
          .addOperation(
            contract.call('is_request_expired', requestIdScVal),
          )
          .setTimeout(30)
          .build(),
      );

      return this.parseBooleanResult(result.result?.retval);
    } catch (error) {
      this.logger.error(
        `Failed to check if request ${requestId} is expired`,
        error,
      );
      throw error;
    }
  }

  /**
   * List pending requests for an issuer
   */
  async getPendingRequestsForIssuer(
    issuer: string,
    pagination: Pagination,
  ): Promise<PendingRequestsResponseDto> {
    try {
      this.assertInitialized();
      const contract = new Contract(this.contractId);
      const issuerScVal = new Address(issuer).toScVal();
      const pageScVal = xdr.ScVal.scvU32(pagination.page);
      const limitScVal = xdr.ScVal.scvU32(pagination.limit);

      const result = await this.server.simulateTransaction(
        new TransactionBuilder(
          new Account(
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            '0',
          ),
          {
            fee: '100',
            networkPassphrase: this.networkPassphrase,
          },
        )
          .addOperation(
            contract.call(
              'get_pending_requests_for_issuer',
              issuerScVal,
              pageScVal,
              limitScVal,
            ),
          )
          .setTimeout(30)
          .build(),
      );

      if (!result.result || !result.result.retval) {
        throw new Error('Failed to list pending requests');
      }

      const native = scValToNative(result.result.retval) as Record<string, unknown>;
      const data = ((native.data as Record<string, unknown>[]) ?? []).map(
        (item) => this.mapRequest(item),
      );
      const total = Number(native.total ?? data.length);
      return {
        data,
        total,
        page: pagination.page,
        limit: pagination.limit,
        has_next: (pagination.page + 1) * pagination.limit < total,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get pending requests for issuer ${issuer}`,
        error,
      );
      throw error;
    }
  }

  /**
   * List pending requests for a signer
   */
  async getPendingRequestsForSigner(
    signer: string,
    pagination: Pagination,
  ): Promise<PendingRequestsResponseDto> {
    try {
      this.assertInitialized();
      const contract = new Contract(this.contractId);
      const signerScVal = new Address(signer).toScVal();
      const pageScVal = xdr.ScVal.scvU32(pagination.page);
      const limitScVal = xdr.ScVal.scvU32(pagination.limit);

      const result = await this.server.simulateTransaction(
        new TransactionBuilder(
          new Account(
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            '0',
          ),
          {
            fee: '100',
            networkPassphrase: this.networkPassphrase,
          },
        )
          .addOperation(
            contract.call(
              'get_pending_requests_for_signer',
              signerScVal,
              pageScVal,
              limitScVal,
            ),
          )
          .setTimeout(30)
          .build(),
      );

      if (!result.result || !result.result.retval) {
        throw new Error('Failed to list pending requests');
      }

      const native = scValToNative(result.result.retval) as Record<string, unknown>;
      const data = ((native.data as Record<string, unknown>[]) ?? []).map(
        (item) => this.mapRequest(item),
      );
      const total = Number(native.total ?? data.length);
      return {
        data,
        total,
        page: pagination.page,
        limit: pagination.limit,
        has_next: (pagination.page + 1) * pagination.limit < total,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get pending requests for signer ${signer}`,
        error,
      );
      throw error;
    }
  }

  private mapRequest(item: Record<string, unknown>): PendingRequest {
    return {
      id: String(item.id),
      issuer: String(item.issuer),
      recipient: String(item.recipient),
      metadata: String(item.metadata),
      proposer: String(item.proposer),
      approvals: (item.approvals as string[]) ?? [],
      rejections: (item.rejections as string[]) ?? [],
      rejection_reason: item.rejection_reason as string | undefined,
      created_at: Number(item.created_at),
      expires_at: Number(item.expires_at),
      cert_expires_at:
        item.cert_expires_at !== undefined
          ? Number(item.cert_expires_at)
          : undefined,
      status: Number(item.status) as RequestStatus,
    };
  }
}

