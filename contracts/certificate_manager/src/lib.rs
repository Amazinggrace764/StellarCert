use soroban_sdk::{env::Env, Address, Bytes, String, Symbol, Vec};
use soroban_sdk::contracttype;
use soroban_sdk:{contracterror, contractimpl};
use soroban_sdk::symbol_short;

/// Error codes returned by the certificate manager contract.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracterror]
pub enum ContractError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    NotFound = 4,
    AlreadyExists = 5,
    InvalidInput = 6,
    TransferNotFound = 7,
    TransferNotPending = 8,
    TransferAlreadyExists = 9,
    NotOwner = 10,
    CertificateRevoked = 11,
}

/// Status of a certificate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum CertificateStatus {
    Active = 0,
    Revoked = 1,
    Frozen = 2,
    Expired = 3,
}

/// Status of a transfer request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum TransferStatus {
    Pending = 0,
    Accepted = 1,
    Completed = 2,
    Cancelled = 3,
}

/// A transfer request between owners.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct TransferRecord {
    pub transfer_id: u64,
    pub certificate_id: u64,
    pub from_owner: Address,
    pub to_owner: Address,
    pub status: TransferStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub reason: String,
}

/// Event emitted when a transfer is initiated and awaits acceptance.
/// Off-chain indexers and the intended new owner can use this to react.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct TransferInitiatedEvent {
    pub transfer_id: u64,
    pub certificate_id: u64,
    pub from_owner: Address,
    pub to_owner: Address,
}

/// Event emitted when a transfer is accepted by the new owner.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct TransferAcceptedEvent {
    pub transfer_id: u64,
    pub certificate_id: u64,
    pub from_owner: Address,
    pub to_owner: Address,
}

