use soroban_sdk::{testutils::Events as _, Event as _};
use stellar_contract_utils::pausable::PausableError;

use super::*;
use crate::{ChangeApplied, ChangeCancelled, ChangeProposed};

fn wasm(f: &Fixture, byte: u8) -> BytesN<32> {
    BytesN::from_array(&f.e, &[byte; 32])
}

fn propose(f: &Fixture, change: VaultChange) -> u32 {
    f.vault.propose_change(&change, &f.admin)
}

/// Raises the upgrade delay through the timelock, which costs one current delay.
fn raise_delay(f: &Fixture, secs: u64) {
    let id = propose(f, VaultChange::UpgradeDelay(secs));
    f.advance(f.vault.upgrade_delay());
    f.vault.apply_change(&id, &f.admin);
}

fn only_pending(f: &Fixture) -> VaultPendingChange {
    let pending = f.vault.pending_changes();
    assert_eq!(pending.len(), 1);
    pending.get(0).unwrap()
}

#[test]
fn the_delay_defaults_to_the_minimum() {
    let f = setup();

    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);
}

#[test]
fn a_proposal_records_an_eta_one_delay_out() {
    let f = setup();
    let hash = wasm(&f, 7);

    let id = propose(&f, VaultChange::Upgrade(hash.clone()));

    let p = only_pending(&f);
    assert_eq!(p.id, id);
    assert_eq!(p.change, VaultChange::Upgrade(hash));
    assert_eq!(p.eta, f.e.ledger().timestamp() + MIN_UPGRADE_DELAY);
}

#[test]
fn a_second_code_change_while_one_stands_is_refused() {
    let f = setup();
    propose(&f, VaultChange::Upgrade(wasm(&f, 7)));

    refused(
        f.vault
            .try_propose_change(&VaultChange::Upgrade(wasm(&f, 9)), &f.admin),
        VaultError::UpgradeProposalExists,
    );
    refused(
        f.vault
            .try_propose_change(&VaultChange::UpgradeDelay(30 * DAY_DURATION), &f.admin),
        VaultError::UpgradeProposalExists,
    );
}

#[test]
fn a_cancelled_proposal_leaves_the_slot_free() {
    let f = setup();
    let hash = wasm(&f, 7);
    let id = propose(&f, VaultChange::Upgrade(hash.clone()));

    f.vault.cancel_change(&id, &f.admin);
    assert_eq!(f.vault.pending_changes().len(), 0);

    propose(&f, VaultChange::Upgrade(hash));
    assert_eq!(f.vault.pending_changes().len(), 1);
}

#[test]
fn cancelling_nothing_is_refused() {
    let f = setup();

    refused(
        f.vault.try_cancel_change(&1, &f.admin),
        VaultError::ChangeNotFound,
    );
}

#[test]
fn a_delay_below_the_minimum_is_refused() {
    let f = setup();

    refused(
        f.vault
            .try_propose_change(&VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY - 1), &f.admin),
        VaultError::UpgradeDelayTooShort,
    );
    assert_eq!(f.vault.pending_changes().len(), 0);
}

#[test]
fn a_delay_above_the_maximum_is_refused() {
    let f = setup();

    refused(
        f.vault
            .try_propose_change(&VaultChange::UpgradeDelay(MAX_UPGRADE_DELAY + 1), &f.admin),
        VaultError::UpgradeDelayTooLong,
    );
    assert_eq!(f.vault.pending_changes().len(), 0);
}

#[test]
fn a_delay_below_the_standing_notice_is_refused() {
    let f = setup();
    raise_delay(&f, 30 * DAY_DURATION);

    f.vault.set_notice(&(20 * DAY_DURATION), &f.admin);

    // Above the minimum, below the notice: an exit could not complete.
    refused(
        f.vault
            .try_propose_change(&VaultChange::UpgradeDelay(10 * DAY_DURATION), &f.admin),
        VaultError::UpgradeDelayBelowNotice,
    );

    propose(&f, VaultChange::UpgradeDelay(21 * DAY_DURATION));
    assert_eq!(f.vault.pending_changes().len(), 1);
}

#[test]
fn only_governance_proposes_and_cancels() {
    let f = setup();
    let change = VaultChange::Upgrade(wasm(&f, 7));
    let stranger = Address::generate(&f.e);

    f.e.set_auths(&[]);
    assert!(f.vault.try_propose_change(&change, &stranger).is_err());
    assert!(f.vault.try_propose_change(&change, &f.manager).is_err());
    assert!(f.vault.try_propose_change(&change, &f.guardian).is_err());
    assert!(f
        .vault
        .try_propose_change(&VaultChange::UpgradeDelay(30 * DAY_DURATION), &f.treasury)
        .is_err());

    f.e.mock_all_auths();
    let id = propose(&f, change);
    f.e.set_auths(&[]);
    assert!(f.vault.try_cancel_change(&id, &stranger).is_err());
    assert!(f.vault.try_cancel_change(&id, &f.guardian).is_err());
}

#[test]
fn the_schema_version_is_one_after_construction() {
    let f = setup();

    assert_eq!(f.vault.schema_version(), 1);
}

