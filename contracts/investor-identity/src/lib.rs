//! # Design
//!
//! One identity per investor. It holds the claims issuers have signed about
//! the investor and nothing else.
//!
//! - **The owner writes the claims.** Only the owner adds or removes a claim;
//!   the owner is fixed at construction and never changes. The cost: a lost
//!   owner key means a new identity and a new set of claims from every issuer.
//! - **The issuer checks each claim when it is added.** A claim its issuer
//!   refuses is not stored. The cost: an issuer that is down blocks the add.
//! - **A stored claim proves nothing alone.** The verifier asks the issuer
//!   again on every check, so revocation needs no change here.
//! - **Reading a claim keeps the identity alive.** The verifier reads a claim
//!   on every check, so an investor who keeps using the vault keeps the
//!   identity's instance from archiving. The cost: each check may extend it.
//! - **The claim URI is capped.** The issuer's signature does not cover it,
//!   so the owner could make it as long as it likes, and the verifier reads
//!   the whole claim on every check. The cap keeps that read within budget.
//!   The cost: a longer URI does not fit.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN,
    Env, String, Vec,
};
use stellar_tokens::rwa::identity_verification::identity_claims::{self, Claim, IdentityClaims};

/// The longest claim URI, in bytes, that `add_claim` stores.
pub const MAX_CLAIM_URI_LEN: u32 = 256;

strata_bindings::error_enum! {
    strata_bindings::IDENTITY_ERRORS,

    /// Investor identity failures, coded 10800 to 10999. Codes are stable once
    /// assigned and are never reused.
    #[contracterror]
    #[derive(Copy, Clone, Debug, Eq, PartialEq)]
    #[repr(u32)]
    pub enum InvestorIdentityError {
        /// The claim's URI is longer than `MAX_CLAIM_URI_LEN` bytes.
        ClaimUriTooLong = 10800,
    }
}

#[contracttype]
enum DataKey {
    Owner,
}

#[contract]
pub struct InvestorIdentity;

#[contractimpl]
impl InvestorIdentity {
    pub fn __constructor(e: &Env, owner: Address) {
        strata_storage::set_instance(e, &DataKey::Owner, &owner);
    }

    pub fn owner(e: &Env) -> Address {
        strata_storage::get_instance(e, &DataKey::Owner).expect("constructed")
    }

    /// Removes a claim by id. Only the owner may call it.
    pub fn remove_claim(e: &Env, claim_id: BytesN<32>) {
        Self::owner(e).require_auth();
        identity_claims::remove_claim(e, &claim_id);
    }
}

#[contractimpl(contracttrait)]
impl IdentityClaims for InvestorIdentity {
    /// Adds a claim, or replaces the issuer's claim on the same topic. The
    /// issuer must accept it.
    ///
    /// # Arguments
    ///
    /// * `topic` - The claim topic.
    /// * `scheme` - The signature scheme.
    /// * `issuer` - The issuer contract, which checks the claim.
    /// * `signature` - The issuer's signature.
    /// * `data` - OpenZeppelin's expiry header, then the issuer's payload.
    /// * `uri` - At most 256 bytes. The signature does not cover it.
    ///
    /// # Errors
    ///
    /// * `ClaimUriTooLong` - `uri` is over 256 bytes.
    ///
    /// # Events
    ///
    /// `ClaimAdded` for a new claim, `ClaimChanged` for a replaced one.
    ///
    /// # Authorization
    ///
    /// The owner signs.
    fn add_claim(
        e: &Env,
        topic: u32,
        scheme: u32,
        issuer: Address,
        signature: Bytes,
        data: Bytes,
        uri: String,
    ) -> BytesN<32> {
        Self::owner(e).require_auth();
        if uri.len() > MAX_CLAIM_URI_LEN {
            panic_with_error!(e, InvestorIdentityError::ClaimUriTooLong);
        }
        identity_claims::add_claim(e, topic, scheme, &issuer, &signature, &data, &uri)
    }

    /// Returns a claim by id and extends the instance, as the owner's calls do.
    ///
    /// # Errors
    ///
    /// * `ClaimNotFound` - No claim has this id.
    fn get_claim(e: &Env, claim_id: BytesN<32>) -> Claim {
        strata_storage::bump_instance(e);
        identity_claims::get_claim(e, &claim_id)
    }
}

#[cfg(test)]
mod test;
