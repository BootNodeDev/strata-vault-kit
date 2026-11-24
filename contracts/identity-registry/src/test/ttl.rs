//! A link or a veto gets its full TTL when it is written and again when it is
//! read.

use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Ledger as _},
    Address,
};
use strata_storage::PERSISTENT_EXTEND_AMOUNT;

use super::{age, bound, Fixture};
use crate::registry::DataKey;

/// Testnet's minimum lifetime of a new persistent entry, in ledgers.
const TESTNET_MIN_PERSISTENT_TTL: u32 = 120_960;

impl Fixture<'_> {
    fn ttl_of(&self, key: &DataKey) -> u32 {
        self.e.as_contract(&self.registry.address, || {
            self.e.storage().persistent().get_ttl(key)
        })
    }

    fn link_ttl(&self, account: &Address) -> u32 {
        self.ttl_of(&DataKey::Link(account.clone()))
    }

    fn veto_ttl(&self, account: &Address) -> u32 {
        self.ttl_of(&DataKey::Veto(account.clone()))
    }
}

/// A registry in setup on a ledger with testnet's minimum lifetime.
fn setup<'a>() -> Fixture<'a> {
    let f = bound();
    f.e.ledger()
        .set_min_persistent_entry_ttl(TESTNET_MIN_PERSISTENT_TTL);
    f
}

#[test]
fn a_link_is_written_with_the_full_ttl() {
    let f = setup();

    let (account, _) = f.onboarded();

    assert_eq!(f.link_ttl(&account), PERSISTENT_EXTEND_AMOUNT);
}

#[test]
fn reading_a_link_restores_the_full_ttl() {
    let f = setup();
    let (account, _) = f.onboarded();
    age(&f.e);
    assert!(f.link_ttl(&account) < PERSISTENT_EXTEND_AMOUNT);

    f.registry.stored_identity(&account);

    assert_eq!(f.link_ttl(&account), PERSISTENT_EXTEND_AMOUNT);
}

#[test]
fn a_veto_is_written_with_the_full_ttl() {
    let f = setup();
    let account = Address::generate(&f.e);

    f.registry.remove_identity(&account, &f.compliance);

    assert_eq!(f.veto_ttl(&account), PERSISTENT_EXTEND_AMOUNT);
}

#[test]
fn reading_a_veto_restores_the_full_ttl() {
    let f = setup();
    let account = Address::generate(&f.e);
    f.registry.remove_identity(&account, &f.compliance);
    age(&f.e);
    assert!(f.veto_ttl(&account) < PERSISTENT_EXTEND_AMOUNT);

    assert!(f.registry.is_vetoed(&account));

    assert_eq!(f.veto_ttl(&account), PERSISTENT_EXTEND_AMOUNT);
}
