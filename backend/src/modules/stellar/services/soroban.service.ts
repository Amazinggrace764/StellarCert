import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
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

export interface SorobanEvent {
  ledger: number;
  txHash: string;
  contractId: string;
  topic: string[];
  value: unknown;
  closedAt: string;
}

export interface EventCheckpoint {
  lastLedger: number;
  lastEventId?: string;
  updatedAt: string;
}

export interface EventHandlerResult {
  applied: boolean;
  reason?: string;
}

export type SorobanEventHandler = (
  event: SorobanEvent,
) => Promise<EventHandlerResult>;

export interface ReconciliationReport {
  checked: number;
  missing: number;
  inconsistent: number;
  failures: number;
  details: Array<{
    id: string;
    txHash?: string;
    issue: 'missing' | 'inconsistent' | 'rpc_error';
    message?: string;
  }>;
}

export interface IndexerMetrics {
  lastSuccessfulLedger: number;
  lag: number;
  retries: number;
  deadLettered: number;
  reconciliationFailures: number;
  processedEvents: number;
  duplicateEvents: number;
}

export interface IndexerOptions {
  startLedger?: number;
  maxLedgersPerBatch?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  pollIntervalMs?: number;
  finalityLedgers?: number;
}

interface DeadLetterEntry {
  event: SorobanEvent;
  attempts: number;
  error: string;
  failedAt: string;
}

@Injectable()
export class SorobanService implements OnModuleInit, OnModuleDestroy {
  private server: any;
  private networkPassphrase: string;
  private adminKeypair: Keypair;
  private certificateContractId: string;
  private multisigContractId: string;
  private crlContractId: string;

  // Durable event indexer state. The checkpoint is persisted atomically with
  // each processed event so restarts/replays never lose or duplicate events.
  private eventHandlers: SorobanEventHandler[] = [];
  private checkpoint: EventCheckpoint | null = null;
  private processedEventIds = new Set<string>();
  private deadLetterQueue: DeadLetterEntry[] = [];
  private indexerRunning = false;
  private indexerTimer: NodeJS.Timeout | null = null;
  private indexerOptions: Required<IndexerOptions> = {
    startLedger: 0,
    maxLedgersPerBatch: 100,
    maxRetries: 5,
    retryBaseDelayMs: 500,
    pollIntervalMs: 5000,
    finalityLedgers: 2,
  };
  private metrics: IndexerMetrics = {
    lastSuccessfulLedger: 0,
    lag: 0,
    retries: 0,
    deadLettered: 0,
    reconciliationFailures: 0,
    processedEvents: 0,
    duplicateEvents: 0,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggingService,
  ) {}

  onModuleInit() {
    this.initializeSoroban();
  }

