use soroban_sdk::{testutils::Events as _, Event as _, IntoVal};
use stellar_access::access_control::AccessControlError;

use super::*;
use crate::{
    ChangeApplied, MinEpochDurationSet, MIN_EPOCH_DURATION_CEILING, MIN_EPOCH_DURATION_FLOOR,
};

/// Proposes a change and applies it once the delay has run.
fn land(f: &Fixture, change: VaultChange) {
    let id = f.vault.propose_change(&change);
    f.advance(f.vault.upgrade_delay());
    f.vault.apply_change(&id);
}

/// What a vault upgraded in place from a release that kept no epoch start holds.
fn forget_the_epoch_start(f: &Fixture) {
    f.e.as_contract(&f.vault.address, || {
        f.e.storage()
            .instance()
            .remove(&crate::keys::DataKey::EpochOpenedAt)
    });
}

#[test]
fn the_first_epoch_starts_when_setup_finishes() {
    let f = setup_unfinished();
    assert_eq!(f.vault.epoch_opened_at(), None);

    f.advance(DAY_DURATION);
    f.vault.finish_setup();

    assert_eq!(f.vault.epoch_opened_at(), Some(f.e.ledger().timestamp()));
}

#[test]
fn a_seal_starts_the_next_epoch() {
    let f = setup();
    f.advance(3_600);
    let sealed_at = f.e.ledger().timestamp();

    let sealed = f.close_epoch();

    assert_eq!(f.vault.get_epoch(&sealed).unwrap().closed_at, sealed_at);
    assert_eq!(f.vault.epoch_opened_at(), Some(sealed_at));
}

#[test]
fn no_minimum_is_set_until_governance_sets_one() {
    let f = setup();
    assert_eq!(f.vault.min_epoch_duration(), None);
}

#[test]
fn the_minimum_is_instant_during_setup() {
    let f = setup_unfinished();
    f.vault.set_min_epoch_duration(&DAY_DURATION);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [MinEpochDurationSet { secs: DAY_DURATION }.to_xdr(&f.e, &f.vault.address)]
    );
    assert_eq!(f.vault.min_epoch_duration(), Some(DAY_DURATION));
}

#[test]
fn the_minimum_stays_between_one_and_thirty_days() {
    assert_eq!(MIN_EPOCH_DURATION_FLOOR, DAY_DURATION);
    assert_eq!(MIN_EPOCH_DURATION_CEILING, 30 * DAY_DURATION);
    let f = setup_unfinished();
    refused(
        f.vault
            .try_set_min_epoch_duration(&(MIN_EPOCH_DURATION_FLOOR - 1)),
        VaultError::InvalidAmount,
    );
    refused(
        f.vault
            .try_set_min_epoch_duration(&(MIN_EPOCH_DURATION_CEILING + 1)),
        VaultError::InvalidAmount,
    );
    f.vault.set_min_epoch_duration(&MIN_EPOCH_DURATION_FLOOR);
    f.vault.set_min_epoch_duration(&MIN_EPOCH_DURATION_CEILING);
    assert_eq!(
        f.vault.min_epoch_duration(),
        Some(MIN_EPOCH_DURATION_CEILING)
    );
}

#[test]
fn setting_the_minimum_needs_the_admin() {
    let f = setup_unfinished();
    f.e.set_auths(&[]);
    assert!(f.vault.try_set_min_epoch_duration(&DAY_DURATION).is_err());
    assert_eq!(f.vault.min_epoch_duration(), None);
}

#[test]
fn after_setup_the_minimum_changes_only_through_the_timelock() {
    let f = setup();
    refused(
        f.vault.try_set_min_epoch_duration(&DAY_DURATION),
        VaultError::UseTimelock,
    );
    let change = VaultChange::MinEpochDuration(2 * DAY_DURATION);
    let id = f.vault.propose_change(&change);
    refused(f.vault.try_apply_change(&id), VaultError::ChangeNotReady);
    f.advance(f.vault.upgrade_delay());
    f.vault.apply_change(&id);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [
            MinEpochDurationSet {
                secs: 2 * DAY_DURATION
            }
            .to_xdr(&f.e, &f.vault.address),
            ChangeApplied { id, change }.to_xdr(&f.e, &f.vault.address),
        ]
    );
    assert_eq!(f.vault.min_epoch_duration(), Some(2 * DAY_DURATION));
}

