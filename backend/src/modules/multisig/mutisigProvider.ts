import { Injectable } from '@nestjs/common';

export enum RequestStatus {
  Pend = 0,
  Approve = 1,
  Reject = 2,
  Expir = 3,
  Issue = 4,
}

export enum SignatureAction {
  Approv = 0,
  Reject = 1,
}

export type SorobanTransactionStatus = 'SUCCESS' | 'FAILED' | 'NOT_FOUND';

export interface SorobanGetTransactionResponse {
  status: SorobanTransactionStatus;
  txHash?: string;
  ledger?: number;
  envelopeXadr?: string;
  resultXadr?: string;
  resultMeta?: unknown;
  error?: string;
}

export interface SorobanSendTransactionResponse {
  status: 'PENDING' | 'DUPLICATED' | 'ERROR';
  hash?: string;
  errorResultXadr?: string;
  error?: string;
}

export interface SorobanRpc {
  sendTransaction(transactionEnvelopeX: string): Promise<SorobanSendTransactionResponse>;
  getTransaction(txHash: string): Promise<SorobanGetTransactionResponse>;
}

export interface PollingOptions {
  /** Maximum total time to wait for a finalized transaction (ms). */
  timeoutMs?: number;
  /** Delay between polls (ms). */
  intervalMs?: number;
  /** Optional abort signal for cancellation. */
  signal?: AbortSignal;
}

export const DEFAULT_POLLING_TIMEOUT_MS = 30_000;
const defaultPollingIntervalMs = 1_000;

export class SorobanTransactionPollingError extends Error {
  constructor(
    message: string,
    public readonly txHash: string,
    public readonly lastStatus?: SorobanTransactionStatus,
  ) {
    super(message);
    this.name = 'SorobanTransactionPollingError';
  }
}

export class SorobanTransactionFailedError extends Error {
  constructor(
    message: string,
    public readonly txHash: string,
    public readonly response: SorobanGetTransactionResponse,
  ) {
    super(message);
    this.name = 'SorobanTransactionFailedError';
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Polling aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Polling aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Submits a Soroban transaction and polls `sendTransaction/getTransaction`
 * until the transaction reaches a finalized status (SUCCESS or FAILED).
 *
 * This is the root-correction for the bug where callers invoked getTransaction
 * immediately after sendTransaction and read a still-PENDING/NOT-FOUND result.
 */
export async function sendAndConfirmSorobanTransaction(
  rpc: SorobanRpc,
  transactionEnvelopeX: string,
  options: PollingOptions = {},
): Promise<SorobanGetTransactionResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLLING_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? defaultPollingIntervalMs;
  const signal = options.signal;
  const deadline = Date.now() + timeoutMs;

  const sendResponse = await rpc.sendTransaction(transactionEnvelopeX);

  if (sendResponse.status === 'ERROR') {
    throw new SorobanTransactionPollingError(
      `sendTransaction failed: ${sendResponse.error ?? sendResponse.errorResultXadr ?? 'unknown error'}`,
      sendResponse.hash ?? '',
    );
  }

  const txHash = sendResponse.hash;
  if (!txHash) {
    throw new SorobanTransactionPollingError(
      'sendTransaction returned no transaction hash',
      '',
    );
  }

  let lastStatus: SorobanTransactionStatus | undefined;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new SorobanTransactionPollingError('Polling aborted', txHash, lastStatus);
    }

    const result = await rpc.getTransaction(txHash);
    lastStatus = result.status;

    if (result.status === 'SUCCESS') {
      return result;
    }

    if (result.status === 'FAILED') {
      throw new SorobanTransactionFailedError(
        `Soroban transaction ${txHash} failed: ${result.error ?? 'unknown error'}`,
        txHash,
        result,
      );
    }

    // NOT_FOUND or any non-final status: wait and retry.
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(intervalMs, remaining), signal);
  }

  throw new SorobanTransactionPollingError(
    `Timed out after ${timeoutMs}ms waiting for Soroban transaction ${txHash} to finalize` + (lastStatus ? ` (last status: ${lastStatus})` : ''),
    txHash,
    lastStatus,
  );
}

@Injectable()
export class MultisigProvider {
  /**
   * Submits a multisig Soroban transaction and returns only once it has
   * reached a finalized status, polling `getTransaction` instead of reading
   * it immediately after `sendTransaction`.
   */
  async submitAndConfirm(
    rpc: SorobanRpc,
    transactionEnvelopeX: string,
    options: PollingOptions = {},
  ): Promise<SorobanTransactionResponse> {
    return sendAndConfirmSorobanTransaction(rpc, transactionEnvelopeX, options);
  }
}
