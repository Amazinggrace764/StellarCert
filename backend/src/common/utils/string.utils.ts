/**
 * String manipulation utilities
 */
export class StringUtils {
  /**
   * Generates a slug from a string
   */
  static slug(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|.+$/g, '');
  }

  /**
   * Truncates a string to a maximum length with ellipsis
   */
  static truncate(text: string, maxLength: number, suffix = '...'): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * Capitalizes the first letter of a string
   */
  static capitalize(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /**
   * Converts string to title case
   */
  static toTitleCase(text: string): string {
    return text
      .toLowerCase()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Masks sensitive information (e.g., email, phone)
   */
  static mask(text: string, maskChar = '*', visibleChars = 2): string {
    if (text.length <= visibleChars) {
      return text;
    }
    const masked = maskChar.repeat(text.length - visibleChars);
    return text.substring(0, visibleChars) + masked;
  }

  /**
   * Removes whitespace from both ends of a string
   */
  static trim(text: string): string {
    return text.trim();
  }

  /**
   * Checks if a string contains another string
   */
  static contains(
    text: string,
    searchText: string,
    caseSensitive = false,
  ): boolean {
    if (!caseSensitive) {
      return text.toLowerCase().includes(searchText.toLowerCase());
    }
    return text.includes(searchText);
  }

  /**
   * Sanitizes a string by removing control characters while
   * preserving legitimate whitespace: newline (\n), carriage return (\r),
   * and tab (\t). This prevents corruption of multi-line and tabbed data
   * (such as certificate descriptions, addresses, or JSON-encoded metadata).
   */
  static sanitize(text: string): string {
    if (!text) return text;
    // Remove C0 control characters and DEL except \t (\`x09), \n (\x0A) and 
    // \r (\x0D). The regex is applied in a single pass to avoid per-character
    // allocations from split('').filter().
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
}