#[test]
fn applying_before_the_eta_is_refused() {
    let f = setup();
    let id = propose(&f, VaultChange::UpgradeDelay(30 * DAY_DURATION));

    refused(
        f.vault.try_apply_change(&id, &f.admin),
        VaultError::ChangeNotReady,
    );

    f.advance(MIN_UPGRADE_DELAY - 1);
    refused(
        f.vault.try_apply_change(&id, &f.admin),
        VaultError::ChangeNotReady,
    );

    f.advance(1);
    f.vault.apply_change(&id, &f.admin);
    assert_eq!(f.vault.upgrade_delay(), 30 * DAY_DURATION);
    assert_eq!(f.vault.pending_changes().len(), 0);
}

#[test]
fn changing_the_delay_serves_the_old_delay_first() {
    let f = setup();
    raise_delay(&f, 30 * DAY_DURATION);

    // The next proposal uses the new, longer delay.
    propose(&f, VaultChange::Upgrade(wasm(&f, 7)));
    assert_eq!(
        only_pending(&f).eta,
        f.e.ledger().timestamp() + 30 * DAY_DURATION
    );
}

#[test]
fn shortening_the_delay_cannot_be_rushed() {
    let f = setup();
    raise_delay(&f, 30 * DAY_DURATION);

    // Back down to the minimum: still costs the full thirty days.
    let id = propose(&f, VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY));
    f.advance(30 * DAY_DURATION - 1);
    refused(
        f.vault.try_apply_change(&id, &f.admin),
        VaultError::ChangeNotReady,
    );

    f.advance(1);
    f.vault.apply_change(&id, &f.admin);
    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);
}

#[test]
fn the_notice_cannot_outgrow_the_delay() {
    let f = setup();
    propose(&f, VaultChange::UpgradeDelay(10 * DAY_DURATION));

    refused(
        f.vault.try_set_notice(&(20 * DAY_DURATION), &f.admin),
        VaultError::NoticeAboveUpgradeDelay,
    );
    assert_eq!(f.vault.notice(), 0);
}

#[test]
fn applying_nothing_is_refused() {
    let f = setup();

    refused(
        f.vault.try_apply_change(&1, &f.admin),
        VaultError::ChangeNotFound,
    );
}

#[test]
fn a_pause_freezes_the_upgrade_timelock_clock() {
    let f = setup();
    let id = propose(&f, VaultChange::UpgradeDelay(14 * DAY_DURATION));
    let original_eta = only_pending(&f).eta;

    f.advance(3 * DAY_DURATION);
    f.vault.pause(&f.guardian);
    f.advance(10 * DAY_DURATION);

    assert!(f.vault.try_apply_change(&id, &f.admin).is_err());

    // Unpause: the eta has moved by the ten days spent paused.
    f.vault.unpause(&f.admin);
    assert_eq!(only_pending(&f).eta, original_eta + 10 * DAY_DURATION);

    // Six unpaused days out of seven: still refused.
    f.advance(3 * DAY_DURATION);
    refused(
        f.vault.try_apply_change(&id, &f.admin),
        VaultError::ChangeNotReady,
    );

    f.advance(DAY_DURATION);
    f.vault.apply_change(&id, &f.admin);
    assert_eq!(f.vault.pending_changes().len(), 0);
    assert_eq!(f.vault.upgrade_delay(), 14 * DAY_DURATION);
}

#[test]
fn applying_while_paused_is_refused() {
    let f = setup();
    let id = propose(&f, VaultChange::UpgradeDelay(30 * DAY_DURATION));
    f.advance(MIN_UPGRADE_DELAY);

    // At the eta, with no paused time yet, only the pause stands in the way.
    f.vault.pause(&f.guardian);
    assert_eq!(
        f.vault.try_apply_change(&id, &f.admin),
        Err(Ok(PausableError::EnforcedPause.into()))
    );
    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);

    f.vault.unpause(&f.admin);
    f.vault.apply_change(&id, &f.admin);
    assert_eq!(f.vault.upgrade_delay(), 30 * DAY_DURATION);
}

#[test]
fn only_governance_applies() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    let id = propose(&f, VaultChange::UpgradeDelay(30 * DAY_DURATION));
    f.advance(MIN_UPGRADE_DELAY);

    f.e.set_auths(&[]);
    assert!(f.vault.try_apply_change(&id, &stranger).is_err());
    assert!(f.vault.try_apply_change(&id, &f.manager).is_err());
    assert!(f.vault.try_apply_change(&id, &f.guardian).is_err());
    assert_eq!(f.vault.pending_changes().len(), 1);
}

#[test]
fn the_vault_exposes_no_immediate_upgrade() {
    let f = setup();
    let hash = wasm(&f, 7);

    // If the Upgradeable trait were implemented, this client would work
    // against the vault and replace the code with no delay at all.
    let client =
        stellar_contract_utils::upgradeable::UpgradeableClient::new(&f.e, &f.vault.address);
    assert!(client.try_upgrade(&hash, &f.admin).is_err());
}

