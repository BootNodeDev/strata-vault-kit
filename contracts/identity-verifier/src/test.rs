use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};
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
