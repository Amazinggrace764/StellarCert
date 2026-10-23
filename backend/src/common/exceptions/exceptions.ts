import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ERROR_MESSAGES } from '../constants/error-codes';

/**
 * Base exception for all custom application exceptions
 */
export abstract class AppException extends HttpException {
  constructor(
    errorCode: ErrorCode,
    statusCode: HttpStatus,
    message?: string,
    public readonly details?: Record<string, any>,
  ) {
    const errorMessage = message || ERROR_MESSAGES[errorCode];
    super(
      {
        errorCode,
        message: errorMessage,
        details,
        timestamp: new Date().toISOString(),
      },
      statusCode,
    );
  }
}

/**
 * Validation exception for input validation errors
 */
export class ValidationException extends AppException {
  constructor(message?: string, details?: Record<string, any>) {
    super(ErrorCode.VALIDATION_ERROR, HttpStatus.BAD_REQUEST, message, details);
  }
}

/**
 * Stellar blockchain related exceptions
 */
export class StellarException extends AppException {
  constructor(
    errorCode: ErrorCode = ErrorCode.STELLAR_ERROR,
    message?: string,
    details?: Record<string, any>,
  ) {
    const statusCode =
      errorCode === ErrorCode.INVALID_STELLAR_ADDRESS
        ? HttpStatus.BAD_REQUEST
        : HttpStatus.BAD_GATEWAY;
    super(errorCode, statusCode, message, details);
  }
}

/**
 * Certificate related exceptions
 */
export class CertificateException extends AppException {
  constructor(
    errorCode: ErrorCode,
    message?: string,
    details?: Record<string, any>,
  ) {
    let statusCode = HttpStatus.BAD_REQUEST;

    if (errorCode === ErrorCode.CERTIFICATE_NOT_FOUND) {
      statusCode = HttpStatus.NOT_FOUND;
    } else if (
      errorCode === ErrorCode.CERTIFICATE_ALREADY_EXISTS ||
      errorCode === ErrorCode.CONFLICT
    ) {
      statusCode = HttpStatus.CONFLICT;
    }

    super(errorCode, statusCode, message, details);
  }
}

/**
 * Authentication exception
 */
export class AuthException extends AppException {
  constructor(
    errorCode: ErrorCode = ErrorCode.UNAUTHORIZED,
    message?: string,
    details?: Record<string, any>,
  ) {
    let statusCode = HttpStatus.UNAUTHORIZED;

    if (errorCode === ErrorCode.INSUFFICIENT_PERMISSIONS) {
      statusCode = HttpStatus.FORBIDDEN;
    }

    super(errorCode, statusCode, message, details);
  }
}

/**
 * Not found exception
 */
export class NotFoundException extends AppException {
  constructor(message?: string, details?: Record<string, any>) {
    super(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, message, details);
  }
}

/**
 * Conflict exception
 */
export class ConflictException extends AppException {
  constructor(message?: string, details?: Record<string, any>) {
    super(ErrorCode.CONFLICT, HttpStatus.CONFLICT, message, details);
  }
}

/**
 * Internal server error exception
 */
export class InternalServerErrorException extends AppException {
  constructor(message?: string, details?: Record<string, any>) {
    super(
      ErrorCode.INTERNAL_SERVER_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      message,
      details,
    );
  }
}
