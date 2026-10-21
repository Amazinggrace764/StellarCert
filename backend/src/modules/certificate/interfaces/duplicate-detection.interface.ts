export interface DuplicateCheckResult {
  isDuplicate: boolean;
  confidence: number;
  matches: DuplicateMatch[];
  action: 'block' | 'warn' | 'allow';
  message?: string;
}

export interface DuplicateMatch {
  certificateId: string;
  issuerId: string;
  recipientEmail: string;
  recipientName: string;
  title: string;
  issuedAt: Date;
  similarityScore: number;
  matchType: 'exact' | 'fuzzy_email' | 'fuzzy_name' | 'fuzzy_title';
}

export interface DuplicateRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  action: 'block' | 'warn' | 'allow';
  threshold: number;
  checkFields: ('recipientEmail' | 'recipientName' | 'title' | 'issuerId')[];
  fuzzyMatching: boolean;
  timeWindow?: number; // in days
  priority: number;
}

export interface DuplicateDetectionConfig {
  enabled: boolean;
  defaultAction: 'block' | 'warn' | 'allow';
  rules: DuplicateRule[];
  allowOverride: boolean;
  requireAdminApproval: boolean;
  logDuplicates: boolean;
}

export interface DuplicateReport {
  id: string;
  totalDuplicates: number;
  duplicatesByIssuer: Record<string, number>;
  duplicatesByType: Record<string, number>;
  timeRange: { start: Date; end: Date };
  generatedAt: Date;
  duplicates: DuplicateMatch[];
}

export interface OverrideRequest {
  id: string;
  certificateId: string;
  reason: string;
  requestedBy: string;
  approvedBy?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
  reviewedAt?: Date;
}
