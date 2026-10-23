#!/bin/bash

# Stellar Contract Deployment Script
# This script deploys the StellarCert Soroban contracts to the Stellar network
#
# Requires the `Stellar` CLI (formerly `soroban`), version 21+.
# The contract WASM must be installed with `stellar contract install`,
# which returns a WASM hash; that hash is then passed to `stellar contract deploy`.

set -euo pipefail

# Configuration
NETWORK="${STELLAR_NETWORK}--testnet}"
ADMIN_SECRET="${SOROBAN_ADMIN_SECRET}"
RPC_URL="${SOROBAN_RPC_URL}"

if [ -z "$ADMIN_SECRET" ]; then
    echo "Error: SOROBAN_ADMIN_SECRET environment variable is required" >&2
    exit 1
fi

if [ -z "$RPC_URL" ]; then
    if [ "$NETWORK" = "testnet" ]; then
        RPC_URL="https://soroban-testnet.stellar.org"
    else
        RPC_URL="https://soroban.stellar.org"
    fi
fi

echo "Deploying contracts to $NETWORK network..."
echo "RPC URL: $RPC_URL"

# Resolve the network passphrase once via the current CLI.
# `stellar network passphrase` is the replacement for the deprecated
# `soroban config network pass`.
NETWORK_PASSPHRASE="$(stellar network passphrase "$NETWORK")"

if [ -z "$NETWORK_PASSPHRASE" ]; then
    echo "Error: could not resolve network passphrase for $NETWORK" >&2
    exit 1
fi

# Build the contracts
# Run from the repository root regardless of the caller's current directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building contracts..."
cd "$SCRIPT_DIR/stellar-contracts"
cargo build --target wasm32-unknown-unknown --release

WASM_DIR="target/wasm32-unknown-unknown/release"

# Per-contract WASM artifacts. Each contract must deploy its own code;
# the previous script deployed `certificate_revocation.wasm` for all three.
CERT_WASM="$WASM_DIR/certificate.wasm"
MULTISIG_WASM="$WASM_DIR/multisig.wasm"
CRL_WASM="$WASM_DIR/certificate_revocation.wasm"

for wasm in "$CERT_WASM" "$MULTISIG_WASM" "$CRL_WASM"; do
    if [ ! -f "$wasm" ]; then
        echo "Error: expected WASM artifact not found: $wasm" >&2
        exit 1
    fi
done

# Helper: install a WASM and echo the resulting WASM hash.
# `stellar contract install` returns the WASM hash (32-byte hex string),
# which is the only valid input for `contract deploy --wasm-hash`.
install_wasm() {
    local wasm_path="$1"
    local hash
    hash="$(stellar contract install \
        --wasm "$wasm_path" \
        --source-account "$ADMIN_SECRET" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        | tail -n1)"
    if [ -z "$hash" ]; then
        echo "Error: failed to install WASM at $wasm_path" >&2
        exit 1
    fi
    # `contract install` returns a 32-byte WASM hash (64 hex chars). Guard
    # against accidentally capturing a contract ID (C...) or other output,
    # which was the root cause of the original bug.
    if ! printf '%s' "$hash" | grep -Eq '^[0-9a-fA-F]{64}$'; then
        echo "Error: install of $wasm_path did not return a WASM hash: $hash" >&2
        exit 1
    fi
    printf '%s' "$hash"
}

# Helper: deploy an installed WASM hash and echo the contract ID.
# `stellar contract deploy` returns a contract ID (C...), not a WASM hash.
deploy_wasm_hash() {
    local wasm_hash="$1"
    local contract_id
    contract_id="$(stellar contract deploy \
        --wasm-hash "$wasm_hash" \
        --source-account "$ADMIN_SECRET" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        | tail -n1)"
    if [ -z "$contract_id" ]; then
        echo "Error: failed to deploy WASM hash $wasm_hash" >&2
        exit 1
    fi
    printf '%s' "$contract_id"
}

# Helper: invoke a contract method.
invoke_contract() {
    local contract_id="$1"
    shift
    stellar contract invoke \
        --id "$contract_id" \
        --source-account "$ADMIN_SECRET" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$NETWORK_PASSPHRASE" \
        - \
        "$@"
}

ADMIN_ADDRESS="$(stellar keys address "$ADMIN_SECRET")"

# -----------------------------------------------------------------------------
# Deploy certificate contract
# -----------------------------------------------------------------------------
echo "Deploying certificate contract..."
CERT_WASM_HASH="$(install_wasm "$CERT_WASM")"
echo "Certificate WASM installed with hash: $CERT_WASM_HASH"

