use super::*;

#[test]
fn test_successful_deployment() {
    let f = setup();

    assert_eq!(f.vault.asset(), f.asset);
    assert_eq!(f.vault.share_token(), f.share.address);
    assert_eq!(f.vault.manager(), f.manager);
    assert!(!f.vault.paused());

    let first = f.vault.get_epoch(&1).unwrap();
    assert_eq!(first.status, EpochStatus::Open);
    assert_eq!(first.total_deposited, 0);
    assert_eq!(first.share_price, 0);
}

#[test]
fn epoch_zero_is_the_absent_id() {
    let f = setup();
    assert_eq!(f.vault.get_epoch(&0), None);
}

#[test]
fn unwritten_epoch_reads_as_none() {
    let f = setup();
    assert_eq!(f.vault.get_epoch(&2), None);
}

#[test]
fn the_vault_holds_the_manager_role_on_the_share_token() {
    let f = setup();
    assert!(f
        .share
        .has_role(&f.vault.address, &symbol_short!("manager"))
        .is_some());
}