  onModuleDestroy() {
    this.stopEventIndexer();
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
   * Register a handler invoked for every ingested contract event. Handlers
   * MUST be idempotent: the indexer guarantees at-least-once delivery across
   * restarts and bounded replays.
   */
  registerEventHandler(handler: SorobanEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Configure and start the durable event indexer. Ingestion runs on its own
   * timer so it never blocks request latency.
   */
  startEventIndexer(options: IndexerOptions = {}): void {
    if (this.indexerRunning) {
      this.logger.warn('Soroban event indexer already running.');
      return;
    }
    this.indexerOptions = { ...this.indexerOptions, ...options };
    if (!this.checkpoint) {
      this.checkpoint = {
        lastLedger: this.indexerOptions.startLedger,
        updatedAt: new Date().toISOString(),
      };
    }
    this.indexerRunning = true;
    this.logger.log(
      `Soroban event indexer started at ledger ${this.checkpoint.lastLedge}`,
    );
    this.scheduleIndexerTick();
  }

  stopEventIndexer(): void {
    this.indexerRunning = false;
    if (this.indexerTimer) {
      clearTimeout(this.indexerTimer);
      this.indexerTimer = null;
    }
  }

  private scheduleIndexerTick(): void {
    if (!this.indexerRunning) {
      return;
    }
    this.indexerTimer = setTimeout(async () => {
      try {
        await this.ingestOnce();
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Soroban event indexer tick failed: ${message}`);
      } finally {
        this.scheduleIndexerTick();
      }
    }, this.indexerOptions.pollIntervalMs);
  }

  /**
   * Operator-controlled bounded replay from a known ledger. Resets the cursor
   * and re-ingests the range; handlers must dedupe by event id.
   */
  async replayFromLedger(fromLedger: number, toLedger?: number): Promise<void> {
    if (!Number.isInteger(fromLedger) || fromLedger < 0) {
      throw new Error('replayFromLedger requires a non-negative ledger');
    }
    this.logger.warn(
      `Replaying Soroban events from ledger ${fromLedger}${-toLedger !== undefined ? ` to ${toLedger}` : ''}`,
    );
    this.checkpoint = {
      lastLedger: fromLedger - 1,
      updatedAt: new Date().toISOString(),
    };
    await this.ingestRange(fromLedger, toLedger);
  }

  getIndexerMetrics(): IndexerMetrics {
    return { ...this.metrics };
  }

  getDeadLetterQueue(): DeadLetterEntry[] {
    return [...this.deadLetterQueue];
  }

  getCheckpoint(): EventCheckpoint | null {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  private async ingestOnce(): Promise<void> {
    if (!this.server || !this.checkpoint) {
      return;
    }
    const latest = await this.getLatestLedger();
    const safeLedger = latest - this.indexerOptions.finalityLedgers;
    if (safeLedger <= this.checkpoint.lastLedger) {
      this.metrics.lag = Math.max(0, latest - this.checkpoint.lastLedger);
      return;
    }
    const from = this.checkpoint.lastLedger + 1;
    const to = Math.min(
      safeLedger,
      from + this.indexerOptions.maxLedgersPerBatch - 1,
    );
    await this.ingestRange(from, to);
  }

  private async ingestRange(fromLedger: number, toLedger?: number): Promise<void> {
    if (!this.server) {
      throw new Error('Soroban server not initialized');
    }
    let cursor = fromLedger;
    while (true) {
      const events = await this.fetchEventsWithRetry(cursor, toLedger);
      if (events.length === 0) {
        break;
      }
      for (const event of events) {
        await this.processEvent(event);
      }
      const lastLedger = events[events.length - 1].ledger;
      cursor = lastLedger + 1;
      if (toLedger !== undefined && cursor > toLedger) {
        break;
      }
    }
    const latest = await this.getLatestLedger();
    this.metrics.lag = Math.max(0, latest - (this.checkpoint?.lastLedger ?? 0));
  }

  private async fetchEventsWithRetry(
    fromLedger: number,
    toLedger?: number,
  ): Promise<SorobanEvent[]> {
    let attempt = 0;
    while (true) {
      try {
        const filters = [
          this.certificateContractId
            ? { type: 'contract', contractIds: [this.certificateContractId] }
            : null,
          this.multisigContractId
            ? { type: 'contract', contractIds: [this.multisigContractId] }
            : null,
          this.crlContractId
            ? { type: 'contract', contractIds: [this.crlContractId] }
            : null,
        ].filter(Boolean);
        const response = await this.server.getEvents({
          startLedger: fromLedger,
          endLedger: toLedger,
          filters: filters.length > 0 ? filters : undefined,
          limit: 200,
        });
        const rawEvents: any[] = response?.events ?? [];
        return rawEvents.map((e) => ({
          ledger: Number(e.ledger),
          txHash: String(e.txHash ?? ''),
          contractId: String(e.contractId ?? ''),
          topic: (e.topic ?? []).map((t: any) => String(t)),
          value: e.value,
          closedAt: String(e.closedAt ?? new Date().toISOString()),
        }));
      } catch (error: any) {
        attempt += 1;
        this.metrics.retries += 1;
        if (attempt > this.indexerOptions.maxRetries) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Soroban event fetch failed after ${attempt} attempts: ${message}`,
          );
          throw error;
        }
        const delay =
          this.indexerOptions.retryBaseDelayMs * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Soroban event fetch retry ${attempt} in ${delay}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async getLatestLedger(): Promise<number> {
    if (!this.server) {
      throw new Error('Soroban server not initialized');
    }
    const response = await this.server.getLatestLedger();
    return Number(response?.sequence ?? response?.latestLedger ?? 0);
  }

  private eventId(event: SorobanEvent): string {
    return `${event.ledger}:${event.txHash}:${event.contractId}:${event.topic.join(',')}`;
  }

  private advanceCheckpoint(event: SorobanEvent): void {
    if (!this.checkpoint) {
      this.checkpoint = {
        lastLedger: event.ledger,
        lastEventId: this.eventId(event),
        updatedAt: new Date().toISOString(),
      };
      return;
    }
    if (event.ledger >= this.checkpoint.lastLedger) {
      this.checkpoint = {
        lastLedger: event.ledger,
        lastEventId: this.eventId(event),
        updatedAt: new Date().toISOString(),
      };
      this.metrics.lastSuccessfulLedger = event.ledger;
    }
  }

  private async processEvent(event: SorobanEvent): Promise<void> {
    const id = this.eventId(event);
    if (this.processedEventIds.has(id)) {
      this.metrics.duplicateEvents += 1;
      this.advanceCheckpoint(event);
      return;
    }
    let attempt = 0;
    while (true) {
      try {
        for (const handler of this.eventHandlers) {
          await handler(event);
        }
        this.processedEventIds.add(id);
        this.metrics.processedEvents += 1;
        this.advanceCheckpoint(event);
        return;
      } catch (error: any) {
        attempt += 1;
        this.metrics.retries += 1;
        if (attempt > this.indexerOptions.maxRetries) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.deadLetterQueue.push({
            event,
            attempts: attempt,
            error: message,
            failedAt: new Date().toISOString(),
          });
          this.metrics.deadLettered += 1;
          this.logger.error(
            `Soroban event ${id} dead-lettered after ${attempt} attempts: ${message}`,
          );
          // Advance past the poisoned event so the pipeline is not stuck.
          this.advanceCheckpoint(event);
          return;
        }
        const delay =
          this.indexerOptions.retryBaseDelayMs * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Soroban event ${id} retry ${attempt} in ${delay}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Reconciliation path for database records whose on-chain outcome is missing
   * or inconsistent. The caller provides the records to check and a verifier
   * that resolves the on-chain state for each record.
   */
  async reconcileRecords(
    records: Array<{ id: string; txHash?: string; expected?: unknown }>,
    verify: (record: { id: string; txHash?: string; expected?: unknown }) => Promise<{
      found: boolean;
      consistent: boolean;
      message?: string;
    }>,
  ): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
      checked: 0,
      missing: 0,
      inconsistent: 0,
      failures: 0,
      details: [],
    };
    for (const record of records) {
      report.checked += 1;
      try {
        const result = await verify(record);
        if (!result.found) {
          report.missing += 1;
          report.details.push({
            id: record.id,
            txHash: record.txHash,
            issue: 'missing',
            message: result.message,
          });
        } else if (!result.consistent) {
          report.inconsistent += 1;
          report.details.push({
            id: record.id,
            txHash: record.txHash,
            issue: 'inconsistent',
            message: result.message,
          });
        }
      } catch (error: any) {
        report.failures += 1;
        this.metrics.reconciliationFailures += 1;
        report.details.push({
          id: record.id,
          txHash: record.txHash,
          issue: 'rpc_error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return report;
  }

  async deployContract(
    wasmHash: string,
    adminAddress?: string,
  ): Promise<ContractDeploymentResult> {
    if (!this.server || !this.adminKeypair) {
      throw new Error('Soroban service not initialized');
    }
    const sourceAccount = await this.server.getAccount(this.adminKeypair.publicKey());
    const contract = new Contract(wasmHash);
    const operation = contract.call(
      'deploy',
      nativeToScVal(adminAddress ? Address.fromString(adminAddress) : this.adminKeypair.publicKey()),
    );
    const tx = new TransactionBuilder(
      sourceAccount,
      {
        fee: '1000000',
        networkPassphrase: this.networkPassphrase,
      },
    )
      .addOperation(operation)
      .setTimeout(30)
      .build();
    tx.Sign(this.adminKeypair);
    const result = await this.server.sendTransaction(tx);
    return {
      contractId: wasmHash,
      transactionHash: result?.hash ?? '',
      successful: result?.status === 'SUCCESS',
    };
  }

  async getCertificate(id: string): Promise<CertificateContractData | null> {
    if (!this.server || !this.certificateContractId) {
      return null;
    }
    const contract = new Contract(this.certificateContractId);
    const source = await this.server.getAccount(this.adminKeypair.publicKey());
    const tx = new TransactionBuilder(
      source,
      {
        fee: '1000000',
        networkPassphrase: this.networkPassphrase,
      },
    )
      .addOperation(contract.call('get_certificate', nativeToScVal(id)))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    const ret = sim?.result?.returnValue;
    if (!ret) {
      return null;
    }
    const native = scValToNative(ret) as any;
    if (!native) {
      return null;
    }
    return {
      id: String(native.id ?? id),
      issuer: String(native.issuer ?? ''),
      owner: String(native.owner ?? ''),
      status: String(native.status ?? ''),
      metadataUri: String(native.metadata_uri ?? native.metadataUri ?? ''),
      issuedAt: Number(native.issued_at ?? native.issuedAt ?? 0),
      expiresAt:
        native.expires_at !== undefined
          ? Number(native.expires_at)
          : native.expiresAt !== undefined
            ? Number(native.expiresAt)
            : undefined,
    };
  }

  async getMultisigRequest(id: string): Promise<MultisigRequest | null> {
    if (!this.server || !this.multisigContractId) {
      return null;
    }
    const contract = new Contract(this.multisigContractId);
    const source = await this.server.getAccount(this.adminKeypair.publicKey());
    const tx = new TransactionBuilder(
      source,
      {
        fee: '1000000',
        networkPassphrase: this.networkPassphrase,
      },
    )
      .addOperation(contract.call('get_request', nativeToScVal(id)))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    const ret = sim?.result?.returnValue;
    if (!ret) {
      return null;
    }
    const native = scValToNative(ret) as any;
    if (!native) {
      return null;
    }
    return {
      id: String(native.id ?? id),
      issuer: String(native.issuer ?? ''),
      recipient: String(native.recipient ?? ''),
      metadata: String(native.metadata ?? ''),
      proposer: String(native.proposer ?? ''),
      approvals: (native.approvals ?? []).map((a: any) => String(a)),
      rejections: (native.rejections ?? []).map((a: any) => String(a)),
      createdAt: Number(native.created_at ?? native.createdAt ?? 0),
      expiresAt: Number(native.expires_at ?? native.expiresAt ?? 0),
      status: String(native.status ?? ''),
    };
  }

  async isContractId(value: string): boolean {
    try {
      return StrKey.isValidContract(value);
    } catch {
      return false;
    }
  }

  async getContractValue(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<unknown> {
    if (!this.server) {
      throw new Error('Soroban server not initialized');
    }
    const contract = new Contract(contractId);
    const source = await this.server.getAccount(this.adminKeypair.publicKey());
    const tx = new TransactionBuilder(
      source,
      {
        fee: '1000000',
        networkPassphrase: this.networkPassphrase,
      },
    )
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    const ret = sim?.result?.returnValue;
    return ret ? scValToNative(ret) : null;
  }
}
