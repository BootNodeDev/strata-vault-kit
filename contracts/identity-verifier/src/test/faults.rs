//! A contract the answer depends on failing is `Unavailable`, never 304 or
//! 321; only the kit issuer's refusal codes are a no.

use soroban_sdk::{testutils::Address as _, Address};
use stellar_tokens::rwa::identity_verification::{
    claim_issuer::ClaimIssuerClient,
    identity_claims::{generate_claim_id, Claim},
    identity_registry_storage::IRSError,
};
use strata_bindings::ISSUER_REFUSALS;

use super::{
    account_address, doubles, host_error, not_verified, refused, unavailable, verified, Behaviour,
    Doubles, IdentityDoubleClient, IssuerDoubleClient, TokenSideClient, AML, KYC, NOW, YEAR,
};

impl Doubles<'_> {
    /// An issuer double trusted alone for `KYC`, with its claim served.
    fn single_issuer(&self) -> Address {
        let issuer = self.issuer(Behaviour::Answers);
        self.require(&[(KYC, &[&issuer])]);
        self.serve(&self.unsigned_claim(&issuer, KYC));
        issuer
    }

    fn breaks(&self, issuer: &Address, behaviour: Behaviour) {
        IssuerDoubleClient::new(&self.e, issuer).behave_as(&behaviour);
    }
}

#[test]
fn the_doubles_verify_a_served_claim() {
    let d = doubles();
    d.single_issuer();

    verified(d.verify());
    verified(d.check_claims());
}

#[test]
fn a_trapping_issuer_is_unavailable_not_304() {
    let d = doubles();
    let issuer = d.single_issuer();
    d.breaks(&issuer, Behaviour::Traps);

    unavailable(d.verify());
    unavailable(d.check_claims());
}

#[test]
fn a_missing_issuer_contract_is_unavailable() {
    let d = doubles();
    let missing = Address::generate(&d.e);
    d.require(&[(KYC, &[&missing])]);
    d.serve(&d.unsigned_claim(&missing, KYC));

    unavailable(d.verify());
}

#[test]
fn a_signature_failing_at_check_time_is_unavailable() {
    let d = doubles();
    d.require(&[(KYC, &[&d.kit.issuer])]);
    let elsewhere = Address::generate(&d.e);
    d.serve(&d.kit_claim(&elsewhere, KYC, NOW, NOW + YEAR));

    unavailable(d.verify());
}

#[test]
fn the_kit_issuer_refusing_is_304() {
    let d = doubles();
    d.require(&[(KYC, &[&d.kit.issuer])]);
    d.serve(&d.kit_claim(&d.identity.address, KYC, NOW - 200, NOW - 100));

    not_verified(d.verify());
}

#[test]
fn every_kit_refusal_code_is_a_no() {
    let d = doubles();
    let issuer = d.single_issuer();

    for code in ISSUER_REFUSALS {
        d.breaks(&issuer, Behaviour::Fails(code));
        not_verified(d.verify());
    }
}

#[test]
fn any_other_issuer_error_is_unavailable() {
    let d = doubles();
    let issuer = d.single_issuer();

    for code in [304, 321, 341, 351, 10002, 10606] {
        d.breaks(&issuer, Behaviour::Fails(code));
        unavailable(d.verify());
    }
}

#[test]
fn one_failing_and_one_refusing_issuer_is_unavailable() {
    let d = doubles();
    let failing = d.issuer(Behaviour::Traps);
    d.serve(&d.unsigned_claim(&failing, KYC));
    d.serve(&d.kit_claim(&d.identity.address, KYC, NOW - 200, NOW - 100));

    d.require(&[(KYC, &[&failing, &d.kit.issuer])]);
    unavailable(d.verify());

    d.require(&[(KYC, &[&d.kit.issuer, &failing])]);
    unavailable(d.verify());
}

#[test]
fn one_failing_and_one_valid_issuer_is_verified() {
    let d = doubles();
    let failing = d.issuer(Behaviour::Traps);
    d.serve(&d.unsigned_claim(&failing, KYC));
    d.serve(&d.kit_claim(&d.identity.address, KYC, NOW, NOW + YEAR));

    d.require(&[(KYC, &[&failing, &d.kit.issuer])]);
    verified(d.verify());

    d.require(&[(KYC, &[&d.kit.issuer, &failing])]);
    verified(d.verify());
}

#[test]
fn a_refusing_topic_wins_over_a_failing_one() {
    let d = doubles();
    let failing = d.issuer(Behaviour::Traps);
    let refusing = d.issuer(Behaviour::Fails(ISSUER_REFUSALS[2]));
    d.serve(&d.unsigned_claim(&failing, KYC));
    d.serve(&d.unsigned_claim(&refusing, AML));

    d.require(&[(KYC, &[&failing]), (AML, &[&refusing])]);
    not_verified(d.verify());
    not_verified(d.check_claims());
}

#[test]
fn an_issuer_without_a_claim_is_a_no() {
    let d = doubles();
    let issuer = d.issuer(Behaviour::Answers);
    d.require(&[(KYC, &[&issuer])]);

    not_verified(d.verify());
}

#[test]
fn a_claim_naming_another_topic_or_issuer_is_a_no() {
    let d = doubles();
    let issuer = d.issuer(Behaviour::Answers);
    let other = d.issuer(Behaviour::Answers);
    d.require(&[(KYC, &[&issuer])]);
    let id = generate_claim_id(&d.e, &issuer, KYC);

    d.identity.serve(&id, &d.unsigned_claim(&issuer, AML));
    not_verified(d.verify());

    d.identity.serve(&id, &d.unsigned_claim(&other, KYC));
    not_verified(d.verify());
}

