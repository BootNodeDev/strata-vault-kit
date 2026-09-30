use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{ShareToken, ShareTokenClient};
use compliance::{Compliance, ComplianceClient};
use identity_verifier::{IdentityVerifier, IdentityVerifierClient};

#[test]
fn manager_mints_to_allowlisted_account() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let manager = Address::generate(&e);
    let receiver = Address::generate(&e);

    let compliance = ComplianceClient::new(&e, &e.register(Compliance, (admin.clone(),)));
    let identity = IdentityVerifierClient::new(&e, &e.register(IdentityVerifier, (admin.clone(),)));

    let token = ShareTokenClient::new(
        &e,
        &e.register(
            ShareToken,
            (
                String::from_str(&e, "Strata Vault USDC"),
                String::from_str(&e, "bvUSDC"),
                admin.clone(),
                manager.clone(),
                compliance.address.clone(),
                identity.address.clone(),
            ),
        ),
    );

    compliance.bind_token(&token.address, &admin); // compliance rejects ops from unbound tokens
    identity.allow(&receiver, &true, &admin);

    token.mint(&receiver, &100, &manager);

    assert_eq!(token.balance(&receiver), 100);
}

struct Fixture<'a> {
    #[allow(dead_code)]
    e: Env,
    token: ShareTokenClient<'a>,
    admin: Address,
    manager: Address,
    #[allow(dead_code)]
    compliance: Address,
    #[allow(dead_code)]
    identity_verifier: Address,
}

fn setup_fixture(e: &Env) -> Fixture<'_> {
    let admin = Address::generate(e);
    let manager = Address::generate(e);
    let compliance = Address::generate(e);
    let identity_verifier = Address::generate(e);

    let id = e.register(
        ShareToken,
        (
            String::from_str(e, "RWA Vault USDC"),
            String::from_str(e, "rwsUSDC"),
            admin.clone(),
            manager.clone(),
            compliance.clone(),
            identity_verifier.clone(),
        ),
    );
    Fixture {
        e: e.clone(),
        token: ShareTokenClient::new(e, &id),
        admin,
        manager,
        compliance,
        identity_verifier,
    }
}

#[test]
fn constructor_sets_7_decimals() {
    let e = Env::default();
    e.mock_all_auths();

    let f = setup_fixture(&e);
    assert_eq!(f.token.decimals(), 7);
}

#[test]
fn unauthorized_caller_cannot_pause_or_unpause() {
    let e = Env::default();
    let f = setup_fixture(&e);
    let stranger = Address::generate(&e);

    // Stranger and manager holding no admin role cannot pause.
    assert!(f.token.try_pause(&stranger).is_err());
    assert!(f.token.try_pause(&f.manager).is_err());

    e.mock_all_auths();
    f.token.pause(&f.admin);
    assert!(f.token.paused());

    // Stranger cannot unpause.
    e.set_auths(&[]);
    assert!(f.token.try_unpause(&stranger).is_err());
    assert!(f.token.try_unpause(&f.manager).is_err());

    e.mock_all_auths();
    f.token.unpause(&f.admin);
    assert!(!f.token.paused());
}

#[test]
fn unauthorized_caller_cannot_mint() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);
    let stranger = Address::generate(&e);
    let receiver = Address::generate(&e);

    // Only manager holds the mint role; stranger and admin are refused.
    assert!(f.token.try_mint(&receiver, &100, &stranger).is_err());
    assert!(f.token.try_mint(&receiver, &100, &f.admin).is_err());
}

#[test]
fn unauthorized_caller_cannot_burn() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);
    let stranger = Address::generate(&e);
    let user = Address::generate(&e);

    assert!(f.token.try_burn(&user, &100, &stranger).is_err());
    assert!(f.token.try_burn(&user, &100, &f.admin).is_err());
}

#[test]
fn unauthorized_caller_cannot_forced_transfer() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);
    let stranger = Address::generate(&e);
    let from = Address::generate(&e);
    let to = Address::generate(&e);

    assert!(f
        .token
        .try_forced_transfer(&from, &to, &100, &stranger)
        .is_err());
    assert!(f
        .token
        .try_forced_transfer(&from, &to, &100, &f.admin)
        .is_err());
}

#[test]
fn unauthorized_caller_cannot_freeze_or_recover() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);
    let stranger = Address::generate(&e);
    let user = Address::generate(&e);
    let new_user = Address::generate(&e);

    assert!(f
        .token
        .try_set_address_frozen(&user, &true, &stranger)
        .is_err());
    assert!(f
        .token
        .try_freeze_partial_tokens(&user, &100, &stranger)
        .is_err());
    assert!(f
        .token
        .try_unfreeze_partial_tokens(&user, &100, &stranger)
        .is_err());
    assert!(f
        .token
        .try_recover_balance(&user, &new_user, &stranger)
        .is_err());
}

#[test]
fn unauthorized_caller_cannot_set_compliance_or_verifier() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);
    let stranger = Address::generate(&e);
    let new_comp = Address::generate(&e);
    let new_verifier = Address::generate(&e);

    assert!(f.token.try_set_compliance(&new_comp, &stranger).is_err());
    assert!(f
        .token
        .try_set_identity_verifier(&new_verifier, &stranger)
        .is_err());
}

#[test]
fn the_admin_cannot_renounce_itself_out_of_the_token() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);

    assert!(f.token.try_renounce_admin().is_err());

    // Still governed: the admin-only paths keep working.
    f.token.pause(&f.admin);
    f.token.unpause(&f.admin);
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));
}

#[test]
fn admin_handover_in_two_steps_still_works() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);
    let new_admin = Address::generate(&e);
    let live_until_ledger = e.ledger().sequence() + 100;

    f.token.transfer_admin_role(&new_admin, &live_until_ledger);
    // Nothing moves until the new admin accepts.
    assert_eq!(f.token.get_admin(), Some(f.admin.clone()));

    f.token.accept_admin_transfer();
    assert_eq!(f.token.get_admin(), Some(new_admin.clone()));

    // The old admin no longer administers; the new one does.
    e.set_auths(&[]);
    assert!(f.token.try_pause(&f.admin).is_err());
    e.mock_all_auths();
    f.token.pause(&new_admin);
    assert!(f.token.paused());
}
