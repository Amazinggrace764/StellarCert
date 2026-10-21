import { DuplicateDetectionConfig } from '../interfaces/duplicate-detection.interface';

export const defaultDuplicateDetectionConfig: DuplicateDetectionConfig = {
  enabled: true,
  defaultAction: 'warn',
  allowOverride: true,
  requireAdminApproval: false,
  logDuplicates: true,
  rules: [
    {
      id: 'exact_match',
      name: 'Exact Match Detection',
      description:
        'Detect exact matches on recipient email, name, title, and issuer',
      enabled: true,
      action: 'block',
      threshold: 1.0,
      checkFields: ['recipientEmail', 'recipientName', 'title', 'issuerId'],
      fuzzyMatching: false,
      priority: 100,
    },
    {
      id: 'email_fuzzy',
      name: 'Email Fuzzy Match',
      description: 'Detect similar email addresses with typos or variations',
      enabled: true,
      action: 'warn',
      threshold: 0.85,
      checkFields: ['recipientEmail', 'title', 'issuerId'],
      fuzzyMatching: true,
      timeWindow: 30, // 30 days
      priority: 80,
    },
    {
      id: 'name_fuzzy',
      name: 'Name Fuzzy Match',
      description: 'Detect similar recipient names with possible typos',
      enabled: true,
      action: 'warn',
      threshold: 0.8,
      checkFields: ['recipientName', 'title', 'issuerId'],
      fuzzyMatching: true,
      timeWindow: 90, // 90 days
      priority: 70,
    },
    {
      id: 'title_fuzzy',
      name: 'Title Fuzzy Match',
      description: 'Detect similar certificate titles',
      enabled: true,
      action: 'warn',
      threshold: 0.75,
      checkFields: ['recipientEmail', 'title', 'issuerId'],
      fuzzyMatching: true,
      timeWindow: 60, // 60 days
      priority: 60,
    },
    {
      id: 'same_recipient_different_issuer',
      name: 'Same Recipient Different Issuer',
      description:
        'Detect when same recipient gets certificates from different issuers',
      enabled: true,
      action: 'warn',
      threshold: 0.9,
      checkFields: ['recipientEmail', 'recipientName', 'title'],
      fuzzyMatching: true,
      timeWindow: 180, // 180 days
      priority: 50,
    },
    {
      id: 'high_frequency_recipient',
      name: 'High Frequency Recipient',
      description:
        'Detect recipients receiving many certificates in short time',
      enabled: true,
      action: 'warn',
      threshold: 0.7,
      checkFields: ['recipientEmail'],
      fuzzyMatching: false,
      timeWindow: 7, // 7 days
      priority: 40,
    },
  ],
};

export const strictDuplicateDetectionConfig: DuplicateDetectionConfig = {
  ...defaultDuplicateDetectionConfig,
  defaultAction: 'block',
  allowOverride: false,
  rules: defaultDuplicateDetectionConfig.rules.map((rule) => ({
    ...rule,
    action: 'block' as const,
    threshold: Math.max(rule.threshold, 0.8),
  })),
};

export const lenientDuplicateDetectionConfig: DuplicateDetectionConfig = {
  ...defaultDuplicateDetectionConfig,
  defaultAction: 'allow',
  allowOverride: true,
  requireAdminApproval: false,
  rules: defaultDuplicateDetectionConfig.rules.map((rule) => ({
    ...rule,
    action: 'warn' as const,
    threshold: Math.min(rule.threshold, 0.6),
  })),
};
