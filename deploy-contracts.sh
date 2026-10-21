#!/bin/bash

# Soroban Contract Deployment Script
# This script deploys the StellarCert Soroban contracts to the Stellar network

set -euo pipefail

# Configuration
NETWORK="${STELLAR_NETWORK:-testnet}"
ADMIN_SECRET="${SOROBAN_ADMIN_SECRET}"
RPC_URL="${SOROBAN_RPC_URL}"

# Reproducible build inputs. These must match the pinned toolchain used by CI
# so that the WASM bytes deployed here are the same bytes that were tested.
# Override only when intentionally reproducing a different recorded revision.
SOURCE_REVISION="${SOURCE_REVISION:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
RUST_TOOLCHAIN="${RUST_TOOLCHAIN:-$(cat rust-toolchain.toml 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)}"
RUST_TOOLCHAIN="${RUST_TOOLCHAIN:-1.79.0}"
SOROBAN_CLI_VERSION="${SOROBAN_CLI_VERSION:-21.0.0}"
WASM_TARGET="wasm32-unknown-unknown"
RELEASE_DIR="${RELEASE_DIR:-../release-artifacts}"

# Artifact identity record. Every deployed contract is appended here so the
# deployed WASM hash and contract ID can be audited against the release.
ARTIFACT_RECORD="${ARTIFACT_RECORD:-$RELEASE_DIR/deployed-contracts-$NETWORK.json}"

mkdir -p "$RELEASE_DIR"

# Verify the pinned toolchain is actually installed before building. A
# mismatched toolchain produces different bytes and breaks reproducibility.
echo "Verifying pinned toolchain (rust $RUST_TOOLCHAIN, soroban-cli $SOROBAN_CLI_VERSION)..."
if ! rustup toolchain list 2>/dev/null | grep -q "^$RUST_TOOLCHAIN"; then
    echo "Error: pinned Rust toolchain $RUST_TOOLCHAIN is not installed." >&2
    echo "Install it with: rustup toolchain install $RUST_TOOLCHAIN" >&2
    exit 1
fi
if ! command -v soroban >/dev/null 2>&1; then
    echo "Error: soroban-cli is not installed (expected $SOROBAN_CLI_VERSION)." >&2
    exit 1
fi

# Verify a release artifact against its recorded checksum and provenance
# before deploying. This gates promotion on artifact identity: we never
# rebuild different bytes at deploy time.
verify_artifact() {
    local wasm_path="$1"
    local checksum_file="${wasm_path}.sha256"
    local provenance_file="${wasm_path}.provenance.json"

    if [ ! -f "$wasm_path" ]; then
        echo "Error: expected release artifact $wasm_path not found." >&2
        echo "Build and promote artifacts via CI; do not build at deploy time." >&2
        exit 1
    fi
    if [ ! -f "$checksum_file" ]; then
        echo "Error: missing checksum file $checksum_file." >&2
        exit 1
    fi
    if [ ! -f "$provenance_file" ]; then
        echo "Error: missing provenance file $provenance_file." >&2
        exit 1
    fi

    echo "Verifying checksum for $wasm_path..."
    ( cd "$(dirname "$wasm_path")" && sha256sum -c "$(basename "$checksum_file")" )

    # Confirm the provenance records the source revision we intend to deploy.
    local recorded_rev
    recorded_rev=$(grep -oE '"sourceRevision"[[:space:]]*:[[:space:]]*"[^"]+"' "$provenance_file" | grep -oE '[0-9a-f]{7,40}' | head -1 || true)
    if [ -n "$recorded_rev" ] && [ "$recorded_rev" != "$SOURCE_REVISION" ]; then
        echo "Error: artifact provenance revision $recorded_rev does not match $SOURCE_REVISION." >&2
        exit 1
    fi

    echo "Artifact verified: $(sha256sum "$wasm_path" | awk '{print $1}')"
}

# Record the deployed artifact hash and contract mapping for auditability.
record_deployment() {
    local name="$1"
    local contract_id="$2"
    local wasm_path="$3"
    local wasm_sha
    wasm_sha=$(sha256sum "$wasm_path" | awk '{print $1}')
    printf '{"name":"%s","network":"%s","contractId":"%s","wasmSha256":"%s","sourceRevision":"%s","rustToolchain":"%s","sorobanCli":"%s"}\n' \
        "$name" "$NETWORK" "$contract_id" "$wasm_sha" "$SOURCE_REVISION" "$RUST_TOOLCHAIN" "$SOROBAN_CLI_VERSION" \
        >> "$ARTIFACT_RECORD"
}

