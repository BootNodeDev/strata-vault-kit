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

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, String, Vec};
use stellar_tokens::rwa::identity_verification::identity_claims::{self, Claim, IdentityClaims};

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
    /// issuer must accept it. Only the owner may call it.
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
        identity_claims::add_claim(e, topic, scheme, &issuer, &signature, &data, &uri)
    }
}

#[cfg(test)]
mod test;
