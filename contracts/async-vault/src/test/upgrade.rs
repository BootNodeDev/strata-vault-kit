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

    assert!(f.vault.try_propose_upgrade(&other, &f.admin).is_err());
    assert!(f
        .vault
        .try_propose_upgrade_delay(&(30 * DAY), &f.admin)
        .is_err());
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

    assert!(f.vault.try_cancel_upgrade(&f.admin).is_err());
}

#[test]
fn a_delay_below_the_minimum_is_refused() {
    let f = setup();

    assert!(f
        .vault
        .try_propose_upgrade_delay(&(MIN_UPGRADE_DELAY - 1), &f.admin)
        .is_err());
    assert_eq!(f.vault.upgrade_proposal(), None);
}

#[test]
fn a_delay_below_the_standing_notice_is_refused() {
    let f = setup();
    f.vault.set_notice(&(20 * DAY), &f.admin);

    // Above the minimum, below the notice: an exit could not complete.
    assert!(f
        .vault
        .try_propose_upgrade_delay(&(10 * DAY), &f.admin)
        .is_err());

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

    assert!(f.vault.try_apply_upgrade(&f.admin).is_err());

    f.advance(MIN_UPGRADE_DELAY - 1);
    assert!(f.vault.try_apply_upgrade(&f.admin).is_err());

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
    assert!(f.vault.try_apply_upgrade(&f.admin).is_err());

    f.advance(1);
    f.vault.apply_upgrade(&f.admin);
    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);
}

#[test]
fn a_delay_that_the_notice_outgrew_is_refused_at_application() {
    let f = setup();
    f.vault.propose_upgrade_delay(&(10 * DAY), &f.admin);

    // The notice moves past the queued delay while the proposal stands.
    f.vault.set_notice(&(20 * DAY), &f.admin);
    f.advance(MIN_UPGRADE_DELAY);

    assert!(f.vault.try_apply_upgrade(&f.admin).is_err());
    assert_eq!(f.vault.upgrade_delay(), MIN_UPGRADE_DELAY);
}

#[test]
fn applying_nothing_is_refused() {
    let f = setup();

    assert!(f.vault.try_apply_upgrade(&f.admin).is_err());
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

    const TARGET: &[u8] =
        include_bytes!("../../../../target/wasm32v1-none/release/upgrade_target.wasm");

    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/upgrade_target.wasm");

    #[test]
    fn applying_a_wasm_proposal_replaces_the_code() {
        let f = setup();
        let hash = f.e.deployer().upload_contract_wasm(TARGET);

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
        let hash = f.e.deployer().upload_contract_wasm(TARGET);
        f.vault.propose_upgrade(&hash, &f.admin);
        f.advance(MIN_UPGRADE_DELAY);
        f.vault.apply_upgrade(&f.admin);

        let target = Client::new(&f.e, &f.vault.address);
        target.migrate(&f.admin);

        assert!(target.try_migrate(&f.admin).is_err());
        assert_eq!(target.schema_version(), 2);
    }
}
