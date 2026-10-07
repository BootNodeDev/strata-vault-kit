use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal, String, Symbol,
};
use stellar_access::access_control::{self as access_control, AccessControlError};
use stellar_tokens::rwa::RWAError;

use crate::{ShareToken, ShareTokenClient};
use compliance::{Compliance, ComplianceClient};
use identity_verifier::{IdentityVerifier, IdentityVerifierClient};

#[test]
fn manager_mints_to_allowlisted_account() {
    let e = Env::default();
    e.mock_all_auths();

    let admin = Address::generate(&e);
    let manager = Address::generate(&e);
    let compliance_authority = Address::generate(&e);
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
                compliance_authority.clone(),
                compliance.address.clone(),
                identity.address.clone(),
            ),
        ),
    );
    token.grant_role(&manager, &symbol_short!("manager"), &admin);

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
    compliance_authority: Address,
    #[allow(dead_code)]
    compliance: Address,
    #[allow(dead_code)]
    identity_verifier: Address,
}

fn setup_fixture(e: &Env) -> Fixture<'_> {
    let admin = Address::generate(e);
    let manager = Address::generate(e);
    let compliance_authority = Address::generate(e);
    let compliance = Address::generate(e);
    let identity_verifier = Address::generate(e);

    let id = e.register(
        ShareToken,
        (
            String::from_str(e, "RWA Vault USDC"),
            String::from_str(e, "rwsUSDC"),
            admin.clone(),
            compliance_authority.clone(),
            compliance.clone(),
            identity_verifier.clone(),
        ),
    );
    // Stands in for the vault, which governance grants the role after deploying it.
    e.as_contract(&id, || {
        access_control::grant_role_no_auth(e, &manager, &symbol_short!("manager"), &admin)
    });
    Fixture {
        e: e.clone(),
        token: ShareTokenClient::new(e, &id),
        admin,
        manager,
        compliance_authority,
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
    let f = setup_fixture(&e);
    let stranger = Address::generate(&e);
    let new_comp = Address::generate(&e);
    let new_verifier = Address::generate(&e);

    // Without the admin's signature, nobody swaps the rules.
    assert!(f.token.try_set_compliance(&new_comp, &stranger).is_err());
    assert!(f
        .token
        .try_set_identity_verifier(&new_verifier, &stranger)
        .is_err());
    assert!(f.token.try_set_compliance(&new_comp, &f.manager).is_err());
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

/// Builds a token whose verifier and rules are real contracts, so interventions
/// can move balances.
fn setup_live(e: &Env) -> (Fixture<'_>, IdentityVerifierClient<'_>) {
    let f = setup_fixture(e);
    e.mock_all_auths();
    let rules = ComplianceClient::new(e, &e.register(Compliance, (f.admin.clone(),)));
    let identity =
        IdentityVerifierClient::new(e, &e.register(IdentityVerifier, (f.admin.clone(),)));
    f.token.set_compliance(&rules.address, &f.admin);
    f.token.set_identity_verifier(&identity.address, &f.admin);
    rules.bind_token(&f.token.address, &f.admin);
    (f, identity)
}

fn assert_unauthorized<T, E>(
    result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
) {
    assert_eq!(
        result.err(),
        Some(Ok(AccessControlError::Unauthorized.into())),
    );
}

#[test]
fn the_compliance_authority_freezes_and_moves_balances() {
    let e = Env::default();
    let (f, identity) = setup_live(&e);
    let holder = Address::generate(&e);
    let target = Address::generate(&e);
    identity.allow(&holder, &true, &f.admin);
    f.token.mint(&holder, &1_000, &f.manager);

    f.token
        .set_address_frozen(&holder, &true, &f.compliance_authority);
    assert!(f.token.is_frozen(&holder));
    f.token
        .set_address_frozen(&holder, &false, &f.compliance_authority);
    assert!(!f.token.is_frozen(&holder));

    f.token
        .freeze_partial_tokens(&holder, &400, &f.compliance_authority);
    assert_eq!(f.token.get_frozen_tokens(&holder), 400);
    f.token
        .unfreeze_partial_tokens(&holder, &400, &f.compliance_authority);
    assert_eq!(f.token.get_frozen_tokens(&holder), 0);

    f.token
        .forced_transfer(&holder, &target, &250, &f.compliance_authority);
    assert_eq!(f.token.balance(&target), 250);
}

#[test]
fn the_compliance_authority_reaches_recovery() {
    let e = Env::default();
    let (f, identity) = setup_live(&e);
    let lost = Address::generate(&e);
    let replacement = Address::generate(&e);
    identity.allow(&replacement, &true, &f.admin);

    // The role check passes; the testnet verifier names no recovery target.
    assert_eq!(
        f.token
            .try_recover_balance(&lost, &replacement, &f.compliance_authority)
            .err(),
        Some(Ok(RWAError::IdentityMismatch.into())),
    );
}

#[test]
fn the_compliance_authority_cannot_mint_burn_or_swap_the_rules() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);
    let user = Address::generate(&e);
    let other = Address::generate(&e);

    assert_unauthorized(f.token.try_mint(&user, &100, &f.compliance_authority));
    assert_unauthorized(f.token.try_burn(&user, &100, &f.compliance_authority));

    // Only the compliance authority signs: swapping the rules needs the admin.
    e.set_auths(&[]);
    let signed_by_compliance = |fn_name: &'static str, arg: &Address| {
        e.mock_auths(&[MockAuth {
            address: &f.compliance_authority,
            invoke: &MockAuthInvoke {
                contract: &f.token.address,
                fn_name,
                args: (arg.clone(), f.compliance_authority.clone()).into_val(&e),
                sub_invokes: &[],
            },
        }]);
    };
    signed_by_compliance("set_compliance", &other);
    assert!(f
        .token
        .try_set_compliance(&other, &f.compliance_authority)
        .is_err());
    signed_by_compliance("set_identity_verifier", &other);
    assert!(f
        .token
        .try_set_identity_verifier(&other, &f.compliance_authority)
        .is_err());
}

