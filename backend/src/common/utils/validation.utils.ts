import {
  STELLAR_ADDRESS_REGEX,
  STELLAR_TRANSACTION_HASH_REGEX,
} from '../constants';

/**
 * Validation utility helpers
 */
export class ValidationUtils {
  /**
   * Validates if a string is a valid Stellar public key address
   * Stellar addresses start with 'G' and contain 56 characters in base32 encoding
   */
  static isStellarAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }
    return STELLAR_ADDRESS_REGEX.test(address);
  }

  /**
   * Validates if a string is a valid Stellar transaction hash
   * Transaction hashes are 64 character hex strings
   */
  static isStellarTransactionHash(hash: string): boolean {
    if (!hash || typeof hash !== 'string') {
      return false;
    }
    return STELLAR_TRANSACTION_HASH_REGEX.test(hash);
  }

  /**
   * Validates email format
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validates if date string is valid ISO format
   */
  static isValidISODate(dateString: string): boolean {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Validates password strength
   * Requires: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
   */
  static isStrongPassword(password: string): boolean {
    const strongPasswordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return strongPasswordRegex.test(password);
  }

  /**
   * Validates URL format
   */
  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validates if a value is a valid UUID
   */
  static isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Validates if date is not in the past
   */
  static isFutureDate(date: Date | string): boolean {
    const dateToCheck = typeof date === 'string' ? new Date(date) : date;
    return dateToCheck > new Date();
  }

  /**
   * Validates if date has expired
   */
  static hasExpired(expiryDate: Date | string): boolean {
    const expiryToCheck =
      typeof expiryDate === 'string' ? new Date(expiryDate) : expiryDate;
    return expiryToCheck < new Date();
  }
}
