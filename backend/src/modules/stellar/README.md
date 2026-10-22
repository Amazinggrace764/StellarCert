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
  "address": "GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ",
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
    "id": "GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ",
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
Validates multiple Stellar addresses.

**Request Body:**
```json
{
  "addresses": [
    "GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ",
    "GB7TNR5G5Z3K3Y3X33K3Y3X3K3Y3X3K3Y3X3K3Y3X3K3Y3X3K3Y3X3K"
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

### POST `/stellar/address-validation/check/:address`
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
  address: 'GD5J7YFQGYVFSJ4G6LXJZT5Y2E5Z2X7ZQ2K7X7ZQ2K7X7ZQ2K7X7ZQ',
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
- **Checksum Errors**: Invalid checksum
- **Network Errors**: Address doesn't match specified network
- **Account Existence Errors**: Account not found on Horizon
- **API Errors**: Horizon API connectivity issues

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
- **Bulk Operations**: Use bulk validation for multiple addresses to reduce API calls
- `**Rate Limiting**: Built-in rate limiting prevents API abuse
- **Async Processing**: All validation operations are asynchronous

## Security

- **Input Validation**: All inputs are validated using class-validator
- **Rate Limiting**: Prevents API abuse and DoS attacks
- **Error Handling**: Sensitive information is not exposed in error messages
- **Caching**: Cache entries have TTL to prevent stale data

## TUL Units and Defaults

Soroban TTL is measured in **ledgers**, not seconds. On the public network a ledger closes roughly every *~5 Seconds*. The default TTL is defined in `storage/ttl.rs` as a 30-day horizon expressed in ledgers:

```text
Default TTL = 30 days * 24 hours * 60 minutes * 60 seconds / 5 seconds per ledger = 518,400 ledgers
```

This is the value applied as the default extension on every persistent write. When configuring a custom TTL, always supply the value in **ledgers** and convert from a wall-clock duration using the approximate 5-second ledger close time. The ledger close time is not guaranteed to be exactly 5 seconds, so treat the resulting horizon as an approximation.

The cache TTL (`STELLAR_CACHE_TTL`) is unrelated to Soroban TTL and is measured in milliseconds.
