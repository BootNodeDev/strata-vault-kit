use soroban_sdk::{contract, contractimpl, testutils::Events as _, vec, Event as _, IntoVal, Vec};
use stellar_access::role_transfer::RoleTransferError;

use super::*;
use crate::SetupFinished;

#[test]
fn a_deposit_before_setup_finishes_is_refused() {
    let f = setup_unfinished();
    let investor = f.investor(1_000);

    refused(
        f.vault.try_request_deposit(&investor, &100),
        VaultError::SetupOpen,
    );
    assert!(f.vault.setup_open());
}

#[test]
fn setup_finishes_once_the_wiring_is_complete() {
    let f = setup_unfinished();

    f.vault.finish_setup(&f.admin);

    assert!(!f.vault.setup_open());
    let investor = f.investor(1_000);
    f.vault.request_deposit(&investor, &100);
}

#[test]
fn finishing_setup_publishes_it() {
    let f = setup_unfinished();

    f.vault.finish_setup(&f.admin);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [SetupFinished {}.to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn setup_never_finishes_twice() {
    let f = setup();

    refused(f.vault.try_finish_setup(&f.admin), VaultError::SetupClosed);
}

#[test]
fn every_wiring_step_is_checked_before_setup_finishes() {
    for miswire in [
        Miswire::TokenUnbound,
        Miswire::TokenBoundElsewhere,
        Miswire::TokenSetupOpen,
        Miswire::OracleUnbound,
        Miswire::OracleBoundElsewhere,
        Miswire::OracleSetupOpen,
        Miswire::NoManagerRole,
        Miswire::OtherManager,
        Miswire::SecondManager,
        Miswire::PreMinted,
        Miswire::NotAllowlisted,
        Miswire::VaultFrozen,
        Miswire::ComplianceUnbound,
        Miswire::ComplianceBoundElsewhere,
        Miswire::ComplianceSetupOpen,
    ] {
        let f = miswired(miswire);

        assert_eq!(
            f.vault.try_finish_setup(&f.admin),
            Err(Ok(VaultError::SetupIncomplete.into())),
            "{miswire:?}"
        );
        assert!(f.vault.setup_open(), "{miswire:?}");
    }
}

/// A compliance contract from outside the kit: it lists tokens and reports no vault.
#[contract]
struct ExternalRules;

#[contractimpl]
impl ExternalRules {
    pub fn link(e: Env, token: Address) {
        e.storage().instance().set(&symbol_short!("token"), &token);
    }

    pub fn linked_tokens(e: Env) -> Vec<Address> {
        let token: Address = e.storage().instance().get(&symbol_short!("token")).unwrap();
        vec![&e, token]
    }
}

/// Its own governance is a trust assumption the vault cannot check.
#[test]
fn a_compliance_contract_from_outside_the_kit_is_accepted() {
    let f = setup_with(
        open_feed(),
        |e, (name, symbol, admin, authority, _, verifier)| {
            let rules = e.register(ExternalRules, ());
            let token = e.register(
                ShareToken,
                (name, symbol, admin, authority, rules.clone(), verifier),
            );
            ExternalRulesClient::new(e, &rules).link(&token);
            token
        },
    );

    assert!(!f.vault.setup_open());
    assert!(f.vault.health().compliance_bound);
}

/// A token that cannot answer `wiring`'s calls must not trap the vault: every
/// check it needs the token for reads false, and `finish_setup` refuses
/// cleanly instead of aborting the transaction.
#[test]
fn a_token_that_cannot_answer_fails_its_checks_instead_of_trapping() {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_timestamp(10_000);

    let issuer = Address::generate(&e);
    let asset = e.register_stellar_asset_contract_v2(issuer).address();
    let admin = Address::generate(&e);
    let manager = Address::generate(&e);
    let treasury = Address::generate(&e);
    let guardian = Address::generate(&e);
    let compliance_authority = Address::generate(&e);
    let attester = Address::generate(&e);
    let broken_token = Address::generate(&e);

    let oracle = NavOracleContractClient::new(
        &e,
        &e.register(
            NavOracleContract,
            (
                admin.clone(),
                attester.clone(),
                guardian.clone(),
                open_feed(),
            ),
        ),
    );

    let contract_id = e.register(
        AsyncVault,
        (
            &asset,
            &broken_token,
            &oracle.address,
            VaultRoles {
                governance: admin.clone(),
                manager,
                treasury,
                guardian: guardian.clone(),
                compliance: compliance_authority,
                attester,
            },
        ),
    );
    oracle.bind_vault(&contract_id, &admin);
    oracle.finish_setup(&admin);

    let vault = AsyncVaultClient::new(&e, &contract_id);

    let health = vault.health();
    assert!(health.oracle_bound);
    assert!(!health.token_bound);
    assert!(!health.sole_token_manager);
    assert!(!health.allowlisted);
    assert!(!health.vault_unfrozen);
    assert!(!health.compliance_bound);

    refused(vault.try_finish_setup(&admin), VaultError::SetupIncomplete);
}

#[test]
fn setup_cannot_finish_while_a_hand_over_is_pending() {
    let f = setup_unfinished();
    let next = Address::generate(&f.e);
    f.vault
        .transfer_admin_role(&next, &(f.e.ledger().sequence() + 100));

    refused(
        f.vault.try_finish_setup(&f.admin),
        VaultError::AdminTransferPending,
    );

    f.vault.transfer_admin_role(&next, &0);
    f.vault.finish_setup(&f.admin);
    assert!(f.vault.try_accept_admin_transfer().is_err());
    assert_eq!(f.vault.governance(), Some(f.admin.clone()));
}

#[test]
fn an_expired_hand_over_does_not_hold_setup_open() {
    let f = setup_unfinished();
    f.vault
        .transfer_admin_role(&Address::generate(&f.e), &(f.e.ledger().sequence() + 10));
    f.e.ledger().with_mut(|l| l.sequence_number += 11);

    f.vault.finish_setup(&f.admin);

    assert!(!f.vault.setup_open());
    assert_eq!(
        f.vault.try_accept_admin_transfer(),
        Err(Ok(RoleTransferError::NoPendingTransfer.into()))
    );
    assert_eq!(f.vault.governance(), Some(f.admin.clone()));
}

#[test]
fn only_governance_finishes_setup() {
    let f = setup_unfinished();
    let stranger = Address::generate(&f.e);

    for who in [&stranger, &f.manager] {
        f.sign_only_as(who, "finish_setup", (who.clone(),).into_val(&f.e));
        assert!(f.vault.try_finish_setup(who).is_err());
    }
    assert!(f.vault.setup_open());
}

#[test]
fn admin_changes_are_instant_during_setup() {
    let f = setup_unfinished();
    let next = Address::generate(&f.e);

    f.vault.set_custodian(&f.custodian, &f.admin);
    f.vault.set_notice(&3_600, &f.admin);
    f.vault.set_notice(&0, &f.admin);
    f.vault
        .set_wind_down_delay(&(2 * MIN_WIND_DOWN_DELAY), &f.admin);
    f.vault.set_wind_down_delay(&MIN_WIND_DOWN_DELAY, &f.admin);
    f.vault
        .grant_role(&next, &symbol_short!("guardian"), &f.admin);
    f.vault
        .revoke_role(&f.manager, &symbol_short!("manager"), &f.admin);

    assert_eq!(f.vault.custodian(), Some(f.custodian.clone()));
    assert_eq!(f.vault.notice(), 0);
    assert_eq!(f.vault.wind_down_delay(), MIN_WIND_DOWN_DELAY);
    assert!(f
        .vault
        .has_role(&next, &symbol_short!("guardian"))
        .is_some());
    assert_eq!(f.vault.manager(), None);
}

#[test]
fn nothing_is_proposed_during_setup() {
    let f = setup_unfinished();

    refused(
        f.vault
            .try_propose_change(&VaultChange::Custodian(f.custodian.clone()), &f.admin),
        VaultError::SetupOpen,
    );
    refused(
        f.vault.try_propose_change(
            &VaultChange::WindDownDelay(MIN_WIND_DOWN_DELAY - 1),
            &f.admin,
        ),
        VaultError::SetupOpen,
    );
    assert_eq!(f.vault.pending_changes().len(), 0);
}
