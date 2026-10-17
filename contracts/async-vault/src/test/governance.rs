use soroban_sdk::{
    testutils::{Events as _, MockAuth, MockAuthInvoke},
    Event as _, IntoVal,
};
use stellar_access::role_transfer::RoleTransferError;

use super::*;
use crate::{ChangeApplied, CustodianSet, ADMIN_ACCEPT_LEDGERS};

/// Proposes a change, waits one delay and applies it.
fn land(f: &Fixture, change: VaultChange) {
    let id = f.vault.propose_change(&change, &f.admin);
    f.advance(f.vault.upgrade_delay());
    f.vault.apply_change(&id, &f.admin);
}

#[test]
fn the_custodian_changes_through_the_timelock() {
    let f = setup();
    let next = Address::generate(&f.e);

    refused(
        f.vault.try_set_custodian(&next, &f.admin),
        VaultError::UseTimelock,
    );

    let id = f
        .vault
        .propose_change(&VaultChange::Custodian(next.clone()), &f.admin);
    f.advance(MIN_UPGRADE_DELAY - 1);
    refused(
        f.vault.try_apply_change(&id, &f.admin),
        VaultError::ChangeNotReady,
    );
    f.advance(1);
    f.vault.apply_change(&id, &f.admin);

    assert_eq!(f.vault.custodian(), Some(next));
}

#[test]
fn applying_a_custodian_change_publishes_both_events() {
    let f = setup();
    let next = Address::generate(&f.e);
    let change = VaultChange::Custodian(next.clone());
    let id = f.vault.propose_change(&change, &f.admin);
    f.advance(MIN_UPGRADE_DELAY);

    f.vault.apply_change(&id, &f.admin);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            CustodianSet { custodian: next }.to_xdr(&f.e, &f.vault.address),
            ChangeApplied { id, change }.to_xdr(&f.e, &f.vault.address),
        ]
    );
}

#[test]
fn raising_the_notice_is_instant_and_lowering_waits() {
    let f = setup();

    f.vault.set_notice(&DAY_DURATION, &f.admin);
    assert_eq!(f.vault.notice(), DAY_DURATION);

    refused(
        f.vault.try_set_notice(&3_600, &f.admin),
        VaultError::UseTimelock,
    );
    land(&f, VaultChange::Notice(3_600));

    assert_eq!(f.vault.notice(), 3_600);
}

#[test]
fn a_notice_change_still_respects_its_bounds() {
    let f = setup();

    refused(
        f.vault
            .try_propose_change(&VaultChange::Notice(MIN_UPGRADE_DELAY + 1), &f.admin),
        VaultError::NoticeAboveUpgradeDelay,
    );
}

#[test]
fn a_notice_change_checks_the_upgrade_delay_again_when_it_applies() {
    let f = setup();
    land(&f, VaultChange::UpgradeDelay(30 * DAY_DURATION));
    let notice = f
        .vault
        .propose_change(&VaultChange::Notice(20 * DAY_DURATION), &f.admin);
    let delay = f
        .vault
        .propose_change(&VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY), &f.admin);
    f.advance(30 * DAY_DURATION);

    // The delay falls below the notice the first change would set.
    f.vault.apply_change(&delay, &f.admin);

    refused(
        f.vault.try_apply_change(&notice, &f.admin),
        VaultError::NoticeAboveUpgradeDelay,
    );
    assert_eq!(f.vault.notice(), 0);
}

#[test]
fn raising_the_wind_down_delay_is_instant_and_lowering_waits() {
    let f = setup();

    f.vault
        .set_wind_down_delay(&(2 * MIN_WIND_DOWN_DELAY), &f.admin);
    refused(
        f.vault
            .try_set_wind_down_delay(&MIN_WIND_DOWN_DELAY, &f.admin),
        VaultError::UseTimelock,
    );
    land(&f, VaultChange::WindDownDelay(MIN_WIND_DOWN_DELAY));

    assert_eq!(f.vault.wind_down_delay(), MIN_WIND_DOWN_DELAY);
}