#[test]
fn a_minimum_out_of_bounds_is_refused_when_proposed() {
    let f = setup();
    refused(
        f.vault
            .try_propose_change(&VaultChange::MinEpochDuration(0)),
        VaultError::InvalidAmount,
    );
    refused(
        f.vault.try_propose_change(&VaultChange::MinEpochDuration(
            MIN_EPOCH_DURATION_CEILING + 1,
        )),
        VaultError::InvalidAmount,
    );
}

#[test]
fn an_upgraded_vault_counts_its_open_epoch_from_the_minimum_landing() {
    let f = setup();
    forget_the_epoch_start(&f);
    assert_eq!(f.vault.epoch_opened_at(), None);
    land(&f, VaultChange::MinEpochDuration(DAY_DURATION));
    assert_eq!(f.vault.epoch_opened_at(), Some(f.e.ledger().timestamp()));
}

#[test]
fn a_minimum_landing_keeps_a_recorded_start() {
    let f = setup();
    let started = f.vault.epoch_opened_at();
    land(&f, VaultChange::MinEpochDuration(DAY_DURATION));
    assert_eq!(f.vault.epoch_opened_at(), started);
}

/// A finished vault whose minimum was set during setup; its first epoch starts at `finish_setup`.
fn with_minimum<'a>(secs: u64) -> Fixture<'a> {
    let f = setup_unfinished();
    f.vault.set_min_epoch_duration(&secs);
    f.vault.finish_setup();
    f
}

fn advance_to(f: &Fixture, at: u64) {
    f.advance(at - f.e.ledger().timestamp());
}

fn opened_at(f: &Fixture) -> u64 {
    f.vault.epoch_opened_at().unwrap()
}

#[test]
fn an_outsider_cannot_seal_before_the_minimum() {
    let f = with_minimum(DAY_DURATION);
    let outsider = Address::generate(&f.e);
    let open = f.vault.current_epoch();
    advance_to(&f, opened_at(&f) + DAY_DURATION - 1);

    refused(
        f.vault.try_close_epoch(&outsider),
        VaultError::MinEpochDurationNotElapsed,
    );
    assert_eq!(f.vault.current_epoch(), open);
}

#[test]
fn an_outsider_seals_once_the_minimum_has_run() {
    let f = with_minimum(DAY_DURATION);
    let outsider = Address::generate(&f.e);
    let open = f.vault.current_epoch();
    advance_to(&f, opened_at(&f) + DAY_DURATION);

    assert_eq!(f.vault.close_epoch(&outsider), open);
    f.signed_once_by(&outsider, "close_epoch", (outsider.clone(),).into_val(&f.e));
    assert_eq!(f.vault.current_epoch(), open + 1);
    assert_eq!(
        f.vault.get_epoch(&open).unwrap().status,
        EpochStatus::Pending
    );
    assert_eq!(f.vault.epoch_opened_at(), Some(f.e.ledger().timestamp()));
}

#[test]
fn the_manager_seals_before_the_minimum() {
    let f = with_minimum(MIN_EPOCH_DURATION_CEILING);
    let open = f.vault.current_epoch();

    assert_eq!(f.close_epoch(), open);
}

#[test]
fn without_a_minimum_only_the_manager_seals() {
    let f = setup();
    let outsider = Address::generate(&f.e);
    let open = f.vault.current_epoch();
    f.advance(2 * DAY_DURATION);

    assert_eq!(
        f.vault.try_close_epoch(&outsider),
        Err(Ok(AccessControlError::Unauthorized.into()))
    );
    assert_eq!(f.close_epoch(), open);
}

#[test]
fn an_outsider_seal_waits_the_notice_like_any_other() {
    let f = with_minimum(DAY_DURATION);
    f.vault.set_notice(&DAY_DURATION);
    let outsider = Address::generate(&f.e);
    advance_to(&f, opened_at(&f) + DAY_DURATION);
    let sealed = f.vault.close_epoch(&outsider);

    refused(
        f.vault.try_fulfill_epoch(&sealed),
        VaultError::NoticeNotElapsed,
    );
    f.advance(DAY_DURATION);
    f.fulfill_epoch_at(sealed, wad(2));
    assert_eq!(
        f.vault.get_epoch(&sealed).unwrap().status,
        EpochStatus::Fulfilled
    );
}

#[test]
fn a_wind_down_refuses_an_outsider_seal() {
    let f = with_minimum(DAY_DURATION);
    let outsider = Address::generate(&f.e);
    super::wind_down::wind_down_now(&f);

    refused(
        f.vault.try_close_epoch(&outsider),
        VaultError::WindDownActive,
    );
}

