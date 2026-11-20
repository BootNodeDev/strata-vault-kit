//! The production stack verifies a holder, refuses one with 304 or 321, fails
//! with `Unavailable` when no issuer could answer, and answers the registry's
//! onboarding question with the same rule.

use claim_issuer::ClaimIssuerContractClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address,
};
use stellar_tokens::rwa::{identity_verification::identity_registry_storage::IRSError, RWAError};

use super::{
    calls, contract_id, finished, not_verified, refused, symbol, unavailable, verified, AML, KYC,
    NOW, YEAR,
};

#[test]
fn a_holder_with_valid_claims_for_every_topic_is_verified() {
    let f = finished();
    let aml = f.require_aml();

    let (account, identity) = f.onboard_with(|identity| {
        vec![
            &f.e,
            f.kyc.claim(&f.e, identity, KYC, NOW + YEAR),
            aml.claim(&f.e, identity, AML, NOW + YEAR),
        ]
    });

    verified(f.verify(&account));
    verified(f.check_claims(&identity));
}

#[test]
fn a_missing_topic_is_refused_with_304() {
    let f = finished();
    let (account, identity) = f.onboarded();
    verified(f.verify(&account));

    f.require_aml();

    not_verified(f.verify(&account));
    not_verified(f.check_claims(&identity));
}

#[test]
fn an_expired_claim_is_refused_with_304() {
    let f = finished();
    let (account, _) =
        f.onboard_with(|identity| vec![&f.e, f.kyc.claim(&f.e, identity, KYC, NOW + 100)]);
    verified(f.verify(&account));

    f.e.ledger().set_timestamp(NOW + 200);

    not_verified(f.verify(&account));
}

#[test]
fn a_revoked_claim_is_refused_with_304() {
    let f = finished();
    let (account, identity) = f.onboarded();
    let claim = f.stored_claim(&identity, &f.kyc.issuer, KYC);

    ClaimIssuerContractClient::new(&f.e, &f.kyc.issuer).revoke_claim(&identity, &KYC, &claim.data);

    not_verified(f.verify(&account));
}

#[test]
fn an_invalidated_claim_is_refused_with_304() {
    let f = finished();
    let (account, identity) = f.onboarded();

    ClaimIssuerContractClient::new(&f.e, &f.kyc.issuer).invalidate_claims(&identity, &KYC);

    not_verified(f.verify(&account));
}

#[test]
fn no_identity_is_321() {
    let f = finished();

    refused(
        f.verify(&Address::generate(&f.e)),
        IRSError::IdentityNotFound,
    );
}

#[test]
fn no_required_topic_is_unavailable() {
    let f = finished();
    let (account, identity) = f.onboarded();

    f.topics.remove_claim_topic(&KYC, &f.admin);

    unavailable(f.verify(&account));
    unavailable(f.check_claims(&identity));
}

#[test]
fn a_required_topic_with_no_trusted_issuer_is_unavailable() {
    let f = finished();
    let (account, identity) = f.onboarded();

    f.topics.add_claim_topic(&AML, &f.admin);

    unavailable(f.verify(&account));
    unavailable(f.check_claims(&identity));
}

#[test]
fn a_topics_only_issuer_moved_to_other_topics_leaves_it_unavailable() {
    let f = finished();
    let aml = f.require_aml();
    let (account, _) = f.onboard_with(|identity| {
        vec![
            &f.e,
            f.kyc.claim(&f.e, identity, KYC, NOW + YEAR),
            aml.claim(&f.e, identity, AML, NOW + YEAR),
        ]
    });
    verified(f.verify(&account));

    f.topics
        .update_issuer_claim_topics(&f.kyc.issuer, &vec![&f.e, AML], &f.admin);

    assert!(!f.topics.is_complete());
    unavailable(f.verify(&account));
}

#[test]
fn onboarding_through_the_registry_with_this_verifier() {
    let f = finished();
    f.close_the_stack();

    let (account, identity) = f.onboarded();

    assert!(calls(&f.e).contains(&(contract_id(&f.verifier.address), symbol("check_claims"))));
    assert_eq!(f.registry.stored_identity(&account), identity);
    verified(f.verify(&account));
}

#[test]
fn onboarding_without_the_required_claims_is_refused_with_304() {
    let f = finished();
    let account = Address::generate(&f.e);

    refused(
        f.registry.try_onboard(&account, &vec![&f.e]),
        RWAError::IdentityVerificationFailed,
    );
    refused(
        f.registry.try_stored_identity(&account),
        IRSError::IdentityNotFound,
    );
}

#[test]
fn check_claims_never_calls_the_registry() {
    let f = finished();
    let (account, identity) = f.onboarded();
    let registry = contract_id(&f.registry.address);
    verified(f.verify(&account));
    assert!(calls(&f.e)
        .iter()
        .any(|(contract, _)| *contract == registry));

    verified(f.check_claims(&identity));

    let trace = calls(&f.e);
    assert!(trace.contains(&(contract_id(&f.kyc.issuer), symbol("is_claim_valid"))));
    assert!(trace.iter().all(|(contract, _)| *contract != registry));
}
