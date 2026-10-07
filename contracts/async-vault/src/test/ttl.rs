use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use storage::{INSTANCE_EXTEND_AMOUNT, PERSISTENT_EXTEND_AMOUNT};

use super::*;
use crate::keys::DataKey;

const TWO_DAYS: u64 = 2 * 24 * 60 * 60;

fn persistent_ttl(f: &Fixture, key: &DataKey) -> u32 {
    f.e.as_contract(&f.vault.address, || f.e.storage().persistent().get_ttl(key))
}

fn instance_ttl(f: &Fixture) -> u32 {
    f.e.as_contract(&f.vault.address, || f.e.storage().instance().get_ttl())
}

#[test]
fn a_request_and_its_epoch_are_written_with_the_full_ttl() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);

    assert_eq!(
        persistent_ttl(&f, &DataKey::UserDeposit(1, user)),
        PERSISTENT_EXTEND_AMOUNT
    );
    assert_eq!(
        persistent_ttl(&f, &DataKey::Epoch(1)),
        PERSISTENT_EXTEND_AMOUNT
    );
}

#[test]
fn reading_a_decayed_request_restores_its_full_ttl() {
    let f = setup();
    let user = f.investor(1_000);
    f.vault.request_deposit(&user, &400);
    let key = DataKey::UserDeposit(1, user.clone());

    f.advance(TWO_DAYS);
    assert!(persistent_ttl(&f, &key) < PERSISTENT_EXTEND_AMOUNT);

    f.vault.get_deposit_request(&1, &user);

    assert_eq!(persistent_ttl(&f, &key), PERSISTENT_EXTEND_AMOUNT);
}

#[test]
fn reading_a_decayed_epoch_restores_its_full_ttl() {
    let f = setup();

    f.advance(TWO_DAYS);
    assert!(persistent_ttl(&f, &DataKey::Epoch(1)) < PERSISTENT_EXTEND_AMOUNT);

    f.vault.get_epoch(&1);

    assert_eq!(
        persistent_ttl(&f, &DataKey::Epoch(1)),
        PERSISTENT_EXTEND_AMOUNT
    );
}

#[test]
fn a_redemption_request_is_written_with_the_full_ttl() {
    let f = setup();
    let holder = f.holder(100);

    let epoch = f.vault.request_redeem(&holder, &100);

    assert_eq!(
        persistent_ttl(&f, &DataKey::UserRedeem(epoch, holder)),
        PERSISTENT_EXTEND_AMOUNT
    );
}

#[test]
fn any_vault_read_restores_the_instance_ttl() {
    let f = setup();

    f.advance(TWO_DAYS);
    assert!(instance_ttl(&f) < INSTANCE_EXTEND_AMOUNT);

    f.vault.current_epoch();

    assert_eq!(instance_ttl(&f), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn a_pending_request_still_claims_after_most_of_a_month() {
    let f = setup();
    let user = f.investor(1_000);
    f.vault.request_deposit(&user, &400);
    let epoch = f.close_epoch();

    f.advance(29 * 24 * 60 * 60);
    f.oracle.attest(
        &NavReport {
            nav_per_share: wad(2),
            timestamp: 0,
            expires_at: u64::MAX,
        },
        &f.attester,
    );
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.claim_deposit(&user, &epoch), 200);
}
