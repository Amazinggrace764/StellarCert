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
 * Resolves the signing keypair for a given issuer address.
 *
 * Per-issuer keys are provided through configuration as a
 * comma-separated list of `<public key>:<secret key>` entries under
 * `ISSUER_KEYSPAM_MAP or through a single `ISSUER_<public key>_SECRET` env
 * variable. The admin keypair is never used as a fallback for issuers.
 */
export interface IssuerKeypairProvider {
  getKeypair(issuerAddress: string): Keypair | null;
}

@Injectable()
export class SorobanService implements OnModuleInit, IssuerKeypairProvider {
  private server: any;
  private networkPassphrase: string;
  private adminKeypair: Keypair;
  private certificateContractId: string;
  private multisigContractId: string;
  private crlContractId: string;
  private issuerKeypairs: Map<string, Keypair> = new Map();

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

    this.loadIssuerKeypairs();

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
   * Load per-issuer keypairs from configuration. Supports both a
   * comma-separated map and individual env variables.
   */
  private loadIssuerKeypairs(): void {
    const mapped = this.configService.get<string>('ISSUER_KEYSPAM_MAP');
    if (mapped) {
      for (const entry of mapped.split(',')) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        const separator = trimmed.indexOf(':');
        if (separator <= 0) continue;
        const publicKey = trimmed.slice(0, separator).trim();
        const secret = trimmed.slice(separator + 1).trim();
        this.registerIssuerKeypair(publicKey, secret);
      }
    }

    // Support `ISSUER_<Public key>_SECRET` env variables.
    const envClone = {
      ...(process.env as Record<string, string | undefined>),
    };
    for (const [key, value] of Object.entries(envClone)) {
      if (!key.startsWith('ISSUER_') || !key.endsWith('_SECRET')) continue;
      if (key === 'ISSUER_KEYSPAM_MAP') continue;
      const publicKey = key.slice('ISSUER_'.length, key.length - '_SECRET'.length);
      if (!value) continue;
      this.registerIssuerKeypair(publicKey, value);
    }
  }

  private registerIssuerKeypair(publicKey: string, secret: string): void {
    try {
      const keypair = Keypair.fromSecret(secret);
      if (keypair.publicKey() !== publicKey) {
        this.logger.warn(`Issuer keypair registration mismatch for ${publicKey}.`);
        return;
      }
      this.issuerKeypairs.set(publicKey, keypair);
    } catch {
      this.logger.warn(`Invalid issuer secret key configured for ${publicKey}.`);
    }
  }

  /**
   * Resolve the keypair for an issuer address. Returns null when no
   * key is configured for the issuer. Never falls back to the admin key.
   */
  getKeypair(issuerAddress: string): Keypair | null {
    if (!issuerAddress) {
      return null;
    }
    const keypair = this.issuerKeypairs.get(issuerAddress);
    if (!keypair) {
      this.logger.warn(
        `No signing key configured for issuer ${issuerAddress}.`,
      );
      return null;
    }
    return keypair;
  }

  /**
   * Register an issuer keypair at runtime. Useful for tests and for
   * dynamic provisioning flows.
   */
  registerIssuerSecret(publicKey: string, secret: string): boolean {
    try {
      const keypair = Keypair.fromSecret(secret);
      if (keypair.publicKey() !== publicKey) return false;
      this.issuerKeypairs.set(publicKey, keypair);
      return true;
    } catch {
      return false;
    }
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
   * The transaction is signed by the issuer's configured keypair. If no
   * keypair is configured for the issuer, issuance fails rather than
   * falling back to the admin key.
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

      const issuerKeypair = this.getKeypair(issuerAddress);
      if (!issuerKeypair) {
        this.logger.error(
          `Cannot issue certificate ${id}: no signing key configured for issuer ${issuerAddress}.`,
        );
        return null;
      }

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

      const txResponse = await this.pollTransaction(result.hash);

      if (txResponse.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${txResponse.status}`);
      }

      return result.hash;
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Issue certificate ${id} failed: ${message}`);
      return null;
    }
  }

  /**
   * Revoke a certificate on-chain.
   *
   * The transaction is signed by the issuer's configured keypair. If no
   * keypair is configured for the issuer, revocation fails rather than
   * falling back to the admin key.
   *
   * @returns the Soroban transaction hash once the ledger confirms the
   *   transaction with `SUCCESS`, or `null` when revocation failed.
   */
  async revokeCertificate(
    id: string,
    issuerAddress: string,
    reason?: string,
  ): Promise<string | null> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
      }

      const contract = new Contract(this.certificateContractId);

      const issuerKeypair = this.getKeypair(issuerAddress);
      if (!issuerKeypair) {
        this.logger.error(
          `Cannot revoke certificate ${id}: no signing key configured for issuer ${issuerAddress}.`,
        );
        return null;
      }

      const sourceAccount = await this.server.getAccount(
        issuerKeypair.publicKey(),
      );

      const args = [
        nativeToScVal(id),
        reason ? nativeToScVal(reason) : nativeToScVal(null),
      ];

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

      const txResponse = await this.pollTransaction(result.hash);

      if (txResponse.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${txResponse.status}`);
      }

      return result.hash;
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Revoke certificate ${id} failed: ${message}`);
      return null;
    }
  }

  /**
   * Poll for transaction confirmation
   */
  private async pollTransaction(transactionHash: string): Promise<any> {
    const maxAttempts = 30;
    const delayMs = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await this.server.getTransaction(transactionHash);

      if (response.status === 'SUCCESS' || response.status === 'FAILED') {
        return response;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(`Transaction ${transactionHash} timed out waiting for confirmation`);
  }
}
