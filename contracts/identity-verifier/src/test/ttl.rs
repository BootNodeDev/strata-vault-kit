//! The share token's calls keep the instance alive, and a protocol address
//! entry gets its full TTL when it is written and again when it is read.

use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Ledger as _},
    Address,
};
use strata_storage::PERSISTENT_EXTEND_AMOUNT;

use super::{age, bound, verified, Fixture, VerifierChange};
use crate::protocol::DataKey;

/// Testnet's minimum lifetime of a new persistent entry, in ledgers.
const TESTNET_MIN_PERSISTENT_TTL: u32 = 120_960;

impl Fixture<'_> {
    fn protocol_ttl(&self, account: &Address) -> u32 {
        self.e.as_contract(&self.verifier.address, || {
            self.e
                .storage()
                .persistent()
                .get_ttl(&DataKey::Protocol(account.clone()))
        })
    }
}

/// A bound verifier on a ledger with testnet's minimum lifetime.
fn setup<'a>() -> Fixture<'a> {
    let f = bound();
    f.e.ledger()
        .set_min_persistent_entry_ttl(TESTNET_MIN_PERSISTENT_TTL);
    f
}

#[test]
fn verifying_restores_the_instance_ttl() {
    let f = setup();
    let (account, identity) = f.onboarded();

    f.restores_the_instance(|| verified(f.verify(&account)));
    f.restores_the_instance(|| verified(f.verify(&f.clock.address)));
    f.restores_the_instance(|| verified(f.check_claims(&identity)));
}

#[test]
fn a_protocol_address_added_during_setup_gets_the_full_ttl() {
    let f = setup();
    let escrow = Address::generate(&f.e);

    f.verifier.add_protocol_address(&escrow);

    assert_eq!(f.protocol_ttl(&escrow), PERSISTENT_EXTEND_AMOUNT);
}

#[test]
fn a_protocol_address_added_through_the_timelock_gets_the_full_ttl() {
    let f = setup();
    let escrow = Address::generate(&f.e);
    f.verifier.finish_setup();

    f.land(&VerifierChange::AddProtocolAddress(escrow.clone()));

    assert_eq!(f.protocol_ttl(&escrow), PERSISTENT_EXTEND_AMOUNT);
}

#[test]
fn verifying_a_protocol_address_renews_its_entry() {
    let f = setup();
    let escrow = Address::generate(&f.e);
    f.verifier.add_protocol_address(&escrow);
    age(&f.e);
    assert!(f.protocol_ttl(&escrow) < PERSISTENT_EXTEND_AMOUNT);

    verified(f.verify(&escrow));

    assert_eq!(f.protocol_ttl(&escrow), PERSISTENT_EXTEND_AMOUNT);
}
