/**
 * Data transformation utilities
 */
export class TransformUtils {
  /**
   * Removes undefined properties from an object
   */
  static removeUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
    const result: any = {};
    for (const key in obj) {
      if (obj[key] !== undefined && obj[key] !== null) {
        result[key] = obj[key];
      }
    }
    return result;
  }

  /**
   * Converts an object to camelCase keys
   */
  static toCamelCase(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.toCamelCase(item));
    }

    if (obj !== null && typeof obj === 'object') {
      const result: any = {};
      for (const key in obj) {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
          letter.toUpperCase(),
        );
        result[camelKey] = this.toCamelCase(obj[key]);
      }
      return result;
    }

    return obj;
  }

  /**
   * Converts an object to snake_case keys
   */
  static toSnakeCase(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.toSnakeCase(item));
    }

    if (obj !== null && typeof obj === 'object') {
      const result: any = {};
      for (const key in obj) {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        result[snakeKey] = this.toSnakeCase(obj[key]);
      }
      return result;
    }

    return obj;
  }

  /**
   * Picks specified keys from an object
   */
  static pick<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[],
  ): Pick<T, K> {
    const result: any = {};
    keys.forEach((key) => {
      if (key in obj) {
        result[key] = obj[key];
      }
    });
    return result;
  }

  /**
   * Omits specified keys from an object
   */
  static omit<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[],
  ): Omit<T, K> {
    const result: any = { ...obj };
    keys.forEach((key) => {
      delete result[key];
    });
    return result;
  }

  /**
   * Deep clones an object
   */
  static deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Merges multiple objects (shallow merge)
   */
  static merge<T extends Record<string, any>>(...objects: Partial<T>[]): T {
    return objects.reduce((acc, obj) => ({ ...acc, ...obj }), {}) as T;
  }

  /**
   * Formats date to ISO string
   */
  static formatDateISO(date: Date | string): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toISOString();
  }

  /**
   * Converts date to Unix timestamp
   */
  static toUnixTimestamp(date: Date | string): number {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return Math.floor(dateObj.getTime() / 1000);
  }

  /**
   * Converts Unix timestamp to Date object
   */
  static fromUnixTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
  }
}