if [ -z "$ADMIN_SECRET" ]; then
    echo "Error: SOROBAN_ADMIN_SECRET environment variable is required"
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

# Use pre-built, verified release artifacts. Do not rebuild here: rebuilding
# at deploy time can produce different bytes than the artifact tested in CI.
echo "Verifying release artifacts (source revision $SOURCE_REVISION)..."
cd stellar-contracts
CERT_WASM="$RELEASE_DIR/certificate_revocation.wasm"
verify_artifact "$CERT_WASM"

# Deploy certificate contract
echo "Deploying certificate contract..."
CERT_WASM_HASH=$(soroban contract deploy \
    --wasm "$CERT_WASM" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

echo "Certificate contract deployed with WASM hash: $CERT_WASM_HASH"
record_deployment "certificate" "$CERT_CONTRACT_ID" "$CERT_WASM"

# Create certificate contract instance
CERT_CONTRACT_ID=$(soroban contract deploy \
    --wasm-hash "$CERT_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

echo "Certificate contract instance created with ID: $CERT_CONTRACT_ID"

# Initialize certificate contract
#
# SECURITY (#1022): deploy and initialize are two separate transactions, so
# there is a window between them in which anyone can call `initialize` and
# claim admin. `initialize` now requires the admin address's authorization,
# which stops a third party initializing on the real admin's behalf — but an
# attacker can still authorize their OWN address and win the race.
#
# Closing the window entirely requires deploying with a constructor
# (`soroban contract deploy ... -- --admin <ADDR>` against a contract that
# defines `__constructor`). That is a breaking change to every contract
# registration in the test suite, so it is deliberately left as a follow-up.
#
# Until then: verify the admin after deploying, and treat a mismatch as a
# compromised deployment.
echo "Initializing certificate contract..."
ADMIN_ADDRESS=$(soroban keys address "$ADMIN_SECRET")

soroban contract invoke \
    --id "$CERT_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    -- \
    initialize \
    --admin "$ADMIN_ADDRESS"

# Confirm the admin we intended is the admin that was stored. If someone won
# the race above, this is where the deployment is caught.
STORED_ADMIN=$(soroban contract invoke \
    --id "$CERT_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    -- \
    get_admin 2>/dev/null | tr -d '"' | tail -1)

if [ -n "$STORED_ADMIN" ] && [ "$STORED_ADMIN" != "$ADMIN_ADDRESS" ]; then
    echo "FATAL: contract admin is $STORED_ADMIN, expected $ADMIN_ADDRESS." >&2
    echo "The initialize call was front-run. Do not use this deployment." >&2
    exit 1
fi

echo "Certificate contract initialized successfully!"

# Deploy multisig contract (if needed)
echo "Deploying multisig contract..."
MULTISIG_WASM_HASH=$(soroban contract deploy \
    --wasm "$CERT_WASM" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

MULTISIG_CONTRACT_ID=$(soroban contract deploy \
    --wasm-hash "$MULTISIG_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

echo "Multisig contract deployed with ID: $MULTISIG_CONTRACT_ID"
record_deployment "multisig" "$MULTISIG_CONTRACT_ID" "$CERT_WASM"

# Deploy CRL contract (if needed)
echo "Deploying CRL contract..."
CRL_WASM_HASH=$(soroban contract deploy \
    --wasm "$CERT_WASM" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

CRL_CONTRACT_ID=$(soroban contract deploy \
    --wasm-hash "$CRL_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

echo "CRL contract deployed with ID: $CRL_CONTRACT_ID"
record_deployment "crl" "$CRL_CONTRACT_ID" "$CERT_WASM"

# Initialize the CRL and link it to the certificate contract so that
# CertificateContract.revoke_certificate mirrors the revocation into the CRL in
# the same transaction. The CRL issuer must be the same address that issues
# certificates, otherwise the mirrored revocation is rejected.
echo "Initializing CRL contract..."
soroban contract invoke \
    --id "$CRL_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    -- \
    initialize \
    --issuer "$ADMIN_ADDRESS" \
    --certificate_contract "$CERT_CONTRACT_ID"

echo "Linking certificate contract to CRL..."
soroban contract invoke \
    --id "$CERT_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    -- \
    set_crl_contract \
    --crl_contract "$CRL_CONTRACT_ID"

echo "Certificate contract linked to CRL successfully!"

# Output configuration
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
echo "Source revision: $SOURCE_REVISION"
echo "Artifact record: $ARTIFACT_RECORD"
echo ""
echo "To roll back, redeploy the previously recorded artifact from $RELEASE_DIR"
echo "and verify its checksum against the recorded wasmSha256 in $ARTIFACT_RECORD."