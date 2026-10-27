//! # Design
//!
//! Testnet-only stub — in production this is an external ERC-3643 identity
//! registry (a trusted issuer's), not part of this product. Do not deploy to mainnet.
//!
//! - **A yes or no per address.** No claims, topics or issuers, and an address
//!   never set is refused. The cost: no expiry and no per-jurisdiction rule; a
//!   deployment that needs them brings its own registry.
//! - **Instant edits.** The admin lists and delists at once, with no timelock.
//!   The cost: a stolen admin key can list or delist any account at once; a
//!   delisted holder still leaves in cash.
//! - **A fixed admin, no upgrade.** The admin account's signers can change in
//!   place, but the account cannot. The cost: replacing it, or the code, needs
//!   a new verifier and a token change that waits for the timelock.
//! - **No recovery account.** `recovery_target` is always `None`, so
//!   `recover_balance` always fails. The cost: a lost wallet's shares move by
//!   `legal_transfer`, signed by `compliance` and the token's admin.
//! - **OpenZeppelin's error code.** A refusal is
//!   `RWAError::IdentityVerificationFailed` (304); the stub has no error enum.
//!   The cost: the code says what failed, not which contract refused.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contractmeta, contracttype, panic_with_error, Address, Env,
};

contractmeta!(
    key = "stub",
    val = "testnet-only; prod = external ERC-3643 identity registry"
);
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
    /// Creates the verifier with its admin.
    ///
    /// # Arguments
    ///
    /// * `admin` - Edits the allowlist.
    ///
    /// # Authorization
    ///
    /// None: it runs once, at deployment.
    pub fn __constructor(e: &Env, admin: Address) {
        access_control::set_admin(e, &admin);
        strata_storage::bump_instance(e);
    }

    /// Adds or removes an account from the allowlist.
    ///
    /// # Arguments
    ///
    /// * `account` - The account.
    /// * `allowed` - True adds it, false removes it.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    pub fn allow(e: &Env, account: Address, allowed: bool) {
        strata_storage::bump_instance(e);
        strata_storage::set_persistent(e, &DataKey::Allowed(account), &allowed);
    }

    /// Whether `account` is on the allowlist.
    ///
    /// # Arguments
    ///
    /// * `account` - The account.
    pub fn is_allowed(e: &Env, account: Address) -> bool {
        strata_storage::bump_instance(e);
        strata_storage::get_persistent(e, &DataKey::Allowed(account)).unwrap_or(false)
    }
}

#[contractimpl(contracttrait)]
impl identity_verification::IdentityVerifier for IdentityVerifier {
    /// Succeeds when `account` is on the allowlist. The share token calls this
    /// on every mint and transfer, so it is what keeps the instance alive.
    ///
    /// # Arguments
    ///
    /// * `account` - The account.
    ///
    /// # Errors
    ///
    /// * `RWAError::IdentityVerificationFailed` - `account` is not on the
    ///   allowlist.
    fn verify_identity(e: &Env, account: &Address) {
        strata_storage::bump_instance(e);
        let allowed: bool =
            strata_storage::get_persistent(e, &DataKey::Allowed(account.clone())).unwrap_or(false);
        if !allowed {
            panic_with_error!(e, RWAError::IdentityVerificationFailed);
        }
    }

    /// Always `None`: this stub names no recovery account, so the share
    /// token's `recover_balance` fails with `RWAError::IdentityMismatch`.
    ///
    /// # Arguments
    ///
    /// * `old_account` - Not read.
    fn recovery_target(_e: &Env, _old_account: &Address) -> Option<Address> {
        None
    }

    /// Does nothing: this stub keeps no claim topics or issuers.
    ///
    /// # Arguments
    ///
    /// * `claim_topics_and_issuers`, `operator` - Not read.
    ///
    /// # Authorization
    ///
    /// The admin signs.
    #[only_admin]
    fn set_claim_topics_and_issuers(
        e: &Env,
        _claim_topics_and_issuers: Address,
        _operator: Address,
    ) {
    }
}

#[cfg(test)]
mod test;
