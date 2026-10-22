import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Contract,
  TransactionBuilder,
  Networks,
  Keypair,
  Address,
  xdr,
  nativeToScVal,
  scValToNative,
  StrKey,
} from '@stellar/stellar-sdk';
import { LoggingService } from '../../../common/logging/logging.service';

export interface ContractDeploymentResult {
  contractId: string;
  transactionHash: string;
  successful: boolean;
}

export interface CertificateContractData {
  id: string;
  issuer: string;
  owner: string;
  status: string;
  metadataUri: string;
  issuedAt: number;
  expiresAt?: number;
}

export interface MultisigRequest {
  id: string;
  issuer: string;
  recipient: string;
  metadata: string;
  proposer: string;
  approvals: string[];
  rejections: string[];
  createdAt: number;
  expiresAt: number;
  status: string;
}

/**
 * Soroban TTL is measured in ledgers, not seconds. On the Stellar
n * mainnet, ledgers close roughly every 5 seconds. To avoid conflating
t * seconds with ledgers (the old `DEFAULT_TTL = 30 * 24 * 60 * 60` was
t * roughly 5x too large as a ledger count), all TTL conversions go through
t * the helpers below.
t */
export const LEDGER_CLOSE_TIME_SECONDS = 5;
export const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Convert a seconds duration into a count of ledgers, rounding up.
 * Rounding up ensures the requested horizon is never shortened.
 */
