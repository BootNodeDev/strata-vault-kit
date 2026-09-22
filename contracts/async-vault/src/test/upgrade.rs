use super::*;

const DAY: u64 = 24 * 60 * 60;

#[test]
fn the_delay_defaults_to_the_minimum() {
    let f = setup();

    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);
}

#[test]
fn a_proposal_records_an_eta_one_delay_out() {
    let f = setup();
    let hash = BytesN::from_array(&f.e, &[7u8; 32]);

    f.vault.propose_upgrade(&hash, &f.admin);

    let p = f.vault.upgrade_proposal().unwrap();
    assert_eq!(p.action, UpgradeAction::Wasm(hash));
    assert_eq!(p.eta, f.e.ledger().timestamp() + MIN_UPGRADE_DELAY);
}

#[test]
fn a_second_proposal_while_one_stands_is_refused() {
    let f = setup();
    let hash = BytesN::from_array(&f.e, &[7u8; 32]);
    let other = BytesN::from_array(&f.e, &[9u8; 32]);
    f.vault.propose_upgrade(&hash, &f.admin);

    refused(
        f.vault.try_propose_upgrade(&other, &f.admin),
        VaultError::UpgradeProposalExists,
    );
    refused(
        f.vault.try_propose_upgrade_delay(&(30 * DAY), &f.admin),
        VaultError::UpgradeProposalExists,
    );
}

#[test]
fn a_cancelled_proposal_leaves_the_slot_free() {
    let f = setup();
    let hash = BytesN::from_array(&f.e, &[7u8; 32]);
    f.vault.propose_upgrade(&hash, &f.admin);

    f.vault.cancel_upgrade(&f.admin);
    assert_eq!(f.vault.upgrade_proposal(), None);

    f.vault.propose_upgrade(&hash, &f.admin);
    assert!(f.vault.upgrade_proposal().is_some());
}

#[test]
fn cancelling_nothing_is_refused() {
    let f = setup();

    refused(
        f.vault.try_cancel_upgrade(&f.admin),
        VaultError::UpgradeProposalNotFound,
    );
}

#[test]
fn a_delay_below_the_minimum_is_refused() {
    let f = setup();

    refused(
        f.vault
            .try_propose_upgrade_delay(&(MIN_UPGRADE_DELAY - 1), &f.admin),
        VaultError::UpgradeDelayTooShort,
    );
    assert_eq!(f.vault.upgrade_proposal(), None);
}

#[test]
fn a_delay_above_the_maximum_is_refused() {
    let f = setup();

    refused(
        f.vault
            .try_propose_upgrade_delay(&(MAX_UPGRADE_DELAY + 1), &f.admin),
        VaultError::UpgradeDelayTooLong,
    );
    assert_eq!(f.vault.upgrade_proposal(), None);
}

#[test]
fn a_delay_below_the_standing_notice_is_refused() {
    let f = setup();
    f.vault.propose_upgrade_delay(&(30 * DAY), &f.admin);
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_upgrade(&f.admin);

    f.vault.set_notice(&(20 * DAY), &f.admin);

    // Above the minimum, below the notice: an exit could not complete.
    refused(
        f.vault.try_propose_upgrade_delay(&(10 * DAY), &f.admin),
        VaultError::UpgradeDelayBelowNotice,
    );

    f.vault.propose_upgrade_delay(&(21 * DAY), &f.admin);
    assert!(f.vault.upgrade_proposal().is_some());
}

#[test]
fn only_governance_proposes_and_cancels() {
    let f = setup();
    let hash = BytesN::from_array(&f.e, &[7u8; 32]);
    let stranger = Address::generate(&f.e);

    f.e.set_auths(&[]);
    assert!(f.vault.try_propose_upgrade(&hash, &stranger).is_err());
    assert!(f.vault.try_propose_upgrade(&hash, &f.manager).is_err());
    assert!(f.vault.try_propose_upgrade(&hash, &f.guardian).is_err());
    assert!(f
        .vault
        .try_propose_upgrade_delay(&(30 * DAY), &f.treasury)
        .is_err());

    f.e.mock_all_auths();
    f.vault.propose_upgrade(&hash, &f.admin);
    f.e.set_auths(&[]);
    assert!(f.vault.try_cancel_upgrade(&stranger).is_err());
    assert!(f.vault.try_cancel_upgrade(&f.guardian).is_err());
}

#[test]
fn the_schema_version_is_one_after_construction() {
    let f = setup();

    assert_eq!(f.vault.schema_version(), 1);
}

#[test]
fn applying_before_the_eta_is_refused() {
    let f = setup();
    f.vault.propose_upgrade_delay(&(30 * DAY), &f.admin);

    refused(
        f.vault.try_apply_upgrade(&f.admin),
        VaultError::UpgradeDelayNotElapsed,
    );

    f.advance(MIN_UPGRADE_DELAY - 1);
    refused(
        f.vault.try_apply_upgrade(&f.admin),
        VaultError::UpgradeDelayNotElapsed,
    );

    f.advance(1);
    f.vault.apply_upgrade(&f.admin);
    assert_eq!(f.vault.upgrade_delay(), 30 * DAY);
    assert_eq!(f.vault.upgrade_proposal(), None);
}

