use super::*;
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Ledger as _},
    Address, Env,
};
use storage::PERSISTENT_EXTEND_AMOUNT;

const DAY_IN_LEDGERS: u32 = 17_280;
use stellar_tokens::rwa::identity_verification::IdentityVerifierClient as IdClient;

#[test]
fn only_admin_can_allow() {
    let e = Env::default();
    let admin = Address::generate(&e);
    let stranger = Address::generate(&e);
    let investor = Address::generate(&e);

    let id = e.register(IdentityVerifier, (admin.clone(),));
    let client = IdentityVerifierClient::new(&e, &id);

    // Initial state: not allowed.
    assert!(!client.is_allowed(&investor));

    // Stranger cannot allow.
    assert!(client.try_allow(&investor, &true, &stranger).is_err());
    assert!(!client.is_allowed(&investor));

    // Admin allows.
    e.mock_all_auths();
    client.allow(&investor, &true, &admin);
    assert!(client.is_allowed(&investor));

    // Stranger cannot disallow.
    e.set_auths(&[]);
    assert!(client.try_allow(&investor, &false, &stranger).is_err());
    assert!(client.is_allowed(&investor));

    // Admin disallows.
    e.mock_all_auths();
    client.allow(&investor, &false, &admin);
    assert!(!client.is_allowed(&investor));
}

#[test]
fn verify_identity_checks_allowlist() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let investor = Address::generate(&e);

    let id = e.register(IdentityVerifier, (admin.clone(),));
    let client = IdentityVerifierClient::new(&e, &id);
    let id_client = IdClient::new(&e, &id);

    // Unallowed investor fails identity verification.
    assert!(id_client.try_verify_identity(&investor).is_err());

    // Once allowed, verification succeeds.
    client.allow(&investor, &true, &admin);
    id_client.verify_identity(&investor);
}

fn allowed_ttl(e: &Env, id: &Address, account: &Address) -> u32 {
    e.as_contract(id, || {
        e.storage()
            .persistent()
            .get_ttl(&DataKey::Allowed(account.clone()))
    })
}

fn age(e: &Env, ledgers: u32) {
    e.ledger().with_mut(|l| l.sequence_number += ledgers);
}

#[test]
fn allowing_writes_the_entry_with_the_full_ttl() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let investor = Address::generate(&e);
    let id = e.register(IdentityVerifier, (admin.clone(),));

    IdentityVerifierClient::new(&e, &id).allow(&investor, &true, &admin);

    assert_eq!(allowed_ttl(&e, &id, &investor), PERSISTENT_EXTEND_AMOUNT);
}

#[test]
fn checking_an_allowed_account_restores_the_full_ttl() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let investor = Address::generate(&e);
    let id = e.register(IdentityVerifier, (admin.clone(),));
    let client = IdentityVerifierClient::new(&e, &id);
    client.allow(&investor, &true, &admin);

    age(&e, 2 * DAY_IN_LEDGERS);
    assert!(client.is_allowed(&investor));
    assert_eq!(allowed_ttl(&e, &id, &investor), PERSISTENT_EXTEND_AMOUNT);

    age(&e, 2 * DAY_IN_LEDGERS);
    IdClient::new(&e, &id).verify_identity(&investor);
    assert_eq!(allowed_ttl(&e, &id, &investor), PERSISTENT_EXTEND_AMOUNT);
}
