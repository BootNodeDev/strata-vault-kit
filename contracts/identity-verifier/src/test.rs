extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{
        storage::Instance as _, storage::Persistent as _, Address as _, AuthorizedFunction,
        AuthorizedInvocation, Ledger as _, MockAuth, MockAuthInvoke,
    },
    Address, Env, IntoVal, Symbol, Val, Vec,
};
use strata_storage::{INSTANCE_EXTEND_AMOUNT, PERSISTENT_EXTEND_AMOUNT};

const DAY_IN_LEDGERS: u32 = 17_280;
use stellar_tokens::rwa::identity_verification::IdentityVerifierClient as IdClient;

/// Signs one `allow` call as `who` and nothing else.
fn sign_only_as(e: &Env, verifier: &Address, who: &Address, args: Vec<Val>) {
    e.mock_auths(&[MockAuth {
        address: who,
        invoke: &MockAuthInvoke {
            contract: verifier,
            fn_name: "allow",
            args,
            sub_invokes: &[],
        },
    }]);
}

/// The last call asked `who` alone to sign, once, on exactly this call.
fn signed_once_by(e: &Env, verifier: &Address, who: &Address, fn_name: &str, args: Vec<Val>) {
    assert_eq!(
        e.auths(),
        std::vec![(
            who.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    verifier.clone(),
                    Symbol::new(e, fn_name),
                    args,
                )),
                sub_invocations: std::vec![],
            },
        )]
    );
}

#[test]
fn each_admin_call_asks_the_admin_for_one_signature() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let investor = Address::generate(&e);
    let id = e.register(IdentityVerifier, (admin.clone(),));

    IdentityVerifierClient::new(&e, &id).allow(&investor, &true);
    signed_once_by(
        &e,
        &id,
        &admin,
        "allow",
        (investor.clone(), true).into_val(&e),
    );

    let topics = Address::generate(&e);
    IdClient::new(&e, &id).set_claim_topics_and_issuers(&topics, &admin);
    signed_once_by(
        &e,
        &id,
        &admin,
        "set_claim_topics_and_issuers",
        (topics, admin.clone()).into_val(&e),
    );
}

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
    sign_only_as(&e, &id, &stranger, (investor.clone(), true).into_val(&e));
    assert!(client.try_allow(&investor, &true).is_err());
    assert!(!client.is_allowed(&investor));

    // Admin allows.
    e.mock_all_auths();
    client.allow(&investor, &true);
    assert!(client.is_allowed(&investor));

    // Stranger cannot disallow.
    sign_only_as(&e, &id, &stranger, (investor.clone(), false).into_val(&e));
    assert!(client.try_allow(&investor, &false).is_err());
    assert!(client.is_allowed(&investor));

    // Admin disallows.
    e.mock_all_auths();
    client.allow(&investor, &false);
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
    client.allow(&investor, &true);
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

    IdentityVerifierClient::new(&e, &id).allow(&investor, &true);

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
    client.allow(&investor, &true);

    age(&e, 2 * DAY_IN_LEDGERS);
    assert!(client.is_allowed(&investor));
    assert_eq!(allowed_ttl(&e, &id, &investor), PERSISTENT_EXTEND_AMOUNT);

    age(&e, 2 * DAY_IN_LEDGERS);
    IdClient::new(&e, &id).verify_identity(&investor);
    assert_eq!(allowed_ttl(&e, &id, &investor), PERSISTENT_EXTEND_AMOUNT);
}

fn instance_ttl(e: &Env, id: &Address) -> u32 {
    e.as_contract(id, || e.storage().instance().get_ttl())
}

#[test]
fn construction_writes_the_instance_with_the_full_ttl() {
    let e = Env::default();
    let id = e.register(IdentityVerifier, (Address::generate(&e),));

    assert_eq!(instance_ttl(&e, &id), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn allowing_and_checking_restore_the_instance_ttl() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let investor = Address::generate(&e);
    let id = e.register(IdentityVerifier, (admin.clone(),));
    let client = IdentityVerifierClient::new(&e, &id);

    age(&e, 2 * DAY_IN_LEDGERS);
    assert!(instance_ttl(&e, &id) < INSTANCE_EXTEND_AMOUNT);
    client.allow(&investor, &true);
    assert_eq!(instance_ttl(&e, &id), INSTANCE_EXTEND_AMOUNT);

    age(&e, 2 * DAY_IN_LEDGERS);
    IdClient::new(&e, &id).verify_identity(&investor);
    assert_eq!(instance_ttl(&e, &id), INSTANCE_EXTEND_AMOUNT);

    age(&e, 2 * DAY_IN_LEDGERS);
    client.is_allowed(&investor);
    assert_eq!(instance_ttl(&e, &id), INSTANCE_EXTEND_AMOUNT);
}
