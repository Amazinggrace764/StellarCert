/**
 * Application error codes and messages
 */
export enum ErrorCode {
  // Authentication errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

  // Blockchain/Stellar errors
  STELLAR_ERROR = 'STELLAR_ERROR',
  INVALID_STELLAR_ADDRESS = 'INVALID_STELLAR_ADDRESS',
  BLOCKCHAIN_CONNECTION_ERROR = 'BLOCKCHAIN_CONNECTION_ERROR',
  INVALID_TRANSACTION = 'INVALID_TRANSACTION',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',

  // Certificate errors
  CERTIFICATE_NOT_FOUND = 'CERTIFICATE_NOT_FOUND',
  CERTIFICATE_INVALID = 'CERTIFICATE_INVALID',
  CERTIFICATE_EXPIRED = 'CERTIFICATE_EXPIRED',
  CERTIFICATE_REVOKED = 'CERTIFICATE_REVOKED',
  CERTIFICATE_ALREADY_EXISTS = 'CERTIFICATE_ALREADY_EXISTS',
  INVALID_CERTIFICATE_DATA = 'INVALID_CERTIFICATE_DATA',

  // Resource errors
  NOT_FOUND = 'NOT_FOUND',
  DUPLICATE_RESOURCE = 'DUPLICATE_RESOURCE',
  RESOURCE_IN_USE = 'RESOURCE_IN_USE',

  // Server errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',

  // General errors
  CONFLICT = 'CONFLICT',
  FORBIDDEN = 'FORBIDDEN',
  BAD_REQUEST = 'BAD_REQUEST',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.UNAUTHORIZED]: 'Unauthorized access',
  [ErrorCode.INVALID_CREDENTIALS]: 'Invalid email or password',
  [ErrorCode.TOKEN_EXPIRED]: 'Token has expired',
  [ErrorCode.TOKEN_INVALID]: 'Invalid token',
  [ErrorCode.INSUFFICIENT_PERMISSIONS]:
    'Insufficient permissions to perform this action',

  [ErrorCode.VALIDATION_ERROR]: 'Validation error',
  [ErrorCode.INVALID_INPUT]: 'Invalid input provided',
  [ErrorCode.MISSING_REQUIRED_FIELD]: 'Missing required field',

  [ErrorCode.STELLAR_ERROR]: 'Stellar blockchain error',
  [ErrorCode.INVALID_STELLAR_ADDRESS]: 'Invalid Stellar address',
  [ErrorCode.BLOCKCHAIN_CONNECTION_ERROR]: 'Failed to connect to blockchain',
  [ErrorCode.INVALID_TRANSACTION]: 'Invalid transaction',
  [ErrorCode.TRANSACTION_FAILED]: 'Transaction failed',

  [ErrorCode.CERTIFICATE_NOT_FOUND]: 'Certificate not found',
  [ErrorCode.CERTIFICATE_INVALID]: 'Certificate is invalid',
  [ErrorCode.CERTIFICATE_EXPIRED]: 'Certificate has expired',
  [ErrorCode.CERTIFICATE_REVOKED]: 'Certificate has been revoked',
  [ErrorCode.CERTIFICATE_ALREADY_EXISTS]: 'Certificate already exists',
  [ErrorCode.INVALID_CERTIFICATE_DATA]: 'Invalid certificate data',

  [ErrorCode.NOT_FOUND]: 'Resource not found',
  [ErrorCode.DUPLICATE_RESOURCE]: 'Resource already exists',
  [ErrorCode.RESOURCE_IN_USE]: 'Resource is in use',

  [ErrorCode.INTERNAL_SERVER_ERROR]: 'Internal server error',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Service unavailable',
  [ErrorCode.DATABASE_ERROR]: 'Database error occurred',

  [ErrorCode.CONFLICT]: 'Conflict occurred',
  [ErrorCode.FORBIDDEN]: 'Forbidden',
  [ErrorCode.BAD_REQUEST]: 'Bad request',
  [ErrorCode.REQUEST_TIMEOUT]: 'Request timeout',
};