#[test]
fn a_wind_down_delay_below_the_minimum_cannot_be_proposed() {
    let f = setup();

    refused(
        f.vault.try_propose_change(
            &VaultChange::WindDownDelay(MIN_WIND_DOWN_DELAY - 1),
            &f.admin,
        ),
        VaultError::WindDownDelayTooShort,
    );
}

#[test]
fn grants_and_manager_revokes_wait_for_the_timelock() {
    let f = setup();
    let next = Address::generate(&f.e);

    refused(
        f.vault
            .try_grant_role(&next, &symbol_short!("treasury"), &f.admin),
        VaultError::UseTimelock,
    );
    refused(
        f.vault
            .try_revoke_role(&f.manager, &symbol_short!("manager"), &f.admin),
        VaultError::UseTimelock,
    );

    land(
        &f,
        VaultChange::GrantRole(symbol_short!("treasury"), next.clone()),
    );
    assert!(f
        .vault
        .has_role(&next, &symbol_short!("treasury"))
        .is_some());
}

#[test]
fn a_manager_revoke_lands_through_the_timelock() {
    let f = setup();

    land(
        &f,
        VaultChange::RevokeRole(symbol_short!("manager"), f.manager.clone()),
    );

    assert_eq!(f.vault.manager(), None);
    assert!(f.vault.try_close_epoch(&f.manager).is_err());
}

#[test]
fn revoking_treasury_or_guardian_stays_instant() {
    let f = setup();

    f.vault
        .revoke_role(&f.treasury, &symbol_short!("treasury"), &f.admin);
    f.vault
        .revoke_role(&f.guardian, &symbol_short!("guardian"), &f.admin);

    assert_eq!(f.vault.treasury(), None);
    assert_eq!(f.vault.guardian(), None);
}

#[test]
fn only_the_admin_revokes_a_role() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    assert!(f
        .vault
        .try_revoke_role(&f.treasury, &symbol_short!("treasury"), &stranger)
        .is_err());
    assert!(f
        .vault
        .try_revoke_role(&f.treasury, &symbol_short!("treasury"), &f.guardian)
        .is_err());
    assert_eq!(f.vault.treasury(), Some(f.treasury.clone()));
}

#[test]
fn no_role_ever_gets_a_role_admin() {
    for f in [setup_unfinished(), setup()] {
        refused(
            f.vault
                .try_set_role_admin(&symbol_short!("treasury"), &symbol_short!("guardian")),
            VaultError::UseTimelock,
        );
    }
}

#[test]
fn an_admin_hand_over_waits_but_cancelling_one_does_not() {
    let f = setup();
    let next = Address::generate(&f.e);

    refused(
        f.vault
            .try_transfer_admin_role(&next, &(f.e.ledger().sequence() + 100)),
        VaultError::UseTimelock,
    );

    land(&f, VaultChange::Admin(next.clone()));
    f.vault.transfer_admin_role(&next, &0);

    assert!(f.vault.try_accept_admin_transfer().is_err());
    assert_eq!(f.vault.governance(), Some(f.admin.clone()));
}

#[test]
fn an_applied_admin_change_starts_a_hand_over_the_next_admin_accepts() {
    let f = setup();
    let next = Address::generate(&f.e);
    let id = f
        .vault
        .propose_change(&VaultChange::Admin(next.clone()), &f.admin);
    f.advance(MIN_UPGRADE_DELAY);

    // The admin authorises this call and nothing else: the hand-over inside it
    // asks for no further signature. The entrypoint checks the admin and the
    // caller, so the same authorisation appears twice, as simulation records it.
    let apply = MockAuthInvoke {
        contract: &f.vault.address,
        fn_name: "apply_change",
        args: (id, f.admin.clone()).into_val(&f.e),
        sub_invokes: &[],
    };
    f.e.mock_auths(&[
        MockAuth {
            address: &f.admin,
            invoke: &apply,
        },
        MockAuth {
            address: &f.admin,
            invoke: &apply,
        },
    ]);
    f.vault.apply_change(&id, &f.admin);

    f.e.mock_all_auths();
    assert_eq!(f.vault.governance(), Some(f.admin.clone()));
    f.vault.accept_admin_transfer();
    assert_eq!(f.vault.governance(), Some(next));
}

