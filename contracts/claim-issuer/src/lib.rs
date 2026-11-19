//! # Design
//!
//! A KYC provider deploys one instance, owns it and allows its Ed25519
//! signing keys per topic. The kit's verifier asks it `is_claim_valid`.
//!
//! - **Refusals are contract errors.** The host turns every other failure of
//!   a cross-contract call into one generic error, so a refusal the verifier
//!   must tell apart from a broken issuer has to be a contract error. A
//!   signature mismatch is the exception and cannot be told from a fault.
//! - **Invalidation stores a cutoff.** `invalidate_claims` bumps the nonce,
//!   and also refuses every claim created at or before that moment, with a
//!   contract error of its own. The cost: a claim issued in the same second
//!   as the invalidation is refused too.
//! - **The owner never changes.** There is no admin, setup window or
//!   timelock. The cost: a lost owner key means a new issuer and new claims.
//! - **The payload is not read.** Only the creation and expiry times are.

#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Bytes, Env};
use stellar_tokens::rwa::identity_verification::claim_issuer::{
    allow_key, decode_claim_data_expiration, invalidate_claim_signatures, is_claim_expired,
    is_claim_revoked, is_key_allowed_for_topic, remove_key, set_claim_revoked, ClaimIssuer,
    Ed25519Verifier, SignatureVerifier,
};

pub const ED25519_SCHEME: u32 = 101;

/// Every code `is_claim_valid` refuses with before the signature check.
pub const REFUSALS: [u32; 5] = [10600, 10601, 10602, 10603, 10604];

strata_bindings::error_enum! {
    strata_bindings::IDENTITY_ERRORS,

    /// Claim issuer refusals, coded 10600 to 10799. Codes are stable once
    /// assigned and are never reused.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum ClaimIssuerContractError {
        /// The scheme is not Ed25519.
        UnsupportedScheme = 10600,
        /// The claim's validity period has ended.
        ClaimExpired = 10601,
        /// The owner revoked this claim.
        ClaimRevoked = 10602,
        /// The key is not allowed for this topic.
        KeyNotAllowed = 10603,
        /// The owner invalidated claims created at or before this one.
        ClaimInvalidated = 10604,
    }
}

#[contracttype]
enum DataKey {
    Owner,
    Cutoff(Address, u32),
}

#[contract]
pub struct ClaimIssuerContract;

fn fail(e: &Env, error: ClaimIssuerContractError) -> ! {
    soroban_sdk::panic_with_error!(e, error)
}

#[contractimpl]
impl ClaimIssuerContract {
    pub fn __constructor(e: &Env, owner: Address) {
        strata_storage::set_instance(e, &DataKey::Owner, &owner);
    }

    pub fn owner(e: &Env) -> Address {
        strata_storage::get_instance(e, &DataKey::Owner).expect("constructed")
    }

    /// Allows an Ed25519 key to sign claims on a topic. The registry must list
    /// this issuer for the topic. Only the owner may call it.
    pub fn allow_key(e: &Env, public_key: Bytes, registry: Address, claim_topic: u32) {
        Self::owner(e).require_auth();
        allow_key(e, &public_key, &registry, ED25519_SCHEME, claim_topic);
    }

    /// Stops a key from signing claims on a topic. Only the owner may call it.
    pub fn remove_key(e: &Env, public_key: Bytes, registry: Address, claim_topic: u32) {
        Self::owner(e).require_auth();
        remove_key(e, &public_key, &registry, ED25519_SCHEME, claim_topic);
    }

    /// Revokes one claim by its exact data. Only the owner may call it.
    pub fn revoke_claim(e: &Env, identity: Address, claim_topic: u32, claim_data: Bytes) {
        Self::owner(e).require_auth();
        set_claim_revoked(e, &identity, claim_topic, &claim_data, true);
    }

    /// Invalidates every claim on the topic created up to now, and bumps the
    /// nonce so earlier signatures stop verifying. Only the owner may call it.
    pub fn invalidate_claims(e: &Env, identity: Address, claim_topic: u32) {
        Self::owner(e).require_auth();
        invalidate_claim_signatures(e, &identity, claim_topic);
        strata_storage::set_persistent(
            e,
            &DataKey::Cutoff(identity, claim_topic),
            &e.ledger().timestamp(),
        );
    }
}

#[contractimpl]
impl ClaimIssuer for ClaimIssuerContract {
    /// Panics unless the claim is valid. Refusals before the signature check
    /// are `ClaimIssuerContractError`s; a bad signature is the host's crypto
    /// error.
    fn is_claim_valid(
        e: &Env,
        identity: Address,
        claim_topic: u32,
        scheme: u32,
        sig_data: Bytes,
        claim_data: Bytes,
    ) {
        strata_storage::bump_instance(e);
        if scheme != ED25519_SCHEME {
            fail(e, ClaimIssuerContractError::UnsupportedScheme);
        }
        if is_claim_expired(e, &claim_data) {
            fail(e, ClaimIssuerContractError::ClaimExpired);
        }
        if is_claim_revoked(e, &identity, claim_topic, &claim_data) {
            fail(e, ClaimIssuerContractError::ClaimRevoked);
        }
        let (created_at, _, _) = decode_claim_data_expiration(e, &claim_data);
        let cutoff: Option<u64> =
            strata_storage::get_persistent(e, &DataKey::Cutoff(identity.clone(), claim_topic));
        if cutoff.is_some_and(|cutoff| created_at <= cutoff) {
            fail(e, ClaimIssuerContractError::ClaimInvalidated);
        }
        let signature = Ed25519Verifier::extract_signature_data(e, &sig_data);
        if !is_key_allowed_for_topic(e, &signature.public_key.to_bytes(), scheme, claim_topic) {
            fail(e, ClaimIssuerContractError::KeyNotAllowed);
        }
        let message = Ed25519Verifier::build_message(e, &identity, claim_topic, &claim_data);
        Ed25519Verifier::verify(e, &message, &signature);
    }
}

#[cfg(test)]
mod test;
