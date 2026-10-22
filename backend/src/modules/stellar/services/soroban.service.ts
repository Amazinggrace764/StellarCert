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

@Injectable()
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
   * @returns the Soroban transaction hash once the ledger confirms the
   *   transaction with `SUCCESS`, or `null` when issuance failed. Callers must
   *   treat `null` as a failure and must not record a transaction hash.
   */
  async issueCertificate(
    id: string,
    issuerAddress: string,
    ownerAddress: string,
    metadataUri: string,
    expiresAt?: number,
  ): Promise<string | null> {
    try {
      if (!this.certificateContractId) {
        throw new Error('Certificate contract ID not configured.');
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
          ` Certificate issuance transaction ${result.hash} ended with status ${txResponse.status}`,
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
      this.logger.error(`Failed to fetch certificate ${id}: ${message}`);
      return null;
    }
  }

  private getIssuerKeypair(): Keypair {
    throw new Error('Issuer keypair lookup is not configured.');
  }

  private async pollTransaction(hash: string): Promise<any> {
    const maxAttempts = 10;
    const delayMs = 1000;
    for (let i = 0; i < maxAttempts; i++) {
      const response = await this.server.getTransaction(hash);
      if (response.status !== 'NOT_FOUND') {
        return response;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(`Transaction ${hash} not confirmed in time`);
  }
}
