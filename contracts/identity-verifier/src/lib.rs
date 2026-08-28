//! Testnet-only stub — in production this is an external ERC-3643 identity
//! registry (a trusted issuer's), not part of this product. Do not deploy to mainnet.
#![no_std]

use soroban_sdk::{contract, contractimpl, contractmeta, contracttype, panic_with_error, Address, Env};

contractmeta!(key = "stub", val = "testnet-only; prod = external ERC-3643 identity registry");
use stellar_access::access_control;
use stellar_macros::only_admin;
use stellar_tokens::rwa::{identity_verification, RWAError};

#[contracttype]
enum DataKey {
    Allowed(Address),
}

#[contract]
pub struct IdentityVerifier;

#[contractimpl]
impl IdentityVerifier {
    pub fn __constructor(e: &Env, admin: Address) {
        access_control::set_admin(e, &admin);
    }

    /// Adds or removes an account from the allowlist.
    #[only_admin]
    pub fn allow(e: &Env, account: Address, allowed: bool, _caller: Address) {
        e.storage()
            .persistent()
            .set(&DataKey::Allowed(account), &allowed);
    }

    pub fn is_allowed(e: &Env, account: Address) -> bool {
        e.storage()
            .persistent()
            .get(&DataKey::Allowed(account))
            .unwrap_or(false)
    }
}

#[contractimpl(contracttrait)]
impl identity_verification::IdentityVerifier for IdentityVerifier {
    fn verify_identity(e: &Env, account: &Address) {
        let allowed: bool = e
            .storage()
            .persistent()
            .get(&DataKey::Allowed(account.clone()))
            .unwrap_or(false);
        if !allowed {
            panic_with_error!(e, RWAError::IdentityVerificationFailed);
        }
    }

    fn recovery_target(_e: &Env, _old_account: &Address) -> Option<Address> {
        None
    }

    #[only_admin]
    fn set_claim_topics_and_issuers(
        e: &Env,
        _claim_topics_and_issuers: Address,
        _operator: Address,
    ) {
    }
}
