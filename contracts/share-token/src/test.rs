extern crate std;

use soroban_sdk::{
    symbol_short,
    testutils::{
        storage::Instance as _, Address as _, AuthorizedFunction, AuthorizedInvocation,
        Ledger as _, MockAuth, MockAuthInvoke,
    },
    Address, Env, IntoVal, String, Symbol, Val, Vec,
};
use stellar_access::access_control::{self as access_control, AccessControlError};
use stellar_tokens::rwa::RWAError;
use strata_storage::INSTANCE_EXTEND_AMOUNT;

use crate::{ShareToken, ShareTokenClient, ShareTokenError};
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
    identity.allow(&receiver, &true);

    token.mint(&receiver, &100, &manager);

    assert_eq!(token.balance(&receiver), 100);
}

struct Fixture<'a> {
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

impl Fixture<'_> {
    /// The last call asked each of `signers`, in order, to sign it once, and nobody else.
    fn signed_once_by(&self, signers: &[&Address], fn_name: &str, args: Vec<Val>) {
        let call = AuthorizedInvocation {
            function: AuthorizedFunction::Contract((
                self.token.address.clone(),
                Symbol::new(&self.e, fn_name),
                args,
            )),
            sub_invocations: std::vec![],
        };
        let expected: std::vec::Vec<_> = signers
            .iter()
            .map(|who| ((*who).clone(), call.clone()))
            .collect();
        assert_eq!(self.e.auths(), expected);
    }
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
fn the_last_compliance_holder_cannot_renounce() {
    let e = Env::default();
    e.mock_all_auths();
    let f = setup_fixture(&e);
    let role = Symbol::new(&e, "compliance");

    assert_eq!(
        f.token
            .try_renounce_role(&role, &f.compliance_authority)
            .err(),
        Some(Ok(ShareTokenError::LastComplianceHolder.into())),
    );
    let backup = Address::generate(&e);
    f.token.grant_role(&backup, &role, &f.admin);
    f.token.renounce_role(&role, &f.compliance_authority);
    assert_eq!(
        f.token.try_renounce_role(&role, &backup).err(),
        Some(Ok(ShareTokenError::LastComplianceHolder.into())),
    );
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
    identity.allow(&holder, &true);
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

    identity.allow(&target, &true);
    f.token.legal_transfer(
        &holder,
        &target,
        &250,
        &String::from_str(&e, "court-order-2026-117"),
        &f.compliance_authority,
    );
    assert_eq!(f.token.balance(&target), 250);
}