#[test]
fn nothing_is_proposed_during_a_wind_down() {
    let f = setup();
    f.vault.propose_wind_down(&f.admin);
    f.vault.activate_wind_down();

    refused(
        f.vault
            .try_propose_change(&VaultChange::Upgrade(wasm(&f, 7)), &f.admin),
        VaultError::WindDownActive,
    );
}

#[test]
fn a_change_standing_when_the_wind_down_starts_never_applies() {
    let f = setup();
    let id = propose(&f, VaultChange::Upgrade(wasm(&f, 7)));
    f.vault.propose_wind_down(&f.admin);
    f.vault.activate_wind_down();
    f.advance(MAX_UPGRADE_DELAY);

    refused(
        f.vault.try_apply_change(&id, &f.admin),
        VaultError::WindDownActive,
    );
    f.vault.cancel_change(&id, &f.admin);
    assert_eq!(f.vault.pending_changes().len(), 0);
}

#[test]
fn applying_a_delay_change_checks_the_notice_again() {
    let f = setup();
    raise_delay(&f, 30 * DAY_DURATION);
    let id = propose(&f, VaultChange::UpgradeDelay(MIN_UPGRADE_DELAY));

    // The notice rises while the shorter delay waits.
    f.vault.set_notice(&(20 * DAY_DURATION), &f.admin);
    f.advance(30 * DAY_DURATION);

    refused(
        f.vault.try_apply_change(&id, &f.admin),
        VaultError::UpgradeDelayBelowNotice,
    );
    assert_eq!(f.vault.upgrade_delay(), 30 * DAY_DURATION);
}

#[test]
fn proposing_and_applying_publish_the_change() {
    let f = setup();
    let change = VaultChange::UpgradeDelay(30 * DAY_DURATION);
    let eta = f.e.ledger().timestamp() + MIN_UPGRADE_DELAY;

    let id = propose(&f, change.clone());
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [ChangeProposed {
            id,
            change: change.clone(),
            eta,
        }
        .to_xdr(&f.e, &f.vault.address)]
    );

    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_change(&id, &f.admin);
    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [ChangeApplied { id, change }.to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn cancelling_publishes_the_change_id() {
    let f = setup();
    let id = propose(&f, VaultChange::Upgrade(wasm(&f, 7)));

    f.vault.cancel_change(&id, &f.admin);

    assert_eq!(
        f.e.events().all().filter_by_contract(&f.vault.address),
        [ChangeCancelled { id }.to_xdr(&f.e, &f.vault.address)]
    );
}

#[test]
fn the_vault_reports_its_clock_to_the_token_and_the_oracle() {
    let f = setup();
    f.vault.pause(&f.guardian);
    f.advance(DAY_DURATION);

    let clock = timelock::ClockSourceClient::new(&f.e, &f.vault.address).timelock_clock();

    assert_eq!(
        clock,
        timelock::Clock {
            delay: MIN_UPGRADE_DELAY,
            exit_window: 0,
            paused_secs: DAY_DURATION,
            paused: true,
            winding_down: false,
        }
    );
}

#[cfg(feature = "upgrade_wasm")]
mod with_wasm {
    use super::*;

    soroban_sdk::contractimport!(
        file = "../../fixtures/upgrade-target/target/wasm32v1-none/release/upgrade_target.wasm"
    );

    #[test]
    fn immediate_upgrade_with_valid_wasm_does_not_replace_code() {
        let f = setup();
        let hash = f.e.deployer().upload_contract_wasm(WASM);

        let client =
            stellar_contract_utils::upgradeable::UpgradeableClient::new(&f.e, &f.vault.address);
        assert!(client.try_upgrade(&hash, &f.admin).is_err());
        assert_eq!(f.vault.schema_version(), 1);
        let target = Client::new(&f.e, &f.vault.address);
        assert!(target.try_migrate(&f.admin).is_err());
    }

    #[test]
    fn applying_a_wasm_change_replaces_the_code() {
        let f = setup();
        let hash = f.e.deployer().upload_contract_wasm(WASM);
        assert_eq!(f.vault.schema_version(), 1);

        let id = f
            .vault
            .propose_change(&VaultChange::Upgrade(hash), &f.admin);
        f.advance(MIN_UPGRADE_DELAY);
        f.vault.apply_change(&id, &f.admin);

        let target = Client::new(&f.e, &f.vault.address);
        assert_eq!(target.schema_version(), 1);

        target.migrate(&f.admin);
        assert_eq!(target.schema_version(), 2);
    }

    #[test]
    fn a_migration_refuses_a_second_run() {
        let f = setup();
        let hash = f.e.deployer().upload_contract_wasm(WASM);
        let id = f
            .vault
            .propose_change(&VaultChange::Upgrade(hash), &f.admin);
        f.advance(MIN_UPGRADE_DELAY);
        f.vault.apply_change(&id, &f.admin);

        let target = Client::new(&f.e, &f.vault.address);
        target.migrate(&f.admin);

        assert!(target.try_migrate(&f.admin).is_err());
        assert_eq!(target.schema_version(), 2);
    }
}
