//! Each account gets one of three answers: verified, refused with one of
//! OpenZeppelin's codes, or `Unavailable` when a contract the answer depends
//! on failed.

use soroban_sdk::{panic_with_error, Address, Env, Error, Executable, Vec};
use stellar_tokens::rwa::{
    identity_verification::{
        claim_issuer::ClaimIssuerClient,
        claim_topics_and_issuers::ClaimTopicsAndIssuersClient,
        identity_claims::{generate_claim_id, ClaimsError, IdentityClaimsClient},
        identity_registry_storage::{IRSError, IdentityRegistryStorageClient},
        storage,
    },
    RWAError,
};
use strata_bindings::ISSUER_REFUSALS;

use crate::{protocol, VerifierError};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Answer {
    Yes,
    No,
    Failed,
}

pub(crate) fn verify(e: &Env, account: &Address) {
    if protocol::is_protocol(e, account) {
        return;
    }
    let identity = stored_identity(e, account);
    check_claims(e, &identity);
}

/// Only a contract answers a call. A call to an account address fails the
/// caller too, beyond what `try_` catches.
pub(crate) fn is_contract(address: &Address) -> bool {
    matches!(address.executable(), Some(Executable::Wasm(_)))
}

fn reachable(e: &Env, contract: Address) -> Address {
    if !is_contract(&contract) {
        panic_with_error!(e, VerifierError::Unavailable);
    }
    contract
}

fn stored_identity(e: &Env, account: &Address) -> Address {
    let registry = reachable(e, storage::identity_registry_storage(e));
    match IdentityRegistryStorageClient::new(e, &registry).try_stored_identity(account) {
        Ok(Ok(identity)) => identity,
        Err(Ok(error)) if error == Error::from(IRSError::IdentityNotFound) => {
            panic_with_error!(e, IRSError::IdentityNotFound)
        }
        _ => panic_with_error!(e, VerifierError::Unavailable),
    }
}

/// A refusing topic refuses the identity whatever the other topics answer,
/// so a fault is reported only when no topic refused.
pub(crate) fn check_claims(e: &Env, identity: &Address) {
    let topics = reachable(e, storage::claim_topics_and_issuers(e));
    let required =
        match ClaimTopicsAndIssuersClient::new(e, &topics).try_get_claim_topics_and_issuers() {
            Ok(Ok(required)) => required,
            _ => panic_with_error!(e, VerifierError::Unavailable),
        };
    if required.is_empty() {
        panic_with_error!(e, RWAError::IdentityVerificationFailed);
    }
    let mut failed = false;
    for (topic, issuers) in required.iter() {
        match topic_answer(e, identity, topic, &issuers) {
            Answer::Yes => {}
            Answer::No => panic_with_error!(e, RWAError::IdentityVerificationFailed),
            Answer::Failed => failed = true,
        }
    }
    if failed {
        panic_with_error!(e, VerifierError::Unavailable);
    }
}

/// One yes satisfies the topic. Without one, a failing issuer might have
/// said yes, so the topic fails rather than refuses.
fn topic_answer(e: &Env, identity: &Address, topic: u32, issuers: &Vec<Address>) -> Answer {
    let mut failed = false;
    for issuer in issuers.iter() {
        match issuer_answer(e, identity, topic, &issuer) {
            Answer::Yes => return Answer::Yes,
            Answer::No => {}
            Answer::Failed => failed = true,
        }
    }
    if failed {
        Answer::Failed
    } else {
        Answer::No
    }
}

/// Reads only the claim id OpenZeppelin gives this issuer and topic, so the
/// work stays bounded by what governance configured.
fn issuer_answer(e: &Env, identity: &Address, topic: u32, issuer: &Address) -> Answer {
    let claim_id = generate_claim_id(e, issuer, topic);
    let claim = match IdentityClaimsClient::new(e, identity).try_get_claim(&claim_id) {
        Ok(Ok(claim)) => claim,
        Err(Ok(error)) if error == Error::from(ClaimsError::ClaimNotFound) => return Answer::No,
        _ => return Answer::Failed,
    };
    if claim.topic != topic || claim.issuer != *issuer {
        return Answer::No;
    }
    match ClaimIssuerClient::new(e, issuer).try_is_claim_valid(
        identity,
        &topic,
        &claim.scheme,
        &claim.signature,
        &claim.data,
    ) {
        Ok(Ok(())) => Answer::Yes,
        Err(Ok(error)) if is_refusal(error) => Answer::No,
        _ => Answer::Failed,
    }
}

fn is_refusal(error: Error) -> bool {
    ISSUER_REFUSALS
        .iter()
        .any(|code| error == Error::from_contract_error(*code))
}
