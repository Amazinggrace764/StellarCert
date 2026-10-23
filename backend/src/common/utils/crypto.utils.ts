import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

/**
 * Cryptography utility helpers
 */
export class CryptoUtils {
  /**
   * Hashes a password using bcryptjs
   * @param password - Plain text password to hash
   * @param rounds - Number of salt rounds (default: 12)
   */
  static async hashPassword(
    password: string,
    rounds: number = 12,
  ): Promise<string> {
    return bcrypt.hash(password, rounds);
  }

  /**
   * Compares a plain text password with a hashed password
   * @param password - Plain text password
   * @param hash - Hashed password to compare against
   */
  static async comparePassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generates a cryptographically secure random string token
   * (useful for reset tokens, etc)
   * @param length - Length of the token (default: 32)
   */
  static generateToken(length: number = 32): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return this.randomFromCharset(chars, length);
  }

  /**
   * Generates a cryptographically secure random alphanumeric code
   * using uppercase letters and digits only
   * (useful for verification codes, certificate IDs)
   * @param length - Length of the code (default: 8)
   */
  static generateAlphanumericCode(length: number = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return this.randomFromCharset(chars, length);
  }

  /**
   * Generates a cryptographically secure random numeric code
   * (useful for OTP, verification codes)
   * @param length - Length of the code (default: 6)
   */
  static generateNumericCode(length: number = 6): string {
    const chars = '0123456789';
    return this.randomFromCharset(chars, length);
  }

  /**
   * Generates a string by drawing each character uniformly from the
   * supplied charset using cryptographically secure random bytes.
   * This avoids modulo bias by rejecting bytes that fall outside the
   * largest multiple of the charset size.
   * @param charset - Characters to draw from
   * @param length - Number of characters to generate
   */
  private static randomFromCharset(charset: string, length: number): string {
    if (!Number.isInteger(length) || length < 0) {
      throw new Error('Length must be a non-negative integer');
    }
    if (charset.length === 0) {
      throw new Error('Charset must not be empty');
    }
    if (length === 0) {
      return '';
    }

    const charsetLength = charset.length;
    // Largest multiple of charsetLength that fits in a byte (0-255).
    const maxUnbiased = 256 - (256 % charsetLength);
    const result: string[] = [];
    let remaining = length;

    while (remaining > 0) {
      // Over-allocate a bit to reduce the number of randomBytes calls.
      const bytes = crypto.randomBytes(remaining + 8);
      for (const byte of bytes) {
        if (byte >= maxUnbiased) {
          continue;
        }
        result.push(charset.charAt(byte % charsetLength));
        remaining--;
        if (remaining === 0) {
          break;
        }
      }
    }

    return result.join('');
  }


  /**
   * Hashes data using SHA256
   */
  static sha256Hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Creates an HMAC signature
   */
  static createHMAC(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * Verifies an HMAC signature
   * Uses a timing-safe comparison to prevent signature forgery via timing analysis.
   */
  static verifyHMAC(data: string, signature: string, secret: string): boolean {
    const expectedSignature = this.createHMAC(data, secret);
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const actualBuffer = Buffer.from(signature || '', 'utf8');
    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }
}