#[test]
fn changing_the_delay_serves_the_old_delay_first() {
    let f = setup();

    f.vault.propose_upgrade_delay(&(30 * DAY), &f.admin);
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_upgrade(&f.admin);

    // The next proposal uses the new, longer delay.
    let hash = BytesN::from_array(&f.e, &[7u8; 32]);
    f.vault.propose_upgrade(&hash, &f.admin);
    assert_eq!(
        f.vault.upgrade_proposal().unwrap().eta,
        f.e.ledger().timestamp() + 30 * DAY
    );
}

#[test]
fn shortening_the_delay_cannot_be_rushed() {
    let f = setup();
    f.vault.propose_upgrade_delay(&(30 * DAY), &f.admin);
    f.advance(MIN_UPGRADE_DELAY);
    f.vault.apply_upgrade(&f.admin);

    // Back down to the minimum: still costs the full thirty days.
    f.vault.propose_upgrade_delay(&MIN_UPGRADE_DELAY, &f.admin);
    f.advance(30 * DAY - 1);
    refused(
        f.vault.try_apply_upgrade(&f.admin),
        VaultError::UpgradeDelayNotElapsed,
    );

    f.advance(1);
    f.vault.apply_upgrade(&f.admin);
    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);
}

#[test]
fn the_notice_cannot_outgrow_the_delay() {
    let f = setup();
    f.vault.propose_upgrade_delay(&(10 * DAY), &f.admin);

    refused(
        f.vault.try_set_notice(&(20 * DAY), &f.admin),
        VaultError::NoticeAboveUpgradeDelay,
    );
    assert_eq!(f.vault.notice(), 0);
}

#[test]
fn applying_nothing_is_refused() {
    let f = setup();

    refused(
        f.vault.try_apply_upgrade(&f.admin),
        VaultError::UpgradeProposalNotFound,
    );
}

#[test]
fn a_pause_freezes_the_upgrade_timelock_clock() {
    let f = setup();

    f.vault.propose_upgrade_delay(&(14 * DAY), &f.admin);
    let original_eta = f.vault.upgrade_proposal().unwrap().eta;

    // Advance 3 days
    f.advance(3 * DAY);

    // Pause the vault for 10 days
    f.vault.pause(&f.guardian);
    f.advance(10 * DAY);

    // While paused, applying is refused
    assert!(f.vault.try_apply_upgrade(&f.admin).is_err());

    // Unpause: proposal ETA is pushed by the 10-day paused duration
    f.vault.unpause(&f.admin);
    let updated_p = f.vault.upgrade_proposal().unwrap();
    assert_eq!(updated_p.eta, original_eta + 10 * DAY);

    // 3 days later (total 6 unpaused days out of 7), applying still refused
    f.advance(3 * DAY);
    refused(
        f.vault.try_apply_upgrade(&f.admin),
        VaultError::UpgradeDelayNotElapsed,
    );

    // 1 more day (7 unpaused days total): applying succeeds
    f.advance(DAY);
    f.vault.apply_upgrade(&f.admin);
    assert_eq!(f.vault.upgrade_proposal(), None);
    assert_eq!(f.vault.upgrade_delay(), 14 * DAY);
}

#[test]
fn only_governance_applies() {
    let f = setup();
    let stranger = Address::generate(&f.e);
    f.vault.propose_upgrade_delay(&(30 * DAY), &f.admin);
    f.advance(MIN_UPGRADE_DELAY);

    f.e.set_auths(&[]);
    assert!(f.vault.try_apply_upgrade(&stranger).is_err());
    assert!(f.vault.try_apply_upgrade(&f.manager).is_err());
    assert!(f.vault.try_apply_upgrade(&f.guardian).is_err());
    assert!(f.vault.upgrade_proposal().is_some());
}

#[test]
fn the_vault_exposes_no_immediate_upgrade() {
    let f = setup();
    let hash = BytesN::from_array(&f.e, &[7u8; 32]);

    // If the Upgradeable trait were implemented, this client would work
    // against the vault and replace the code with no delay at all.
    let client =
        stellar_contract_utils::upgradeable::UpgradeableClient::new(&f.e, &f.vault.address);
    assert!(client.try_upgrade(&hash, &f.admin).is_err());
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
    fn applying_a_wasm_proposal_replaces_the_code() {
        let f = setup();
        let hash = f.e.deployer().upload_contract_wasm(WASM);

        assert_eq!(f.vault.schema_version(), 1);

        f.vault.propose_upgrade(&hash, &f.admin);
        f.advance(MIN_UPGRADE_DELAY);
        f.vault.apply_upgrade(&f.admin);

        let target = Client::new(&f.e, &f.vault.address);
        assert_eq!(target.schema_version(), 1);

        target.migrate(&f.admin);
        assert_eq!(target.schema_version(), 2);
    }

    #[test]
    fn a_migration_refuses_a_second_run() {
        let f = setup();
        let hash = f.e.deployer().upload_contract_wasm(WASM);
        f.vault.propose_upgrade(&hash, &f.admin);
        f.advance(MIN_UPGRADE_DELAY);
        f.vault.apply_upgrade(&f.admin);

        let target = Client::new(&f.e, &f.vault.address);
        target.migrate(&f.admin);

        assert!(target.try_migrate(&f.admin).is_err());
        assert_eq!(target.schema_version(), 2);
    }
}
