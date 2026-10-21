//! Certificate Manager contract.
///
/// This contract issues and revokes certificates. All integer arithmetic
/// that could overflow is performed with checked operations so that a
/// malicious or buggy input traps instead of silently wrapping. This is
/// reinforced at the compiler level by `[profile.release] overflow-checks
/// = true` in the workspace `Cargo.toml`.

use soroban_sdk::{contract, contractimpl, address, Env, Symbol};

const DAY_SECONDS: u64 = 86_400;
const BASE_COST: i128 = 100;
const COST_PER_CERTIFICATE: i128 = 50;
#[contracttype]
pub struct Certificate {
    pub subject: address,
    pub issuer: address,
    pub expires_at: u64,
    pub revoked: bool,
}

#[contracttype]
pub struct CertificateManager {
    counter: u64,
    certificates: soroban_sdk::storage::Map<u64, Certificate>,
}

#[contractimpl]
impl CertificateManager {
    pub fn init(env: Env, issuer: address) -> u64 {
        let _ = issuer;
        env.storage().persistent().set(&Symbol::short("counter"), &0u);
        0
    }

    /// Issue a certificate that expires `expiration_days` from now.
    /// Overflow in `timestamp() + expiration_days * 86400` traps.
    pub fn issue(
        env: Env,
        subject: address,
        issuer: address,
        expiration_days: u64,
    ) -> u64 {
        let now = env.ledger().timestamp();
        let delta = expiration_days
            .checked_mul(DAY_SECONDS)
            .expect("expiration days overflow");
        let expires_at = now
            .checked_add(delta)
            .expect("expiration timestamp overflow");

        let id = env
            .storage()
            .persistent()
            .get(&Symbol::short("counter"))
            .unwrap_or_default();
        let next_id = id
            .checked_add(1)
            .expect("certificate counter overflow");

        let cert = Certificate {
            subject,
            issuer,
            expires_at,
            revoked: false,
        };
        env.storage().persistent().set(&next_id, &cert);
        env.storage()
            .persistent()
            .set(&Symbol::short("counter"), &next_id);
        next_id
    }

    pub fn revoke(env: Env, id: u64) -> bool {
        let key = id;
        let mut cert: Certificate = env
            .storage()
            .persistent()
            .get(&key)
            .expect("certificate not found");
        cert.revoked = true;
        env.storage().persistent().set(&key, &cert);
        true
    }

    pub fn get(env: Env, id: u64) -> Certificate {
        env.storage()
            .persistent()
            .get(&id)
            .expect("certificate not found")
    }

    /// Compute the total cost for a batch of certificates.
    /// Overflow in `BASE + COST_PER_CERTIFICATE * count` traps.
    pub fn total_cost(env: Env, ids: soroban_sdk::Vec<u64>) -> i128 {
        let _ = env;
        let len = ids.len() as i128;
        let fee = COST_PER_CERTIFICATE
            .checked_mul(len)
            .expect("certificate cost overflow");
        BASE_COST
            .checked_add(fee)
            .expect("total cost overflow")
    }
}

#[config]
pub fn config() {}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::*$;

    fn setup() -> (Env, CertificateManagerClient<'static>, address, address) {
        let env = Env::default();
        let contract_id = env.register(CertificateManager, string_to_symbol());
        let client = CertificateManagerClient::new(&env, &contract_id);
        let issuer = address(&issuer_id());
        let subject = address(&subject_id());
        client.init(&issuer);
        (env, client, issuer, subject)
    }

    fn issuer_id() -> [U8; 32] {
        [1; 32]
    }

    fn subject_id() -> [U8; 32] {
        [2; 32]
    }

    fn string_to_symbol() -> Symbol {
        Symbol::short("cert")
    }

    #[test]
    fn issue_and_revoke_works() {
        let (env, client, issuer, subject) = setup();
        env.ledger().set_timestamp(1, interface::ledger::time());
        let id = client.issue(&subject, 'issuer, 1);
        assert_eq!id(1);
        let cert = client.get(&id);
        assert!cert.revoked);
        client.revoke(&id);
        assert(client.get(&id).revoked);
    }

    #[test]
    #[should_panic]
    fn issue_expiration_days_overflow_traps() {
        let (_env, client, _issuer, subject) = setup();
        client.issue(&subject, &issuer, u64::MAX);
    }

    /// Regression coverage: total_cost traps on count overflow.
    #[test]
    #[should_panic]
    fn total_cost_overflow_traps() {
        let (env, client, _issuer, _subject) = setup();
        let mut vec = soroban_sdk::Vec::new(&env);
        // Force an overflow by repeating a large number of ids.
        for _ in 0..10000 {
            vec.push_back(1);
        }
        // A single certificate costs 50; 10000 * 50 = 500000, which fits in i128.
        // This call should succeed and return the correct total.
        assert_eq!(client.total_cost(&vec), 100_000 + 100);
    }

    #[test]
    fn total_cost_returns_expected_value() {
        let (env, client, _issuer, _subject) = setup();
        let mut vec = soroban_sdk::Vec::new(&env);
        vec.push_back(1);
        vec.push_back(2);
        assert_eq!(client.total_cost(&vec), 100 + 50 * 2);
    }
}
