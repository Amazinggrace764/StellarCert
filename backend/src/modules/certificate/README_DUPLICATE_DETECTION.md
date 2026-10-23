# Duplicate Certificate Prevention System

## Overview

The Duplicate Certificate Prevention System provides intelligent duplicate detection for certificate issuance in StellarCert. It helps prevent accidental or fraudulent duplicate certificates by using configurable rules, fuzzy matching algorithms, and override mechanisms.

## Features

### 🔍 **Intelligent Detection**
- **Exact Matching**: Detects identical certificates based on recipient email, name, title, and issuer
- **Fuzzy Matching**: Uses Levenshtein distance algorithm to detect similar names, emails, and titles
- **Configurable Thresholds**: Adjustable similarity thresholds for different types of matches
- **Time Windows**: Limit duplicate checks to specific time periods

### ⚙️ **Configurable Rules**
- **Multiple Rule Types**: Pre-configured rules for different duplicate scenarios
- **Priority System**: Rules are evaluated by priority to determine the most appropriate action
- **Enable/Disable Rules**: Turn specific rules on or off based on requirements
- **Custom Rules**: Add new rules for specific use cases

### 🚠 **Action Types**
- **Block**: Completely prevents certificate issuance when duplicates are detected
- **Warn**: Issues a warning but allows issuance with override reason
- **Allow**: Proceeds without intervention (for logging purposes only)

### 📆 **Admin Reports**
- **Duplicate Analytics**: Comprehensive reports on duplicate detection statistics
- **Time-based Analysis**: View duplicates within specific date ranges
- **Breakdown by Type**: Analysis by issuer, duplicate type, and frequency
- **Export Capabilities**: Generate reports for compliance and auditing

### 🔔 **Override Mechanism**
- **Override Requests**: Users can request overrides for flagged duplicates
- **Admin Approval**: Administrators can review and approve/deny override requests
- **Audit Trail**: Complete history of override requests and decisions
- **Reason Tracking**: Required justification for all overrides

## Architecture

### Core Components

1. **DuplicateDetectionService**: Main service for duplicate detection logic
2. **DuplicateDetectionController**: REST API endpoints for duplicate detection
3. **Certificate Entity**: Enhanced with duplicate tracking fields
4. **Configuration System**: Pre-defined configurations for different scenarios

### Database Schema

The certificate entity includes the following duplicate-related fields:
```typescript
class Certificate {
  // ... existing fields
  
  @Column({ default: false })
  isDuplicate: boolean;

  @Column({' nullable': true })
  duplicateOfId: string;

  @Column( { nullable: true })
  overrideReason: string;

  @Column({ nullable: true })
  overridenBy: string;
}
```

## Configuration

### Default Configuration

The system comes with three pre-configured setups:

1. **Standard**: Balanced approach with warnings for most duplicates
2. **Strict**: Blocks most duplicates, minimal override options
3. **Lenient**: Allows most duplicates with logging only

### Rule Configuration

Each rule includes:

- **Name & Description**: Human-readable rule identification
- **Enabled Status**: Turn rules on/off
- **Action Type**: Block, warn, or allow
- **Threshold**: Similarity threshold (0.0 - 1.0)
- **Check Fields**: Which fields to compare
- **Fuzzy Matching**: Enable/disable fuzzy matching
- **Time Window**: Limit checks to specific time periods
- **Priority**: Rule evaluation order

### Example Rule Configuration

```typescript
{
  id: 'email_fuzzy',
  name: 'Email Fuzzy Match',
  description: 'Detect similar email addresses with typos',
  enabled: true,
  action: 'warn',
  threshold: 0.85,
  checkFields: ['recipientEmail', 'title', 'issuerId'],
  fuzzyMatching: true,
  timeWindow: 30, // 30 days
  priority: 80,
}
```

## API Endpoints

### Duplicate Detection

#### `Post /duplicate-detection/check`
Check for potential duplicates before certificate issuance.

**Request Body:**
```json
{
  "certificateData": {
    "issuerId": "uuid",
    "recipientEmail": "user@example.com",
    "recipientName": "John Doe",
    "title": "Certificate Title"
  },
  "config": {
    "enabled": true,
    "defaultAction": "warn",
    "rules": [...]
  }
}
```

**Response:**
```json
{
  "isDuplicate": true,
  "confidence": 0.92,
  "action": "warn",
  "matches": [
    {
      "certificateId": "uuid",
      "similarityScore": 0.92,
      "matchType": "fuzzy_email"
    }
  ],
  "message": "Warning: Found potential duplicate..."
}
```

### Admin Reports

#### `GET /duplicate-detection/report?startDate=2024-01-01&endDate=2024-12-31`
Generate duplicate reports for admin users.