#[test]
fn a_topic_with_no_trusted_issuer_is_unavailable() {
    let d = doubles();
    d.single_issuer();
    let issuer = d.issuer(Behaviour::Answers);
    d.serve(&d.unsigned_claim(&issuer, KYC));

    d.require(&[(KYC, &[&issuer]), (AML, &[])]);

    unavailable(d.verify());
    unavailable(d.check_claims());
}

#[test]
fn a_refusing_topic_wins_over_one_with_no_trusted_issuer() {
    let d = doubles();
    let refusing = d.issuer(Behaviour::Fails(ISSUER_REFUSALS[2]));
    d.serve(&d.unsigned_claim(&refusing, KYC));

    d.require(&[(KYC, &[&refusing]), (AML, &[])]);

    not_verified(d.verify());
    not_verified(d.check_claims());
}

#[test]
fn no_required_topic_is_unavailable() {
    let d = doubles();

    d.require(&[]);

    unavailable(d.verify());
    unavailable(d.check_claims());
}

#[test]
fn a_failing_registry_is_unavailable() {
    let d = doubles();
    d.single_issuer();

    for behaviour in [
        Behaviour::Traps,
        Behaviour::Fails(304),
        Behaviour::Fails(10002),
    ] {
        d.registry.behave_as(&behaviour);
        unavailable(d.verify());
    }
    d.registry.behave_as(&Behaviour::Fails(321));
    refused(d.verify(), IRSError::IdentityNotFound);
}

#[test]
fn a_missing_registry_or_topics_contract_is_unavailable() {
    let d = doubles();
    d.single_issuer();
    let missing = Address::generate(&d.e);

    let over_no_registry = d.verifier_over(&missing, &d.topics.address);
    unavailable(TokenSideClient::new(&d.e, &over_no_registry).try_verify_identity(&d.account));

    let over_no_topics = d.verifier_over(&d.registry.address, &missing);
    unavailable(TokenSideClient::new(&d.e, &over_no_topics).try_verify_identity(&d.account));
}

#[test]
fn an_account_address_as_registry_or_topics_is_unavailable() {
    let d = doubles();
    d.single_issuer();

    let over_account = d.verifier_over(&account_address(&d.e), &d.topics.address);
    unavailable(TokenSideClient::new(&d.e, &over_account).try_verify_identity(&d.account));

    let over_account = d.verifier_over(&d.registry.address, &account_address(&d.e));
    unavailable(TokenSideClient::new(&d.e, &over_account).try_verify_identity(&d.account));
}

#[test]
fn a_failing_topics_contract_is_unavailable() {
    let d = doubles();
    d.single_issuer();

    for behaviour in [Behaviour::Traps, Behaviour::Fails(304)] {
        d.topics.behave_as(&behaviour);
        unavailable(d.verify());
        unavailable(d.check_claims());
    }
}

#[test]
fn an_issuer_refusal_code_from_any_other_contract_is_unavailable() {
    let d = doubles();
    d.single_issuer();

    for code in [ISSUER_REFUSALS[0], ISSUER_REFUSALS[3]] {
        d.registry.behave_as(&Behaviour::Fails(code));
        unavailable(d.verify());
        d.registry.behave_as(&Behaviour::Answers);

        d.topics.behave_as(&Behaviour::Fails(code));
        unavailable(d.verify());
        unavailable(d.check_claims());
        d.topics.behave_as(&Behaviour::Answers);

        d.identity.behave_as(&Behaviour::Fails(code));
        unavailable(d.verify());
        unavailable(d.check_claims());
        d.identity.behave_as(&Behaviour::Answers);
    }
    verified(d.verify());
}

#[test]
fn a_failing_identity_is_unavailable() {
    let d = doubles();
    d.single_issuer();

    for behaviour in [
        Behaviour::Traps,
        Behaviour::Fails(341),
        Behaviour::Fails(304),
    ] {
        d.identity.behave_as(&behaviour);
        unavailable(d.verify());
        unavailable(d.check_claims());
    }
}

#[test]
fn a_missing_identity_contract_is_unavailable() {
    let d = doubles();
    d.single_issuer();
    let missing = IdentityDoubleClient::new(&d.e, &Address::generate(&d.e));

    d.registry.link(&d.account, &missing.address);

    unavailable(d.verify());
}

#[test]
fn the_host_reports_each_issuer_fault_as_one_generic_error() {
    let d = doubles();
    let issuer = d.single_issuer();
    d.breaks(&issuer, Behaviour::Traps);
    let claim = d.unsigned_claim(&issuer, KYC);
    let elsewhere = d.kit_claim(&Address::generate(&d.e), KYC, NOW, NOW + YEAR);
    let ask = |issuer: &Address, claim: &Claim| {
        ClaimIssuerClient::new(&d.e, issuer).try_is_claim_valid(
            &d.identity.address,
            &KYC,
            &claim.scheme,
            &claim.signature,
            &claim.data,
        )
    };

    assert_eq!(ask(&issuer, &claim), Err(Ok(host_error())));
    assert_eq!(ask(&Address::generate(&d.e), &claim), Err(Ok(host_error())));
    assert_eq!(ask(&d.kit.issuer, &elsewhere), Err(Ok(host_error())));
}