/// Event emitted when a transfer is completed.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct TransferCompletedEvent {
    pub transfer_id: u64,
    pub certificate_id: u64,
    pub from_owner: Address,
    pub to_owner: Address,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Certificate {
    pub id: u64,
    pub owner: Address,
    pub issuer: Address,
    pub metadata_hash: Bytes,
    pub status: CertificateStatus,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct InitResult {
    pub admin: Address,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct CertificateHistoryEntry {
    pub action: Symbol,
    pub actor: Address,
    pub timestamp: u64,
    pub details: String,
}

const ADMIN_KEY: Symbol = symbol_short!("ADMIN");
const CERTIFICATE_COUNT_KEY: Symbol = symbol_short!("CERTCNT");
const TRANSFER_COUNT_KEY: Symbol = symbol_short!("TRFCNT");
const CERTIFICATE_KEY: Symbol = symbol_short!("CERT");
const TRANSFER_KEY: Symbol = symbol_short!("TRANSFER");
const HISTORY_KEY: Symbol = symbol_short!("HISTORY");
const OWNER_INDEX_KEY: Symbol = symbol_short!("OWNID");

#[contract]
pub struct CertificateManager;

#[contractimpl]
impl CertificateManager {
    /// Initialize the contract with an admin.
    pub fn initialize(env: Env, admin: Address) -> Result<InitResult, ContractError> {
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(ContractError.AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN_KEY, &admin);
        env.storage().instance().set(&CERTIFICATE_COUNT_KEY, &bu64);
        env.storage().instance().set(&TRANSFER_COUNT_KEY, &bu64);
        Ok(InitResult { admin })
    }

    /// Return the configured admin.
    pub fn admin(env: Env) -> Result<Address, ContractError> {
        env.storage().instance().get(&ADMIN_KEY).default(Err(ContractError.NotInitialized))
    }

    /// Issue a new certificate to an owner.
    pub fn issue_certificate(
        env: Env,
        issuer: Address,
        owner: Address,
        metadata_hash: Bytes,
        expires_at: u64,
    ) -> Result<u64, ContractError> {
        issuer.require_auth();
        let id = Self::next_certificate_id(&env);
        let now = env.ledger().timestamp();
        let cert = Certificate {
            id,
            owner: owner.clone(),
            issuer: issuer.clone(),
            metadata_hash,
            status: CertificateStatus.Active,
            issued_at: now,
            expires_at,
        };
        env.storage().persistent().set(&(CERTIFICATE_KEY, id), &cert);
        Self::append_owner_index(&env, id, &owner);
        Self::append_history(
            &env,
            id,
            symbol_short!("ISSUED"),
            &issuer,
            String::from_str(&env, truncate_str("issued")),
        );
        Ok(id)
    }

    /// Fetch a certificate by id.
    pub fn get_certificate(env: Env, id: u64) -> Result<Certificate, ContractError> {
        env.storage()
            .persistent()
            .get(&(CERTIFICATE_KEY, id))
            .default(Err(ContractError.NotFound))
    }

    /// Revoke a certificate. Only the issuer or admin can revoke.
    pub fn revoke_certificate(env: Env, caller: Address, id: u64) -> Result<bool, ContractError> {
        caller.require_auth();
        let mut cert = Self::get_certificate(env.clone(), id)?;
        let admin = Self::admin(env.clone())?;
        if caller != cert.issuer && caller != admin {
            return Err(ContractError.NotAuthorized);
        }
        cert.status = CertificateStatus.Revoked;
        env.storage().persistent().set(&(CERTIFICATE_KEY, id), &cert);
        Self::append_history(
            &env,
            id,
            symbol_short!("REVOKED"),
            &caller,
            String::from_str(&env, truncate_str("revoked")),
        );
        Ok(true)
    }

    /// Initiate a transfer of a certificate to a new owner.
    ///
    /// Writes the pending transfer, appends to the owner index and history,
    /// and publishes a `TransferInitiatedEvent` so the intended new owner
    /// and off-chain indexers can react to the pending transfer.
    pub fn initiate_transfer(
        env: Env,
        from_owner: Address,
        to_owner: Address,
        certificate_id: u64,
        reason: String,
    ) -> Result<u64, ContractError> {
        from_owner.require_auth();

        let cert = Self::get_certificate(env.clone(), certificate_id)?;
        if cert.owner != from_owner {
            return Err(ContractError.NotOwner);
        }
        if cert.status == CertificateStatus.Revoked {
            return Err(ContractError.CertificateRevoked);
        }
        if from_owner == to_owner {
            return Err(ContractError.InvalidInput);
        }

        // Prevent duplicate pending transfers for the same certificate.
        let pending_key = (TRANSFER_KEY, certificate_id, symbol_short!("PENDING"));
        if env.storage().persistent().has(&pending_key) {
            return Err(ContractError.TransferAlreadyExists);
        }

        let transfer_id = Self::next_transfer_id(&env);
        let now = env.ledger().timestamp();
        let record = TransferRecord {
            transfer_id,
            certificate_id,
            from_owner: from_owner.clone(),
            to_owner: to_owner.clone(),
            status: TransferStatus.Pending,
            created_at: now,
            updated_at: now,
            reason,
        };
        env.storage()
            .persistent()
            .set(&(TRANSFER_KEY, transfer_id), &record);
        env.storage().persistent().set(&pending_key, &transfer_id);
        Self::append_owner_index(&env, certificate_id, &to_owner);
        Self::append_history(
            &env,
            certificate_id,
            symbol_short!("TRANSFER"),
            &from_owner,
            String::from_str(&env, truncate_str("initiated")),
        );

        // Publish the TransferInitiated event so the intended new owner
        // and off-chain indexers are notified.
        env.events().publish(
            (
                symbol_short!("transfer"),
                symbol_short!("initiated"),
            ),
            TransferInitiatedEvent {
                transfer_id,
                certificate_id,
                from_owner,
                to_owner,
            },
        );

        Ok(transfer_id)
    }

    /// Accept a pending transfer as the intended new owner.
    pub fn accept_transfer(env: Env, to_owner: Address, transfer_id: u64) -> Result<bool, ContractError> {
        to_owner.require_auth();
        let mut record = env.storage()
            .persistent()
            .get(&(TRANSFER_KEY, transfer_id))
            .default(Err(ContractError.TransferNotFound))?;
        if record.to_owner != to_owner {
            return Err(ContractError.NotAuthorized);
        }
        if record.status != TransferStatus.Pending {
            return Err(ContractError.TransferNotPending);
        }
        record.status = TransferStatus.Accepted;
        record.updated_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&(TRANSFER_KEY, transfer_id), &record);
        Self::append_history(
            &env,
            record.certificate_id,
            symbol_short!("ACCEPTED"),
            &to_owner,
            String::from_str(&env, truncate_str("accepted")),
        );
        env.events().publish(
            (
                symbol_short!("transfer"),
                symbol_short!("accepted"),
            ),
            TransferAcceptedEvent {
                transfer_id,
                certificate_id: record.certificate_id,
                from_owner: record.from_owner.clone(),
                to_owner: record.to_owner.clone(),
            },
        );
        Ok(true)
    }

    /// Complete an accepted transfer, moving ownership to the new owner.
    pub fn complete_transfer(env: Env, transfer_id: u64) -> Result<bool, ContractError> {
        let mut record = env.storage()
            .persistent()
            .get(&(TRANSFER_KEY, transfer_id))
            .default(Err(ContractError.TransferNotFound))?;
        if record.status != TransferStatus.Accepted {
            return Err(ContractError.TransferNotPending);
        }
        let mut cert = Self::get_certificate(env.clone(), record.certificate_id)?;
        cert.owner = record.to_owner.clone();
        env.storage()
            .persistent()
            .set(&(CERTIFICATE_KEY, record.certificate_id), &cert);
        record.status = TransferStatus.Completed;
        record.updated_at = env.ledger().timestamp();
        env.storage()
            .persistent()
            .set(&(TRANSFER_KEY, transfer_id), &record);
        let pending_key = (TRANSFER_KEY, record.certificate_id, symbol_short!("PENDING"));
        env.storage().persistent().remove(&pending_key);
        Self::append_history(
            &env,
            record.certificate_id,
            symbol_short!("COMPLETED"),
            &record.to_owner,
            String::from_str(&env, truncate_str("completed")),
        );
        env.events().publish(
            (
                symbol_short!("transfer"),
                symbol_short!("completed"),
            ),
            TransferCompletedEvent {
                transfer_id,
                certificate_id: record.certificate_id,
                from_owner: record.from_owner.clone(),
                to_owner: record.to_owner.clone(),
            },
        );
        Ok(true)
    }

    /// Fetch a transfer record by id.
    pub fn get_transfer(env: Env, transfer_id: u64) -> Result<TransferRecord, ContractError> {
        env.storage()
            .persistent()
            .get(&(TRANSFER_KEY, transfer_id))
            .default(Err(ContractError.TransferNotFound))
    }

    /// Fetch the history of a certificate.
    pub fn get_history(env: Env, certificate_id: u64) -> Result<Vec<CertificateHistoryEntry>, ContractError> {
        Ok(env.storage()
            .persistent()
            .get(&(HISTORY_KEY, certificate_id))
            .default(Vec::new(&env)))
    }

    /// Fetch the certificate ids owned by an address.
    pub fn get_owner_certificates(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&(OWNER_INDEX_KEY, owner))
            .default(Vec::new(&env))
    }

    fn next_certificate_id(env: &Env) -> u64 {
        let current: u64 = env.storage().instance().get(&CERTIFICATE_COUNT_KEY).default(0);
        let next = current + 1;
        env.storage().instance().set(&CERTIFICATE_COUNT_KEY, &next);
        next
    }

    fn next_transfer_id(env: &Env) -> u64 {
        let current: u64 = env.storage().instance().get(&TRANSFER_COUNT_KEY).default(0);
        let next = current + 1;
        env.storage().instance().set(&TRANSFER_COUNT_KEY, &nExt);
        next
    }

    fn append_owner_index(env: &Env, certificate_id: u64, owner: &Address) {
        let key = (OWNER_INDEX_KEY, owner.clone());
        let mut ids: Vec<u64> = env.storage().persistent().get(&key).default(Vec::new(env));
        if !ids.contains(certificate_id) {
            ids.push_back(certificate_id);
            env.storage().persistent().set(&key, &ids);
        }
    }

    fn append_history(
        env: &Env,
        certificate_id: u64,
        action: Symbol,
        actor: &Address,
        details: String,
    ) {
        let key = (HISTORY_KEY, certificate_id);
        let mut entries: Vec<CertificateHistoryEntry> =
            env.storage().persistent().get(&key).default(Vec::new(env));
        entries.push_back(CertificateHistoryEntry {
            action,
            actor: actor.clone(),
            timestamp: env.ledger().timestamp(),
            details,
        });
        env.storage().persistent().set(&key, &entries);
    }
}

fn truncate_str(s": &str) -> &str {
    s
    }