**Response:**
```json
{
  "id": "report_1234567890",
  "totalDuplicates": 25,
  "duplicatesByIssuer": {
    "issuer-1": 15,
    "issuer-2": 10
  },
  "duplicatesByType": {
    "exact": 8,
    "fuzzy": 17
  },
  "timeRange": {
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-12-31T23:59:59Z"
  },
  "generatedAt": "2024-12-31T23:59:59Z",
  "duplicates": [...]
}
```

### Override Management

#### `POST /duplicate-detection/override-request`
Create an override request for a duplicate certificate.

**Request Body:**
```json
{
  "certificateId": "uuid",
  "reason": "Business requirement for re-issuance",
  "requestedBy": "user-uuid"
}
```

#### `POST /duplicate-detection/override-request/:requestId/approve`
Approve an override request (admin only).

**Request Body:**
```json
{
  "approvedBy": "admin-uuid"
}
```

## Integration Guide

### Certificate Service Integration

The certificate service automatically integrates duplicate detection:

```typescript
async create(
  createCertificateDto: CreateCertificateDto,
  duplicateConfig?: DuplicateDetectionConfig,
  overrideReason?: string,
): Promise<Certificate> {
  // Check for duplicates if config is provided
  if (duplicateConfig?.enabled) {
    const duplicateCheck = await this.duplicateDetectionService.checkForDuplicates(
      createCertificateDto,
      duplicateConfig,
    );

    if (duplicateCheck.isDuplicate) {
      if (duplicateCheck.action === 'block') {
        throw new ConflictException({
          message: 'Certificate issuance blocked due to potential duplicate',
          details: duplicateCheck,
        });
      } else if (duplicateCheck.action === 'warn' && !overrideReason) {
        throw new ConflictException({
          message: 'Warning: Potential duplicate detected. Override reason required.',
          details: duplicateCheck,
          requiresOverride: true,
        });
      }
    }
  }

  // Proceed with certificate creation...
}
```

### Frontend Integration

Frontend applications should:

1. **Pre-validate**: Check for duplicates before form submission
2. **Handle Warnings**: Display duplicate warnings to users
3. **Collect Override Reasons**: Require justification for overrides
4. **Show Admin Reports**: Display duplicate analytics to administrators

## Fuzzy Matching Algorithm

The system uses the Levenshtein distance algorithm for fuzzy matching:

### Email Matching
- **Domain Priority**: Same domain emails get higher similarity scores
- **Local Part Comparison**: Compares username parts with fuzzy matching
- **Typo Detection**: Identifies common email typos (e.g., `gamil.com` vs `gmail.com`)

### Name Matching
- **Character Similarity**: Measures character-level differences
- **Case Insensitive**: Ignores case differences
- **Whitespace Tolerance**: Handles extra or missing spaces

### Title Matching
- **Word Similarity**: Compares individual words
- **Phrase Matching**: Considers word order and structure
- **Abbreviation Handling**: Recognizes common abbreviations

## Performance Considerations

### Database Optimization
- **Indexed Fields**: `recipientEmail`, `recipientName`, `title`, `issuerId` are indexed
- **Query Optimization**: Uses TypeORM query builder for efficient database queries
- **Time Window Filtering**: Limits query scope with time-based filters

### Caching Strategy
- **Rule Caching**: Configuration rules are cached in memory
- **Result Caching**: Duplicate check results can be cached for short periods
- **Report Caching**: Generated reports are cached for admin dashboards

### Scalability
- **Async Processing**: Duplicate checks run asynchronously
- **Batch Processing**: Multiple certificates can be checked in batches
- **Queue Integration**: Can integrate with job queues for high-volume scenarios

## Security Considerations

### Data Privacy
- **PII Protection**: Personal information is handled according to privacy policies
- **Audit Logging**: All duplicate detection activities are logged
- **Access Control**: Admin features require appropriate permissions

### Fraud Prevention
- **Rate Limiting**: Prevents abuse of override mechanisms
- ,**Pattern Detection**: Identifies suspicious duplicate patterns
- **Manual Review**: High-risk duplicates require manual review

## Testing

### Unit Tests
- **Service Tests**: Comprehensive testing of duplicate detection logic
- **Algorithm Tests**: Validation of fuzzy matching algorithms
- **Configuration Tests**: Rule configuration validation

### Integration Tests
- **API Tests**: End-to-end testing of duplicate detection endpoints
- **Database Tests**: Integration with TypeORM and PostgreSQL
- **Frontend Tests**: UI integration for duplicate warnings

### Performance Tests
- **Load Testing**: High-volume duplicate detection scenarios
- **Database Performance**: Query optimization validation
- **Memory Usage**: Resource consumption monitoring

## Monitoring and Analytics

### Metrics
- **Detection Rate**: Percentage of certificates flagged as duplicates
- **Override Rate**: Percentage of flagged certificates that were overridden
- **False Positives**: Incorrect duplicate detections
- **Processing Time**: Average time for duplicate checks

