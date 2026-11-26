//! Only instances of the code at the stored hash become trusted issuers.

use claim_issuer::ClaimIssuerContract;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::Address;
use strata_timelock::MIN_DELAY;

use super::{bound, deploy, refused, topics, Fixture, ForeignIssuer};
use crate::{ClaimTopicsContractError, TopicsChange};

const KYC: u32 = 1;

impl Fixture<'_> {
    /// Proposes `change`, waits out the delay and tries to apply it.
    fn try_land(
        &self,
        change: &TopicsChange,
    ) -> Result<
        Result<(), soroban_sdk::ConversionError>,
        Result<soroban_sdk::Error, soroban_sdk::InvokeError>,
    > {
        let id = self.propose(change);
        self.e.ledger().with_mut(|l| l.timestamp += MIN_DELAY);
        self.topics.try_apply_change(&id)
    }
}

#[test]
fn a_trusted_issuer_must_run_the_kit_issuer_code() {
    let f = bound();
    f.topics.add_claim_topic(&KYC, &f.admin);
    let kyc = topics(&f.e, &[KYC]);
    let other_code = deploy(&f.e, &f.e.upload(ForeignIssuer));
    let registered = f.e.register(ForeignIssuer, (Address::generate(&f.e),));
    let no_contract = Address::generate(&f.e);

    for issuer in [&other_code, &registered, &no_contract] {
        refused(
            f.topics.try_add_trusted_issuer(issuer, &kyc, &f.admin),
            ClaimTopicsContractError::NotKitIssuer,
        );
    }
    let kit = f.kit_issuer();
    f.topics.add_trusted_issuer(&kit, &kyc, &f.admin);

    f.topics.finish_setup();
    for issuer in [&other_code, &registered, &no_contract] {
        refused(
            f.try_land(&TopicsChange::AddTrustedIssuer(issuer.clone(), kyc.clone())),
            ClaimTopicsContractError::NotKitIssuer,
        );
    }
    let late = f.kit_issuer();
    f.land(&TopicsChange::AddTrustedIssuer(late.clone(), kyc));

    assert!(f.topics.is_trusted_issuer(&kit));
    assert!(f.topics.is_trusted_issuer(&late));
    assert!(!f.topics.is_trusted_issuer(&other_code));
}

#[test]
fn new_issuer_code_lands_through_the_timelock() {
    let f = bound();
    f.topics.add_claim_topic(&KYC, &f.admin);
    f.topics.add_claim_topic(&2, &f.admin);
    let kyc = topics(&f.e, &[KYC]);
    let first = f.kit_issuer();
    f.topics.add_trusted_issuer(&first, &kyc, &f.admin);
    f.topics.finish_setup();
    let release = f.e.upload(ClaimIssuerContract);

    f.land(&TopicsChange::IssuerWasm(release.clone()));

    assert_eq!(f.topics.issuer_wasm(), release);
    let old_code = f.kit_issuer();
    refused(
        f.try_land(&TopicsChange::AddTrustedIssuer(old_code, kyc.clone())),
        ClaimTopicsContractError::NotKitIssuer,
    );
    let upgraded = deploy(&f.e, &release);
    f.land(&TopicsChange::AddTrustedIssuer(upgraded.clone(), kyc));
    f.land(&TopicsChange::UpdateIssuerTopics(
        first.clone(),
        topics(&f.e, &[KYC, 2]),
    ));

    assert!(f.topics.is_trusted_issuer(&upgraded));
    assert!(f.topics.has_claim_topic(&first, &2));
}
