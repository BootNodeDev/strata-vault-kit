mod changes;

use soroban_sdk::{
    testutils::{storage::Instance as _, Address as _, Ledger as _},
    Address, Env,
};
use strata_storage::INSTANCE_EXTEND_AMOUNT;

use crate::{Compliance, ComplianceClient};

const TWO_DAYS_IN_LEDGERS: u32 = 2 * 17_280;

fn instance_ttl(e: &Env, id: &Address) -> u32 {
    e.as_contract(id, || e.storage().instance().get_ttl())
}

fn age(e: &Env) {
    e.ledger()
        .with_mut(|l| l.sequence_number += TWO_DAYS_IN_LEDGERS);
}

/// A compliance contract with one bound token, its instance decayed past the
/// extend threshold.
fn decayed(e: &Env) -> (ComplianceClient<'_>, Address) {
    e.mock_all_auths();
    let admin = Address::generate(e);
    let token = Address::generate(e);
    let client = ComplianceClient::new(e, &e.register(Compliance, (admin.clone(),)));
    client.bind_token(&token, &admin);
    age(e);
    assert!(instance_ttl(e, &client.address) < INSTANCE_EXTEND_AMOUNT);
    (client, token)
}

#[test]
fn construction_writes_the_instance_with_the_full_ttl() {
    let e = Env::default();
    let id = e.register(Compliance, (Address::generate(&e),));

    assert_eq!(instance_ttl(&e, &id), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn the_checks_a_token_runs_before_moving_shares_restore_the_instance_ttl() {
    let e = Env::default();
    let (client, token) = decayed(&e);
    let holder = Address::generate(&e);
    let other = Address::generate(&e);

    assert!(client.can_create(&holder, &1, &token));
    assert_eq!(instance_ttl(&e, &client.address), INSTANCE_EXTEND_AMOUNT);

    age(&e);
    assert!(client.can_transfer(&holder, &other, &1, &token));
    assert_eq!(instance_ttl(&e, &client.address), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn the_hooks_a_token_calls_after_moving_shares_restore_the_instance_ttl() {
    let e = Env::default();
    let (client, token) = decayed(&e);
    let holder = Address::generate(&e);
    let other = Address::generate(&e);

    client.created(&holder, &1, &token);
    assert_eq!(instance_ttl(&e, &client.address), INSTANCE_EXTEND_AMOUNT);

    age(&e);
    client.transferred(&holder, &other, &1, &token);
    assert_eq!(instance_ttl(&e, &client.address), INSTANCE_EXTEND_AMOUNT);

    age(&e);
    client.destroyed(&other, &1, &token);
    assert_eq!(instance_ttl(&e, &client.address), INSTANCE_EXTEND_AMOUNT);
}