#[test]
fn the_hand_over_offer_is_open_on_its_last_ledger() {
    let f = setup();
    let next = Address::generate(&f.e);
    land(&f, VaultChange::Admin(next.clone()));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS);
    f.vault.accept_admin_transfer();

    assert_eq!(f.vault.governance(), Some(next));
}

#[test]
fn the_hand_over_offer_lasts_seven_days_of_ledgers() {
    let f = setup();
    land(&f, VaultChange::Admin(Address::generate(&f.e)));
    let offered_at = f.e.ledger().sequence();

    f.e.ledger()
        .with_mut(|l| l.sequence_number = offered_at + ADMIN_ACCEPT_LEDGERS + 1);

    assert_eq!(
        f.vault.try_accept_admin_transfer(),
        Err(Ok(RoleTransferError::NoPendingTransfer.into()))
    );
    assert_eq!(f.vault.governance(), Some(f.admin.clone()));
}

#[test]
fn a_change_shorter_than_a_raised_notice_never_lands() {
    let f = setup();
    let next = Address::generate(&f.e);
    let custodian = f
        .vault
        .propose_change(&VaultChange::Custodian(next), &f.admin);
    let delay = f
        .vault
        .propose_change(&VaultChange::UpgradeDelay(30 * DAY_DURATION), &f.admin);
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&delay, &f.admin);

    // The notice rises past the seven days the custodian change was given.
    f.vault.set_notice(&(20 * DAY_DURATION), &f.admin);
    f.advance(30 * DAY_DURATION);

    refused(
        f.vault.try_apply_change(&custodian, &f.admin),
        VaultError::UpgradeDelayBelowNotice,
    );
    assert_eq!(f.vault.custodian(), Some(f.custodian.clone()));
}

#[test]
fn the_deposit_cap_stays_instant_both_ways() {
    let f = setup();

    f.vault.set_deposit_cap(&Some(1_000), &f.admin);
    assert_eq!(f.vault.deposit_cap(), Some(1_000));
    f.vault.set_deposit_cap(&Some(500), &f.admin);
    assert_eq!(f.vault.deposit_cap(), Some(500));
    f.vault.set_deposit_cap(&None, &f.admin);
    assert_eq!(f.vault.deposit_cap(), None);
}

#[test]
fn a_pending_role_change_lands_after_a_pause() {
    let f = setup();
    let next = Address::generate(&f.e);
    let id = f.vault.propose_change(
        &VaultChange::GrantRole(symbol_short!("guardian"), next.clone()),
        &f.admin,
    );
    f.vault.pause(&f.guardian);
    f.advance(MIN_UPGRADE_DELAY);

    assert!(f.vault.try_apply_change(&id, &f.admin).is_err());

    f.vault.unpause(&f.admin);
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id, &f.admin);
    assert!(f
        .vault
        .has_role(&next, &symbol_short!("guardian"))
        .is_some());
}

#[test]
fn nothing_timelocked_moves_during_a_wind_down_a_manager_revoke_included() {
    let f = setup();
    let revoke = f.vault.propose_change(
        &VaultChange::RevokeRole(symbol_short!("manager"), f.manager.clone()),
        &f.admin,
    );
    f.vault.propose_wind_down(&f.admin);
    f.advance(MIN_WIND_DOWN_DELAY);
    f.vault.activate_wind_down();

    refused(
        f.vault.try_apply_change(&revoke, &f.admin),
        VaultError::WindDownActive,
    );
    refused(
        f.vault.try_propose_change(
            &VaultChange::RevokeRole(symbol_short!("manager"), f.manager.clone()),
            &f.admin,
        ),
        VaultError::WindDownActive,
    );
    refused(
        f.vault
            .try_revoke_role(&f.manager, &symbol_short!("manager"), &f.admin),
        VaultError::UseTimelock,
    );
    assert_eq!(f.vault.manager(), Some(f.manager.clone()));

    // Taking an operational role away moves no value, so it stays instant.
    f.vault
        .revoke_role(&f.treasury, &symbol_short!("treasury"), &f.admin);
    assert_eq!(f.vault.treasury(), None);
}