#[test]
fn a_pause_does_not_stop_an_outsider_seal() {
    let f = with_minimum(DAY_DURATION);
    let outsider = Address::generate(&f.e);
    let open = f.vault.current_epoch();
    f.vault.pause(&f.guardian);
    f.advance(DAY_DURATION);

    assert!(f.vault.paused());
    assert_eq!(f.vault.close_epoch(&outsider), open);
}

#[test]
fn each_seal_restarts_the_minimum() {
    let f = with_minimum(2 * DAY_DURATION);
    let outsider = Address::generate(&f.e);
    f.advance(DAY_DURATION);
    f.close_epoch();
    let started = f.e.ledger().timestamp();
    let open = f.vault.current_epoch();

    assert_eq!(f.vault.epoch_opened_at(), Some(started));
    advance_to(&f, started + 2 * DAY_DURATION - 1);
    refused(
        f.vault.try_close_epoch(&outsider),
        VaultError::MinEpochDurationNotElapsed,
    );
    f.advance(1);
    assert_eq!(f.vault.close_epoch(&outsider), open);
}

#[test]
fn a_raised_minimum_counts_from_the_epochs_start() {
    let f = with_minimum(DAY_DURATION);
    let outsider = Address::generate(&f.e);
    let open = f.vault.current_epoch();
    let start = opened_at(&f);
    land(&f, VaultChange::MinEpochDuration(10 * DAY_DURATION));

    refused(
        f.vault.try_close_epoch(&outsider),
        VaultError::MinEpochDurationNotElapsed,
    );
    advance_to(&f, start + 10 * DAY_DURATION);
    assert_eq!(f.vault.close_epoch(&outsider), open);
}

#[test]
fn with_no_manager_anyone_still_seals_after_the_minimum() {
    let f = with_minimum(DAY_DURATION);
    let outsider = Address::generate(&f.e);
    let open = f.vault.current_epoch();
    land(
        &f,
        VaultChange::RevokeRole(symbol_short!("manager"), f.manager.clone()),
    );

    assert_eq!(f.vault.manager(), None);
    assert_eq!(f.vault.close_epoch(&outsider), open);
}

#[test]
fn an_outsider_cannot_seal_during_setup() {
    let f = setup_unfinished();
    let outsider = Address::generate(&f.e);
    f.vault.set_min_epoch_duration(&DAY_DURATION);
    f.advance(2 * DAY_DURATION);

    refused(
        f.vault.try_close_epoch(&outsider),
        VaultError::MinEpochDurationNotElapsed,
    );
}

#[test]
fn an_outsider_seal_needs_the_outsiders_signature() {
    let f = with_minimum(DAY_DURATION);
    let outsider = Address::generate(&f.e);
    let open = f.vault.current_epoch();
    advance_to(&f, opened_at(&f) + DAY_DURATION);
    f.e.set_auths(&[]);

    assert!(f.vault.try_close_epoch(&outsider).is_err());
    assert_eq!(f.vault.current_epoch(), open);
}

#[test]
fn an_upgraded_vault_lets_anyone_seal_a_minimum_after_it_lands() {
    let f = setup();
    let outsider = Address::generate(&f.e);
    let open = f.vault.current_epoch();
    forget_the_epoch_start(&f);
    f.advance(2 * DAY_DURATION);

    assert_eq!(
        f.vault.try_close_epoch(&outsider),
        Err(Ok(AccessControlError::Unauthorized.into()))
    );
    land(&f, VaultChange::MinEpochDuration(DAY_DURATION));
    let landed = f.e.ledger().timestamp();
    advance_to(&f, landed + DAY_DURATION - 1);
    refused(
        f.vault.try_close_epoch(&outsider),
        VaultError::MinEpochDurationNotElapsed,
    );
    advance_to(&f, landed + DAY_DURATION);
    assert_eq!(f.vault.close_epoch(&outsider), open);
}

#[test]
fn lowering_the_minimum_also_waits_the_timelock() {
    let f = with_minimum(10 * DAY_DURATION);
    refused(
        f.vault.try_set_min_epoch_duration(&DAY_DURATION),
        VaultError::UseTimelock,
    );
    land(&f, VaultChange::MinEpochDuration(DAY_DURATION));
    assert_eq!(f.vault.min_epoch_duration(), Some(DAY_DURATION));
}