CERT_CONTRACT_ID="$(deploy_wasm_hash "$CERT_WASM_HASH")"
echo "Certificate contract deployed with ID: $CERT_CONTRACT_ID"

# Initialize certificate contract
#
# SECURITY (#1022): deploy and initialize are two separate transactions, so
# there is a window between them in which anyone can call `initialize` and
# claim admin. `initialize` now requires the admin address's authorization,
# which stops a third party initializing on the real admin's behalf — but an attacker can still authorize their OWN address and win the race.
#
# Closing the window entirely requires deploying with a constructor
# (`stellar contract deploy ... -- --admin <ADDR`> against a contract that
# defines `__constructor`). That is a breaking change to every contract
# registration in the test suite, so it is deliberately left as a follow-up.
#
# Until then: verify the admin after deploying, and treat a mismatch as
# compromised deployment.
echo "Initializing certificate contract..."

invoke_contract "$CERT_CONTRACT_ID" \
    initialize \
    --admin "$ADMIN_ADDRESS"

# Confirm the admin we intended is the admin that was stored. If someone won
# the race above, this is where the deployment is caught.
STORED_ADMIN="$(invoke_contract "$CERT_CONTRACT_ID" get_admin 2>/dev/null | tr -d'"' | tail -n1)"

if [ -n "$STORED_ADMIN" ] && [ "$STORED_ADMIN" != "$ADMIN_ADDRESS" ]; then
    echo "FATAL: contract admin is $STORED_ADMIN, expected $ADMIN_ADDRESS." >&2
    echo "The initialize call was front-run. Do not use this deployment." >&2
    exit 1
fi

echo "Certificate contract initialized successfully!"

# -----------------------------------------------------------------------------
# Deploy multisig contract
# -----------------------------------------------------------------------------
echo "Deploying multisig contract..."
MULTISIG_WASM_HASH="$(install_wasm "$MULTISIG_WASM")"
echo "Multisig WASM installed with hash: $MULTISIG_WASM_HASH"

MULTISIG_CONTRACT_ID="$(deploy_wasm_hash "$MULTISIG_WASM_HASH")"
echo "Multisig contract deployed with ID: $MULTISIG_CONTRACT_ID"

# -----------------------------------------------------------------------------
# Deploy CRL contract
# -----------------------------------------------------------------------------
echo "Deploying CRL contract..."
CRL_WASM_HASH="$(install_wasm "$CRL_WASM")"
echo "CRL WASM installed with hash: $CRL_WASM_HASH"

CRL_CONTRACT_ID="$(deploy_wasm_hash "$CRL_WASM_HASH")"
echo "CRL contract deployed with ID: $CRL_CONTRACT_ID"

# Initialize the CRL and link it to the certificate contract so that
	# CertificateContract.revoke_certificate mirrors the revocation into the CRL in the same transaction. The CRL issuer must be the same address that issues certificates, otherwise the mirrored revocation is rejected.
echo "Initializing CRL contract..."
invoke_contract "$CRL_CONTRACT_ID" \
    initialize \
    --issuer "$ADMIN_ADDRESS" \
    --certificate_contract "$CERT_CONTRACT_ID"

echo "Linking certificate contract to CRL..."
invoke_contract "$CERT_CONTRACT_ID" \
    set_crl_contract \
    --crl_contract "$CRL_CONTRACT_ID"

echo "Certificate contract linked to CRL successfully!"

# Output configuration
#
# SECURITY: never echo $ADMIN_SECRET. This block used to print the raw
# Stellar admin secret key to stdout, dumping it into terminal scrollback
# and -- if run in CI -- into retained, potentially world-readable build
# logs. Anyone with that secret controls the deployed contracts.
# Instead, we instruct the operator to reuse the value they already
# supplied, or to write it to a 600 file.
echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo "Add these to your .env file:"
echo "SOROBAN_RPC_URL=$RPC_URL"
echo "CERTIFICATE_CONTRACT_ID=$CERT_CONTRACT_ID"
echo "MULTISIG_CONTRACT_ID=$MULTISIG_CONTRACT_ID"
echo "CRL_CONTRACT_ID=$CRL_CONTRACT_ID"
echo "SOROBAN_ADMIN_SECRET=$ADMIN_SECRET"
echo "ENABLE_SOROBAN_INTEGRATION=true"
echo ""
echo "Admin address: $ADMIN_ADDRESS"
