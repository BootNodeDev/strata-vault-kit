mod changes;
mod guards;
mod ttl;

use soroban_sdk::{
    testutils::{storage::Instance as _, Address as _, Ledger as _},
    Address, Env,
};
use stellar_tokens::rwa::compliance::{AccountSnapshot, TransferKind};
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

fn snapshot(address: &Address, balance: i128) -> AccountSnapshot {
    AccountSnapshot {
        address: address.clone(),
        balance,
        frozen: 0,
    }
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
fn the_hooks_a_token_calls_after_moving_shares_restore_the_instance_ttl() {
    let e = Env::default();
    let (client, token) = decayed(&e);
    let holder = Address::generate(&e);
    let other = Address::generate(&e);

    client.created(&snapshot(&holder, 0), &1, &token);
    assert_eq!(instance_ttl(&e, &client.address), INSTANCE_EXTEND_AMOUNT);

    age(&e);
    client.transferred(
        &snapshot(&holder, 1),
        &snapshot(&other, 0),
        &1,
        &TransferKind::Standard,
        &token,
    );
    assert_eq!(instance_ttl(&e, &client.address), INSTANCE_EXTEND_AMOUNT);

    age(&e);
    client.destroyed(&snapshot(&other, 1), &1, &token);
    assert_eq!(instance_ttl(&e, &client.address), INSTANCE_EXTEND_AMOUNT);
}