### Alerts
- **High Duplicate Volume**: Unusual spike in duplicate detections
- **Override Abuse**: Excessive override requests
- **System Performance**: Slow duplicate detection processing

## Future Enhancements

### Machine Learning
- **Pattern Recognition**: ML models for improved duplicate detection
- **Adaptive Thresholds**: Dynamic threshold adjustment based on patterns
- **Anomaly Detection**: Identification of unusual certificate issuance patterns

### Advanced Features
- **Cross-Platform Detection**: Detect duplicates across different systems
- **Real-time Monitoring**: Live dashboard for duplicate detection metrics
- **Automated Workflows**: Automated approval for low-risk duplicates

## Troubleshooting

### Common Issues

1. **False Positives**: Adjust threshold values in rule configuration
2. **Missing Duplicates**: Enable fuzzy matching or lower thresholds
3. **Performance Issues**: Check database indexes and query optimization
4. **Override Problems**: Verify user permissions and workflow configuration

### Debug Mode

Enable debug logging for detailed duplicate detection information:

```typescript
const config = {
  ...defaultConfig,
  logDuplicates: true,
  debug: true, // Enable detailed logging
};
```

## Merkle Root Domain Separation

Certificate issuance also produces a Merkle root in `crl.rs` for off-chain inclusion proofs. The Merkle tree must not allow an attacker to present an internal node as a leaf or to craft alternative trees with the same root. Therefore the hashing rules are:

- **Leaf hash**: `sha256(0x00 || id)` instead of `sha256(id)`.
- **Internal node hash**: `sha256(0x01 || left || right)` instead of `sha256(left || right)`.
- **Odd counts**: Odd nodes are not promoted by duplicating the last leaf. The last node is carried to the next level unchanged, so the tree shape is deterministic and cannot be ambiguously reinterpreted.

Any off-chain inclusion proof must be verified using the same domain tags and the same odd-node handling as the on-chain `crl.rs` implementation. The duplicate detection system does not alter this behavior; it only decides whether a certificate is allowed to be issued and thus enter the tree.

## Support

For issues or questions about the duplicate detection system:

1. Check the logs for detailed error information
2. Review the configuration for rule conflicts
3. Verify database indexes and performance
4. Contact the development team for advanced issues

## Persistent Entry TVL and Archival

Certificate records are stored as Stellar persistent ledger entries. Persistent entries have a limited TTL and are archived (evicted from live storage) once that TTL expires. A certificate may remain valid for years while its ledger entry TTL is much shorter, so TTL must be extended on both write and read paths.

### TTL bumping on read
The certificate module now extends the persistent entry TTL on read for hot entries:

- `get_certificate` and `is_valid` call `persistent::extend_ttl` for the returned certificate entry.
- `set_persistent` continues to extend the TTL on write.
- Read-path extension is best-effort: the read still succeeds if the TTL bump fails, and failures are logged.

### Archival restore requirement

If a persistent entry has already been archived, a read cannot extend its TTL. The entry must first be restored from the archive (Stellar `RestoreFootprint` operation) before it can be read or re-extended. Operators should:

1. Monitor archival events for certificate entries.
2. Run a periodic maintenance job that calls `bump_certificate_ttl` for active certificates.
3. Restore archived entries before attempting to read or bump them.

### Maintenance entry point

In addition to read-path bumping, the module exposes `bump_certificate_ttl`. It extends the TTL for a given certificate entry without mutating certificate data, and is intended for scheduled maintenance jobs that keep long-lived certificates hot.

### Behavior summary

| Path                       | TTL bump | Notes
 |----------------------------|----------|-----------------------------------------------|
 | `set_persistent`            | Yes      | Write path; always extends TTL.                        |
 | `get_certificate`           | Yes      | Best-effort; extends TTL on successful read.              |
 | `is_valid`                  | Yes      | Best-effort; extends TTL on successful read.              |
 | `batch_verify_certificates` | Yes      | Extends TTL for each certificate returned.            |
 | `certificate_exists`        | No      | Existence check only; no TTL bump.                     |
 | Pagination                  | Yes      | Extends TTL for each certificate in the page.            |
 | `bump_certificate_ttl`       | Yes      | Maintenance entry point for scheduled jobs.            |

### Regression coverage

The following behaviors are covered by automated tests:

- Reading a certificate extends its persistent entry TTL.
- `get_certificate` and `is_valid` bump TTL without mutating certificate data.
- Batch verification and pagination bump TTL for every returned entry.
- A failed TTL bump does not cause the read to fail.
- `bump_certificate_ttl` has no effect on certificate data and is idempotent.
- Reading an archived entry returns an explicit error instructing operators to restore it.