#[test]
fn the_compliance_authority_reaches_recovery() {
    let e = Env::default();
    let (f, identity) = setup_live(&e);
    let lost = Address::generate(&e);
    let replacement = Address::generate(&e);
    identity.allow(&replacement, &true);

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
    identity.allow(&holder, &true);
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

const TWO_DAYS_IN_LEDGERS: u32 = 2 * 17_280;

fn instance_ttl(e: &Env, id: &Address) -> u32 {
    e.as_contract(id, || e.storage().instance().get_ttl())
}

fn age(e: &Env, ledgers: u32) {
    e.ledger().with_mut(|l| l.sequence_number += ledgers);
}

/// A live token whose instance has decayed past the extend threshold, with
/// two allowlisted holders, the first holding 100 shares.
fn decayed_live_token(e: &Env) -> (Fixture<'_>, Address, Address) {
    let (f, identity) = setup_live(e);
    let holder = Address::generate(e);
    let other = Address::generate(e);
    identity.allow(&holder, &true);
    identity.allow(&other, &true);
    f.token.mint(&holder, &100, &f.manager);

    age(e, TWO_DAYS_IN_LEDGERS);
    assert!(instance_ttl(e, &f.token.address) < INSTANCE_EXTEND_AMOUNT);
    (f, holder, other)
}

#[test]
fn construction_writes_the_instance_with_the_full_ttl() {
    let e = Env::default();
    let f = setup_fixture(&e);

    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn a_transfer_restores_the_instance_ttl() {
    let e = Env::default();
    let (f, holder, other) = decayed_live_token(&e);

    f.token.transfer(&holder, &other, &10);

    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn a_transfer_from_restores_the_instance_ttl() {
    let e = Env::default();
    let (f, holder, other) = decayed_live_token(&e);
    let live_until = e.ledger().sequence() + 3 * 17_280;
    f.token.approve(&holder, &other, &10, &live_until);
    age(&e, TWO_DAYS_IN_LEDGERS);
    assert!(instance_ttl(&e, &f.token.address) < INSTANCE_EXTEND_AMOUNT);

    f.token.transfer_from(&other, &holder, &other, &10);

    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn an_approval_restores_the_instance_ttl() {
    let e = Env::default();
    let (f, holder, other) = decayed_live_token(&e);

    let live_until = e.ledger().sequence() + 100;
    f.token.approve(&holder, &other, &10, &live_until);

    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn the_vaults_mint_burn_and_escrow_restore_the_instance_ttl() {
    let e = Env::default();
    let (f, holder, other) = decayed_live_token(&e);

    f.token.mint(&other, &5, &f.manager);
    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);

    age(&e, TWO_DAYS_IN_LEDGERS);
    f.token.forced_transfer(&holder, &other, &5, &f.manager);
    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);

    age(&e, TWO_DAYS_IN_LEDGERS);
    f.token.burn(&other, &5, &f.manager);
    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn compliance_interventions_restore_the_instance_ttl() {
    let e = Env::default();
    let (f, holder, _) = decayed_live_token(&e);

    f.token
        .set_address_frozen(&holder, &true, &f.compliance_authority);

    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn a_legal_transfer_restores_the_instance_ttl() {
    let e = Env::default();
    let (f, holder, other) = decayed_live_token(&e);

    f.token.legal_transfer(
        &holder,
        &other,
        &10,
        &String::from_str(&e, "court-order-2026-117"),
        &f.compliance_authority,
    );

    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn reading_a_balance_or_the_supply_restores_the_instance_ttl() {
    let e = Env::default();
    let (f, holder, _) = decayed_live_token(&e);

    f.token.balance(&holder);
    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);

    age(&e, TWO_DAYS_IN_LEDGERS);
    f.token.total_supply();
    assert_eq!(instance_ttl(&e, &f.token.address), INSTANCE_EXTEND_AMOUNT);
}

#[test]
fn each_role_call_asks_its_holder_for_one_signature() {
    let e = Env::default();
    let (f, identity) = setup_live(&e);
    let holder = Address::generate(&e);
    let other = Address::generate(&e);
    identity.allow(&holder, &true);
    identity.allow(&other, &true);

    f.token.mint(&holder, &1_000, &f.manager);
    f.signed_once_by(
        &[&f.manager],
        "mint",
        (holder.clone(), 1_000_i128, f.manager.clone()).into_val(&e),
    );
    f.token.burn(&holder, &100, &f.manager);
    f.signed_once_by(
        &[&f.manager],
        "burn",
        (holder.clone(), 100_i128, f.manager.clone()).into_val(&e),
    );
    f.token.forced_transfer(&holder, &other, &100, &f.manager);
    f.signed_once_by(
        &[&f.manager],
        "forced_transfer",
        (holder.clone(), other, 100_i128, f.manager.clone()).into_val(&e),
    );

    let compliance = &f.compliance_authority;
    f.token.freeze_partial_tokens(&holder, &50, compliance);
    f.signed_once_by(
        &[compliance],
        "freeze_partial_tokens",
        (holder.clone(), 50_i128, compliance.clone()).into_val(&e),
    );
    f.token.unfreeze_partial_tokens(&holder, &50, compliance);
    f.signed_once_by(
        &[compliance],
        "unfreeze_partial_tokens",
        (holder.clone(), 50_i128, compliance.clone()).into_val(&e),
    );
    f.token.set_address_frozen(&holder, &true, compliance);
    f.signed_once_by(
        &[compliance],
        "set_address_frozen",
        (holder, true, compliance.clone()).into_val(&e),
    );

    let role = Symbol::new(&e, "compliance");
    f.token.grant_role(&Address::generate(&e), &role, &f.admin);
    f.token.renounce_role(&role, compliance);
    f.signed_once_by(
        &[compliance],
        "renounce_role",
        (role, compliance.clone()).into_val(&e),
    );
}

mod legal_transfer {
    use soroban_sdk::{
        contract, contractimpl, contracttype,
        testutils::Events as _,
        xdr::{ScErrorCode, ScErrorType},
        Event as _,
    };
    use stellar_tokens::rwa::identity_verification;
    use strata_timelock::{Clock, MIN_DELAY};

    use super::*;
    use crate::{LegalTransfer, ShareTokenError, MAX_REFERENCE_LEN};

    /// Plays the vault: the token binds only to an address that reports a
    /// clock.
    #[contract]
    struct VaultStub;

    #[contractimpl(contracttrait)]
    impl strata_timelock::ClockSource for VaultStub {
        fn timelock_clock(_e: &Env) -> Clock {
            Clock {
                delay: MIN_DELAY,
                exit_window: 0,
                paused_secs: 0,
                paused: false,
                winding_down: false,
            }
        }
    }

    fn order(e: &Env) -> String {
        String::from_str(e, "court-order-2026-117")
    }

    /// Real rules and verifier, a holder with 1,000 shares, an allowlisted
    /// destination and a bound vault that holds 500 shares of escrow.
    fn live(e: &Env) -> (Fixture<'_>, Address, Address, Address) {
        let (f, identity) = setup_live(e);
        let holder = Address::generate(e);
        let destination = Address::generate(e);
        let vault = e.register(VaultStub, ());
        for who in [&holder, &destination, &vault] {
            identity.allow(who, &true);
        }
        f.token.mint(&holder, &1_000, &f.manager);
        f.token.mint(&vault, &500, &f.manager);
        f.token.bind_vault(&vault);
        (f, holder, destination, vault)
    }

    /// A missing signature fails in the host, not as a contract error.
    fn missing_signature<T, E>(
        result: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    ) {
        assert_eq!(
            result.err(),
            Some(Ok(soroban_sdk::Error::from_type_and_code(
                ScErrorType::Context,
                ScErrorCode::InvalidAction
            ))),
        );
    }

    #[test]
    fn compliance_and_the_admin_move_shares_together() {
        let e = Env::default();
        let (f, holder, destination, _) = live(&e);

        f.token.legal_transfer(
            &holder,
            &destination,
            &250,
            &order(&e),
            &f.compliance_authority,
        );

        let events = e.events().all().filter_by_contract(&f.token.address);
        assert_eq!(
            events.events().last(),
            Some(
                &LegalTransfer {
                    from: holder.clone(),
                    to: destination.clone(),
                    amount: 250,
                    reference: order(&e),
                }
                .to_xdr(&e, &f.token.address)
            )
        );
        assert_eq!(f.token.balance(&holder), 750);
        assert_eq!(f.token.balance(&destination), 250);
    }

    #[test]
    fn a_zero_share_legal_transfer_passes_and_is_published() {
        let e = Env::default();
        let (f, holder, destination, _) = live(&e);

        f.token.legal_transfer(
            &holder,
            &destination,
            &0,
            &order(&e),
            &f.compliance_authority,
        );

        let events = e.events().all().filter_by_contract(&f.token.address);
        assert_eq!(
            events.events().last(),
            Some(
                &LegalTransfer {
                    from: holder.clone(),
                    to: destination.clone(),
                    amount: 0,
                    reference: order(&e),
                }
                .to_xdr(&e, &f.token.address)
            )
        );
        assert_eq!(f.token.balance(&holder), 1_000);
        assert_eq!(f.token.balance(&destination), 0);
    }

    #[test]
    fn compliance_alone_cannot_move_shares() {
        let e = Env::default();
        let (f, holder, destination, _) = live(&e);
        let invoke = MockAuthInvoke {
            contract: &f.token.address,
            fn_name: "legal_transfer",
            args: (
                holder.clone(),
                destination.clone(),
                250i128,
                order(&e),
                f.compliance_authority.clone(),
            )
                .into_val(&e),
            sub_invokes: &[],
        };
        let transfer = || {
            f.token.try_legal_transfer(
                &holder,
                &destination,
                &250,
                &order(&e),
                &f.compliance_authority,
            )
        };

        e.mock_auths(&[MockAuth {
            address: &f.compliance_authority,
            invoke: &invoke,
        }]);
        missing_signature(transfer());
        assert_eq!(f.token.balance(&holder), 1_000);

        e.mock_auths(&[
            MockAuth {
                address: &f.compliance_authority,
                invoke: &invoke,
            },
            MockAuth {
                address: &f.admin,
                invoke: &invoke,
            },
        ]);
        assert_eq!(transfer(), Ok(Ok(())));
        assert_eq!(f.token.balance(&destination), 250);
    }

    #[test]
    fn nothing_leaves_the_vault_address() {
        let e = Env::default();
        let (f, _, destination, vault) = live(&e);

        assert_eq!(
            f.token
                .try_legal_transfer(
                    &vault,
                    &destination,
                    &100,
                    &order(&e),
                    &f.compliance_authority
                )
                .err(),
            Some(Ok(ShareTokenError::VaultAddress.into())),
        );
        assert_eq!(f.token.balance(&vault), 500);
    }

    #[test]
    fn nothing_lands_on_the_vault_address() {
        let e = Env::default();
        let (f, holder, _, vault) = live(&e);

        assert_eq!(
            f.token
                .try_legal_transfer(&holder, &vault, &100, &order(&e), &f.compliance_authority)
                .err(),
            Some(Ok(ShareTokenError::VaultAddress.into())),
        );
        assert_eq!(f.token.balance(&holder), 1_000);
    }

    #[test]
    fn a_transfer_into_the_vault_is_refused() {
        let e = Env::default();
        let (f, holder, destination, vault) = live(&e);

        assert_eq!(
            f.token.try_transfer(&holder, &vault, &100).err(),
            Some(Ok(ShareTokenError::VaultAddress.into())),
        );
        f.token
            .approve(&holder, &destination, &100, &(e.ledger().sequence() + 100));
        assert_eq!(
            f.token
                .try_transfer_from(&destination, &holder, &vault, &100)
                .err(),
            Some(Ok(ShareTokenError::VaultAddress.into())),
        );
        f.token.transfer(&holder, &destination, &100);
        assert_eq!(f.token.balance(&vault), 500);
    }

    #[test]
    fn the_destination_must_pass_the_identity_check() {
        let e = Env::default();
        let (f, holder, _, _) = live(&e);
        let stranger = Address::generate(&e);

        assert_eq!(
            f.token
                .try_legal_transfer(
                    &holder,
                    &stranger,
                    &100,
                    &order(&e),
                    &f.compliance_authority
                )
                .err(),
            Some(Ok(RWAError::IdentityVerificationFailed.into())),
        );
        assert_eq!(f.token.balance(&holder), 1_000);
    }

    #[test]
    fn the_order_reference_is_required_and_bounded() {
        let e = Env::default();
        let (f, holder, destination, _) = live(&e);
        let bytes = [b'x'; MAX_REFERENCE_LEN as usize + 1];
        let reference_of = |len: u32| String::from_bytes(&e, &bytes[..len as usize]);

        for reference in [reference_of(0), reference_of(MAX_REFERENCE_LEN + 1)] {
            assert_eq!(
                f.token
                    .try_legal_transfer(
                        &holder,
                        &destination,
                        &100,
                        &reference,
                        &f.compliance_authority
                    )
                    .err(),
                Some(Ok(ShareTokenError::InvalidReference.into())),
            );
        }

        for reference in [reference_of(1), reference_of(MAX_REFERENCE_LEN)] {
            f.token.legal_transfer(
                &holder,
                &destination,
                &100,
                &reference,
                &f.compliance_authority,
            );
        }
        assert_eq!(f.token.balance(&destination), 200);
    }

    #[test]
    fn one_account_cannot_co_sign_with_itself() {
        let e = Env::default();
        let (f, holder, destination, _) = live(&e);
        f.token
            .grant_role(&f.admin, &Symbol::new(&e, "compliance"), &f.admin);

        assert_eq!(
            f.token
                .try_legal_transfer(&holder, &destination, &100, &order(&e), &f.admin)
                .err(),
            Some(Ok(ShareTokenError::CoSignRequired.into())),
        );
        assert_eq!(f.token.balance(&holder), 1_000);
    }

    #[test]
    fn compliance_no_longer_forces_transfers() {
        let e = Env::default();
        let (f, holder, destination, _) = live(&e);

        assert_unauthorized(f.token.try_forced_transfer(
            &holder,
            &destination,
            &100,
            &f.compliance_authority,
        ));
    }

    /// Accepts every account and names one recovery target; the kit's
    /// verifier names none, so no recovery could succeed with it.
    #[contract]
    struct RecoveringVerifier;

    #[contracttype]
    enum RecoveryKey {
        Target,
    }

    #[contractimpl]
    impl RecoveringVerifier {
        pub fn set_target(e: Env, target: Address) {
            e.storage().instance().set(&RecoveryKey::Target, &target);
        }
    }

    #[contractimpl(contracttrait)]
    impl identity_verification::IdentityVerifier for RecoveringVerifier {
        fn verify_identity(_e: &Env, _account: &Address) {}

        fn recovery_target(e: &Env, _old_account: &Address) -> Option<Address> {
            e.storage().instance().get(&RecoveryKey::Target)
        }

        fn set_claim_topics_and_issuers(
            _e: &Env,
            _claim_topics_and_issuers: Address,
            _operator: Address,
        ) {
        }
    }

    /// The live fixture's setup is still open, so the verifier swap is instant.
    fn recovering_to(e: &Env, f: &Fixture, target: &Address) {
        let verifier = RecoveringVerifierClient::new(e, &e.register(RecoveringVerifier, ()));
        verifier.set_target(target);
        f.token.set_identity_verifier(&verifier.address, &f.admin);
    }

    #[test]
    fn recovery_needs_the_admin_too() {
        let e = Env::default();
        let (f, holder, destination, _) = live(&e);
        recovering_to(&e, &f, &destination);
        let invoke = MockAuthInvoke {
            contract: &f.token.address,
            fn_name: "recover_balance",
            args: (
                holder.clone(),
                destination.clone(),
                f.compliance_authority.clone(),
            )
                .into_val(&e),
            sub_invokes: &[],
        };

        e.mock_auths(&[MockAuth {
            address: &f.compliance_authority,
            invoke: &invoke,
        }]);
        missing_signature(f.token.try_recover_balance(
            &holder,
            &destination,
            &f.compliance_authority,
        ));
        assert_eq!(f.token.balance(&holder), 1_000);

        e.mock_auths(&[
            MockAuth {
                address: &f.compliance_authority,
                invoke: &invoke,
            },
            MockAuth {
                address: &f.admin,
                invoke: &invoke,
            },
        ]);
        assert!(f
            .token
            .recover_balance(&holder, &destination, &f.compliance_authority));
        assert_eq!(f.token.balance(&holder), 0);
        assert_eq!(f.token.balance(&destination), 1_000);
    }

    #[test]
    fn a_legal_transfer_or_a_recovery_asks_each_signer_once() {
        let e = Env::default();
        let (f, holder, destination, _) = live(&e);

        f.token.legal_transfer(
            &holder,
            &destination,
            &250,
            &order(&e),
            &f.compliance_authority,
        );
        f.signed_once_by(
            &[&f.compliance_authority, &f.admin],
            "legal_transfer",
            (
                holder.clone(),
                destination.clone(),
                250_i128,
                order(&e),
                f.compliance_authority.clone(),
            )
                .into_val(&e),
        );

        recovering_to(&e, &f, &destination);
        f.token
            .recover_balance(&holder, &destination, &f.compliance_authority);
        f.signed_once_by(
            &[&f.compliance_authority, &f.admin],
            "recover_balance",
            (holder, destination, f.compliance_authority.clone()).into_val(&e),
        );
    }

    #[test]
    fn recovery_never_takes_the_vault_balance() {
        let e = Env::default();
        let (f, _, destination, vault) = live(&e);
        recovering_to(&e, &f, &destination);

        assert_eq!(
            f.token
                .try_recover_balance(&vault, &destination, &f.compliance_authority)
                .err(),
            Some(Ok(ShareTokenError::VaultAddress.into())),
        );
        assert_eq!(f.token.balance(&vault), 500);
    }

    #[test]
    fn recovery_never_lands_on_the_vault_address() {
        let e = Env::default();
        let (f, holder, _, vault) = live(&e);
        recovering_to(&e, &f, &vault);

        assert_eq!(
            f.token
                .try_recover_balance(&holder, &vault, &f.compliance_authority)
                .err(),
            Some(Ok(ShareTokenError::VaultAddress.into())),
        );
        assert_eq!(f.token.balance(&holder), 1_000);
    }

    #[test]
    fn the_vault_address_cannot_be_frozen() {
        let e = Env::default();
        let (f, _, _, vault) = live(&e);

        assert_eq!(
            f.token
                .try_set_address_frozen(&vault, &true, &f.compliance_authority)
                .err(),
            Some(Ok(ShareTokenError::VaultAddress.into())),
        );
        assert_eq!(
            f.token
                .try_freeze_partial_tokens(&vault, &100, &f.compliance_authority)
                .err(),
            Some(Ok(ShareTokenError::VaultAddress.into())),
        );
        f.token
            .set_address_frozen(&vault, &false, &f.compliance_authority);
        assert!(!f.token.is_frozen(&vault));
        assert_eq!(f.token.get_frozen_tokens(&vault), 0);
    }
}
