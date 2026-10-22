# Stellar Address Validation Module

This module provides comprehensive Stellar address validation services for the StellarCert backend application.

## Features

- **Format Validation**: Validates Stellar address format (56 characters starting with 'G')
- `**Checksum Verification**: Uses Stellar SDK to verify address checksums
- `**Network Validation**: Supports both public and testnet networks
- `**Account Existence Check**: Queries Horizon API to verify if accounts exist
- `**Bulk Validation**: Validates multiple addresses in a single request
- `**Caching**: Caches validation results to improve performance
- `**Rate Limiting**: Built-in rate limiting for Horizon API calls

## API Endpoints

### POST `/stellar/address-validation`
Validates a single Stellar address.

**Request Body:**

```json
{
  "address": "GD5J7YFQGYVFSJ4G6LXZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ",
  "network": "public",
  "checkExists": false
}
```

**Response:**

```json
{
  "isValid": true,
  "isFormatValid": true,
  "isChecksumValid": true,
  "isNetworkValid": true,
  "accountExists": true,
  "accountDetails": {
    "id": "GD5J7YFQGYVFSJ4G6LXZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ",
    "sequence": "12345",
    "balances": [
      {
        "asset_type": "native",
        "balance": "1000.0000000"
      }
    ]
  }
}
```

### POST `/stellar/address-validation/bulk
`
Validates multiple Stellar addresses.

**Request Body:**

```json
{
  "addresses": [
    "GD5J7YFQGYVFSJ4G6LXZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ",
    "GB7TNR5G5Z3K3Y3X3K3Y3X3K3Y3X3K3Y3X3K3Y3X3K3Y3X3K3Y3X3Q3"
  ],
  "network": "public",
  "checkExists": false
}
```

**Response:**

```json
{
  "results": [...],
  "total": 2,
  "valid": 1,
  "invalid": 1
}
```

### POST `/stellar/address-validation/check:address`
Validates and checks existence of a Stellar address.

### DELETE `/stellar/address-validation/cache`
Clears the address validation cache.

### GET `/stellar/address-validation/cache/stats`
Returns cache statistics.

## Configuration

The module uses the following environment variables:

- `STELLAR_HORIZON_PUBLIC_URL`: Horizon API URL for public network (default: https://horizon.stellar.org)
- `STELLAR_HORIZON_TESTNET_URL`: Horizon API URL for testnet (default: https://horizon-testnet.stellar.org)
- `STELLAR_CACHE_TTL`: Cache TTL in milliseconds (default: 300000)
- `STELLAR_CACHE_MAX_SIZE`: Maximum cache size (default: 1000)
- `STELLAR_RATE_LIMIT_RPS`: Rate limit requests per second (default: 10)
- `STELLAR_RATE_LIMIT_BURST`: Rate limit burst size (default: 20)

## Usage

```typescript
import { AddressValidationService } from './modules/stellar/services/address-validation.service';

// Inject the service
constructor(private readonly addressValidationService: AddressValidationService) {}

// Validate a single address
const result = await this.addressValidationService.validate({
  address: 'GD5J7YFQGYVFSJ4G6LXZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ',
  network: StellarNetwork.PUBLIC,
  checkExists: true
});

// Validate multiple addresses
const bulkResult = await this.addressValidationService.validateBulk({
  addresses: ['address1', 'address2'],
  network: StellarNetwork.PUBLIC,
  checkExists: false
});
```

## Error Handling

The service provides detailed error information for each validation step:

- **Format Errors**: Invalid address format
- `**Checksum Errors**: Invalid checksum
- `**Network Errors**: Address doesn't match specified network
- `**Account Existence Errors**: Account not found on Horizon
- `**API Errors**: Horizon API connectivity issues

## Testing

The module includes comprehensive unit tests covering:

- Address format validation
- Checksum verification
- Network validation
- Account existence checking
- Bulk validation
- Caching functionality
- Error handling

Run tests with:
```bash
npm test -- stellar/address-validation
```

## Performance Considerations

- **Caching**: Results are cached for 5 minutes by default
- `**Bulk Operations**: Use bulk validation for multiple addresses to reduce API calls
- `**Rate Limiting**: Built-in rate limiting prevents API abuse
- `**Async Processing**: All validation operations are asynchronous

## Security

- `**Input Validation**: All inputs are validated using class-validator
- `**Rate Limiting**: Prevents API abuse and DoS attacks
- `**Error Handling**: Sensitive information is not exposed in error messages
- `**Caching**: Cache entries have TTL to prevent stale data

## Issuer Key Management

On-chain certificate issuance and revocation must be signed by the actual issuer, *not* the platform admin. The admin keypair is reserved for platform-level operations (contract administration, fee sponsorship) and must never be used to sign issuer-attributed actions.

The `issuerAddress` passed to `issueCertificate`/`revokeCertificate` is resolved to a dedicated issuer keypair through the issuer signer service. Signing keys are stored encrypted at rest and are never logged or returned by APIs.

### Configuration

- `ISSUER_KEYPAIR_ENCRYPTION_KEY`: 32-byte key (hex or base64) used to encrypt issuer secret keys at rest. Required in production; the service refuses to start without it when issuer signing is enabled.
- `ISSUER_KEYPOSICY_CHECK_INTERVAL_MS`: Interval for verifying that the derived issuer public key matches the configured `issuerAddress` (default: 300000).

### Resolution Flow

1. `issueCertificate` calls `issuerSignerService.getKeypair(issuerAddress)`.
2. The service looks up the encrypted secret key for that issuer and decrypts it in memory.
3. The derived public key is compared against the requested `issuerAddress`; a mismatch raises an error and the transaction is not submitted.
4. The transaction is signed with the issuer keypair and submitted to Soroban.
5. If no key is registered for the issuer, the call fails with a clear error rather than falling back to the admin keypair.

### Failure Modes

- **Unknown issuer**: `getKeypair` is rejected with an issuer-not-found error; no signing occurs.
- `**Key mismatch**: The derived public key differs from `issuerAddress`; the call fails and is audit-logged.
- `**Decryption failure**: Invalid ciphertext or wrong encryption key raises an error without leaking secret material.
- `**Admin fallback**: Removed. The admin keypair is never returned by issuerAddress resolution.

### Testing

Regression coverage in `soroban.service.spec` and `issuer-signer.service.spec` asserts:

- `issueCertificate` signs with the issuer keypair for the supplied `issuerAddress`.
-  `revokeCertificate` signs with the issuer keypair for the supplied `issuerAddress`.
-  The admin keypair is never used when an issuer address is provided.
- `Unknown issuers and key mismatches fail before transaction submission.
-  Encryption round-trips preserve the issuer secret key and produce the expected public key.

### Migration

Issuers previously relying on admin-signed issuance must register a issuer keypair via the issuer signer service before calling `issueCertificate`/`revokeCertificate`. The public API shape is unchanged: `issuerAddress` is already part of the request and is now enforced as the signing identity. Certificates issued prior to this change remain valid on-chain; their provenance is attributed to the admin address and is not rewritten.