#[test]
fn the_manager_escrows_but_does_not_intervene() {
    let e = Env::default();
    let (f, identity) = setup_live(&e);
    let holder = Address::generate(&e);
    let new_holder = Address::generate(&e);
    identity.allow(&holder, &true, &f.admin);
    f.token.mint(&holder, &1_000, &f.manager);

    assert_unauthorized(f.token.try_set_address_frozen(&holder, &true, &f.manager));
    assert_unauthorized(f.token.try_freeze_partial_tokens(&holder, &100, &f.manager));
    assert_unauthorized(
        f.token
            .try_unfreeze_partial_tokens(&holder, &100, &f.manager),
    );
    assert_unauthorized(
        f.token
            .try_recover_balance(&holder, &new_holder, &f.manager),
    );

    // The vault escrows redemptions with a forced transfer.
    f.token
        .forced_transfer(&holder, &f.manager, &300, &f.manager);
    assert_eq!(f.token.balance(&f.manager), 300);
}

#[test]
fn the_admin_swaps_the_rules_and_the_verifier() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);
    let rules = Address::generate(&e);
    let verifier = Address::generate(&e);

    f.token.set_compliance(&rules, &f.admin);
    f.token.set_identity_verifier(&verifier, &f.admin);
    assert_eq!(f.token.compliance(), rules);
    assert_eq!(f.token.identity_verifier(), verifier);
}

#[test]
fn the_constructor_grants_the_compliance_role_and_no_manager() {
    let e = Env::default();
    let f = setup_fixture(&e);

    assert!(f
        .token
        .has_role(&f.compliance_authority, &Symbol::new(&e, "compliance"))
        .is_some());
    assert!(f
        .token
        .has_role(&f.compliance_authority, &symbol_short!("manager"))
        .is_none());
    assert!(f
        .token
        .has_role(&f.admin, &symbol_short!("manager"))
        .is_none());
}
