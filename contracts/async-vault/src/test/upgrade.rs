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
