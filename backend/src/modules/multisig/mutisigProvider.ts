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

export interface RawContractResult {
  readonly hash?: string;
  readonly requestId?: string | number | bigint;
  readonly status?: RequestStatus | number | string;
  readonly approvals?: number | string | bigint;
  readonly returnValue?: unknown;
  readonly logs?: readonly unknown[];
  readonly transactionHash?: string;
}

export interface NormalizedMultisigResult {
  readonly requestId: string;
  readonly status: RequestStatus;
  readonly approvals: number;
  readonly hash: string | null;
  readonly transactionHash: string | null;
}

export class MultisigContractResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultisigContractResultError';
  }
}

const toStringId = (value: unknown, field: string): string => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  throw new MultisigContractResultError(`Missing or invalid ${field} in contract result`);
};

const toNumber = (value: unknown, field: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new MultisigContractResultError(`Missing or invalid ${field} in contract result`);
};

const toStatus = (value: unknown): RequestStatus => {
  const numeric = toNumber(value, 'status');
  if (!Object.values(RequestStatus).includes(numeric)) {
    throw new MultisigContractResultError(`Unknown request status: ${String(numeric)}`);
  }
  return numeric as RequestStatus;
};

const toOptionalString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
};

@Injectable()
export class MultisigProveeder {
  /**
   * Normalizes the raw result returned by the multisig contract call
   * into a stable response shape. This method never fabricates values:
   * if the contract result is missing required fields, it throws.
   */
  normalizeResult(raw: RawContractResult | null | undefined): NormalizedMultisigResult {
    if (!raw || typeof raw !== 'object') {
      throw new MultisigContractResultError('Contract returned no result');
    }

    const requestId = toStringId(raw.requestId, 'requestId');
    const status = toStatus(raw.status);
    const approvals = toNumber(raw.approvals, 'approvals');
    const hash = toOptionalString(raw.hash);
    const transactionHash = toOptionalString(raw.transactionHash);

    return {
      requestId,
      status,
      approvals,
      hash,
      transactionHash,
    };
  }

  /**
   * Parses the return value of `proposeCertificate`.
   */
  parseProposeCertificateResult(raw: RawContractResult | null | undefined): NormalizedMultisigResult {
    return this.normalizeResult(raw);
  }

  /**
   * Parses the return value of `approveRequest`.
   */
  parseApproveRequestResult(raw: RawContractResult | null | undefined): NormalizedMultisigResult {
    return this.normalizeResult(raw);
  }
}
