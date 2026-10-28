use soroban_sdk::{testutils::Events as _, Event as _};

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
