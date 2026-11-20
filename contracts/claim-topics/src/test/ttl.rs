//! A new topic or issuer entry gets its full TTL in the call that creates it.

use soroban_sdk::{
    testutils::{storage::Persistent as _, Ledger as _},
    Address, Env, IntoVal, Val,
};
use stellar_tokens::rwa::identity_verification::claim_topics_and_issuers::{
    storage::ClaimTopicsAndIssuersStorageKey as Key, CLAIMS_EXTEND_AMOUNT, ISSUERS_EXTEND_AMOUNT,
};

use super::{bound, topics, Fixture};
use crate::TopicsChange;

/// Testnet's minimum lifetime of a new persistent entry, in ledgers.
const TESTNET_MIN_PERSISTENT_TTL: u32 = 120_960;

const KYC: u32 = 1;

impl Fixture<'_> {
    fn persistent_ttl<K: IntoVal<Env, Val>>(&self, key: &K) -> u32 {
        self.e.as_contract(&self.topics.address, || {
            self.e.storage().persistent().get_ttl(key)
        })
    }

    fn topic_entries_have_the_full_ttl(&self, topic: u32) {
        assert_eq!(self.persistent_ttl(&Key::ClaimTopics), CLAIMS_EXTEND_AMOUNT);
        assert_eq!(
            self.persistent_ttl(&Key::ClaimTopicIssuers(topic)),
            ISSUERS_EXTEND_AMOUNT
        );
    }

    fn issuer_entries_have_the_full_ttl(&self, issuer: &Address) {
        assert_eq!(
            self.persistent_ttl(&Key::TrustedIssuers),
            ISSUERS_EXTEND_AMOUNT
        );
        assert_eq!(
            self.persistent_ttl(&Key::IssuerClaimTopics(issuer.clone())),
            CLAIMS_EXTEND_AMOUNT
        );
    }
}

/// A topics contract in setup on a ledger with testnet's minimum lifetime.
fn setup<'a>() -> Fixture<'a> {
    let f = bound();
    f.e.ledger()
        .set_min_persistent_entry_ttl(TESTNET_MIN_PERSISTENT_TTL);
    f
}

#[test]
fn a_topic_added_during_setup_gets_the_full_ttl() {
    let f = setup();

    f.topics.add_claim_topic(&KYC, &f.admin);

    f.topic_entries_have_the_full_ttl(KYC);
}

#[test]
fn a_topic_added_through_the_timelock_gets_the_full_ttl() {
    let f = setup();
    f.topics.finish_setup();

    f.land(&TopicsChange::AddClaimTopic(KYC));

    f.topic_entries_have_the_full_ttl(KYC);
}

#[test]
fn an_issuer_added_during_setup_gets_the_full_ttl() {
    let f = setup();
    let issuer = f.kit_issuer();
    f.topics.add_claim_topic(&KYC, &f.admin);

    f.topics
        .add_trusted_issuer(&issuer, &topics(&f.e, &[KYC]), &f.admin);

    f.issuer_entries_have_the_full_ttl(&issuer);
}

#[test]
fn an_issuer_added_through_the_timelock_gets_the_full_ttl() {
    let f = setup();
    let issuer = f.kit_issuer();
    f.topics.add_claim_topic(&KYC, &f.admin);
    f.topics.finish_setup();

    f.land(&TopicsChange::AddTrustedIssuer(
        issuer.clone(),
        topics(&f.e, &[KYC]),
    ));

    f.issuer_entries_have_the_full_ttl(&issuer);
}