export function secondsToLedgers(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Invalid seconds duration: ${seconds}`);
  }
  return Math.ceil(seconds / LEDGER_CLOSE_TIME_SECONDS);
}

/**
 * Default TTL extension for persistent writes: 30 days expressed in
 * ledgers (30 * 24 * 60 * 60 / 5 = 518,400 ledgers).
 */
export const DEFAULT_TTL_LEDGERS = secondsToLedgers(30 * SECONDS_PER_DAY);

export const DEFAULT_TTL_SECONDS = 30 * SECONDS_PER_DAY;

@injectable()
export class SorobanService implements OnModuleInit {
  private server: any;
  private networkPassphrase: string;
  private adminKeypair: Keypair;
  private certificateContractId: string;
  private multisigContractId: string;
  private crlContractId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggingService,
  ) {}

  onModuleInit() {
    this.initializeSoroban();
  }

  private initializeSoroban() {
    const rpcUrl = this.configService.get<string>('SOROBAN_RPC_URL');
    const network = this.configService.get<string>('STELLAR_NETWORK');
    const adminSecret = this.configService.get<string>('SOROBAN_ADMIN_SECRET');
    this.certificateContractId =
      this.configService.get<string>('CERTIFICATE_CONTRACT_ID') || '';
    this.multisigContractId =
      this.configService.get<string>('MULTISIG_CONTRACT_ID') || '';
    this.crlContractId =
      this.configService.get<string>('CRL_CONTRACT_ID') || '';

    if (!rpcUrl || !network || !adminSecret) {
      this.logger.warn(
        'Soroban configuration missing. SorobanService may not function correctly.',
      );
      return;
    }

    this.server = new (require('@stellar/stellar-sdk').rpc.Server)(rpcUrl, {
      allowHttp: rpcUrl.includes('localhost'),
    });
    this.networkPassphrase =
      network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

    try {
      this.adminKeypair = Keypair.fromSecret(adminSecret);
    } catch (e) {
      this.logger.error('Invalid Soroban Admin Secret Key provided.');
    }

    this.logger.log(`SorobanService initialized on ${network}`);
  }

  /**
   * Deploy a new contract instance
   */
  async deployContract(wasmHash: string): Promise<ContractDeploymentResult> {
    try {
      if (!this.adminKeypair) {
        throw new Error('Admin keypair not configured.');
      }

      const sourceAccount = await this.server.getAccount(
        this.adminKeypair.publicKey(),
      );

      const contract = new Contract(wasmHash);

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          (contract as any).deploy({
            wasmHash: Buffer.from(wasmHash, 'hex'),
          }),
        )
        .setTimeout(30)
        .build();

      transaction.sign(this.adminKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      if (txResponse.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${txResponse.status}`);
      }

      const contractId =
        txResponse.returnValue?._value?._value?.toString('hex');

      return {
        contractId: contractId || '',
        transactionHash: result.hash,
        successful: true,
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Contract deployment failed: ${message}`);
      return {
        contractId: '',
        transactionHash: '',
        successful: false,
      };
    }
  }

  /**
   * Initialize the certificate contract
   */
  async initializeCertificateContract(adminAddress: string): Promise<boolean> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);
      const admin = Address.fromString(adminAddress);

      const sourceAccount = await this.server.getAccount(
        this.adminKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('initialize', nativeToScVal(admin)))
        .setTimeout(30)
        .build();

      transaction.sign(this.adminKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      return txResponse.status === 'SUCCESS';
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Certificate contract initialization failed: ${message}`,
      );
      return false;
    }
  }

  /**
   * Add an authorized issuer to the certificate contract
   */
  async addIssuer(issuerAddress: string): Promise<boolean> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);
      const issuer = Address.fromString(issuerAddress);

      const sourceAccount = await this.server.getAccount(
        this.adminKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('add_issuer', nativeToScVal(issuer)))
        .setTimeout(30)
        .build();

      transaction.sign(this.adminKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      return txResponse.status === 'SUCCESS';
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Add issuer failed: ${message}`);
      return false;
    }
  }

  /**
   * Issue a certificate on-chain.
   *
   * @param ttlLedgers Optional TTL extension in ledgers. Defaults to
   *   the 30-day `DEFAULT_TTL_LEDDERS` constant. This value is in ledgers,
   *   not seconds.
   *
   * @returns the Soroban transaction hash once the ledger confirms the
   *   transaction with `SUCCESS`, or `null` when issuance failed. Callers
   *   must treat `null` as a failure and must not record a transaction hash.
   */
  async issueCertificate(
    id: string,
    issuerAddress: string,
    ownerAddress: string,
    metadataUri: string,
    expiresAt?: number,
    ttlLedgers: number = DEFAULT_TTL_LEDGERS,
  ): Promise<string | null> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      if (!Number.isFinite(ttlLedgers) || ttlLedgers <= 0) {
        throw new Error(`Invalid TTL ledgers: ${ttlLedgers}`);
      }

      const contract = new Contract(this.certificateContractId);
      const issuer = Address.fromString(issuerAddress);
      const owner = Address.fromString(ownerAddress);

      // Get issuer's keypair for signing (this would need to be passed or retrieved)
      const issuerKeypair = this.getIssuerKeypair(issuerAddress);
      const sourceAccount = await this.server.getAccount(
        issuerKeypair.publicKey(),
      );

      const args = [
        nativeToScVal(id),
        nativeToScVal(issuer),
        nativeToScVal(owner),
        nativeToScVal(metadataUri),
        expiresAt ? nativeToScVal(expiresAt) : nativeToScVal(null),
        nativeToScVal(ttlLedgers),
      ];

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('issue_certificate', ...args))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      if (txResponse.status !== 'SUCCESS') {
        this.logger.error(
          `Certificate issuance transaction ${result.hash} ended with status ${txResponse.status}`,
        );
        return null;
      }

      return result.hash;
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Certificate issuance failed: ${message}`);
      return null;
    }
  }

  /**
   * Revoke a certificate on-chain
   */
  async revokeCertificate(
    id: string,
    issuerAddress: string,
    reason: string,
  ): Promise<boolean> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);

      const issuerKeypair = this.getIssuerKeypair(issuerAddress);
      const sourceAccount = await this.server.getAccount(
        issuerKeypair.publicKey(),
      );

      const args = [nativeToScVal(id), nativeToScVal(reason)];

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('revoke_certificate', ...args))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      return txResponse.status === 'SUCCESS';
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Certificate revocation failed: ${message}`);
      return false;
    }
  }

  /**
   * Get certificate data from the contract
   */
  async getCertificate(id: string): Promise<CertificateContractData | null> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);

      const sourceAccount = await this.server.getAccount(
        this.adminKeypair.publicKey(),
      );

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('get_certificate', nativeToScVal(id)))
        .setTimeout(30)
        .build();

      transaction.sign(this.adminKeypair);

      const result = await this.server.sendTransaction(transaction);

      if (result.status !== 'PENDING') {
        throw new Error(`Transaction failed: ${result.status}`);
      }

      // Poll until the ledger confirms the transaction
      const txResponse = await this.pollTransaction(result.hash);

      if (txResponse.status !== 'SUCCESS' || !txResponse.returnValue) {
        return null;
      }

      const certificateData = scValToNative(txResponse.returnValue);

      return {
        id: certificateData.id,
        issuer: certificateData.issuer.toString(),
        owner: certificateData.owner.toString(),
        status: certificateData.status,
        metadataUri: certificateData.metadataUri,
        issuedAt: Number(certificateData.issuedAt),
        expiresAt: certificateData.expiresAt
          ? Number(certificateData.expiresAt)
          : undefined,
      };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Get certificate failed: ${message}`);
      return null;
    }
  }

  /**
   * Poll for transaction confirmation
   */
  private async pollTransaction(txHash: string): Promise<any> {
    const maxAttempts = 30;
    const delayMs = 1000;

    for (let i = 0; i < maxAttempts; i++) {
      const response = await this.server.getTransaction(txHash);
      if (response.status === 'SUCCESS' || response.status === 'FAILED') {
        return response;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(`Transaction ${txHash} not confirmed after polling`);
  }

  /**
   * Resolve the keypair for an issuer address.
   */
  private getIssuerKeypair(issuerAddress: string): Keypair {
    if (!StrKet.isValidEd25519PublicKey(issuerAddress)) {
      throw new Error(`Invalid issuer address: ${issuerAddress}`);
    }
    if (!this.adminKeypair) {
      throw new Error('Admin keypair not configured.');
    }
    if (this.adminKeypair.publicKey() !== issuerAddress) {
      throw new Error(
        `Issuer ${issuerAddress} is not the configured admin keypair.`,
      );
    }
    return this.adminKeypair;
  }
}
