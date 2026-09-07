use super::*;

#[test]
fn test_manager_can_fulfill_epoch_and_rotate() {
    let f = setup();

    assert_eq!(f.fulfill_epoch(wad(2)), 2);

    let epoch_1 = f.vault.get_epoch(&1).unwrap();
    assert_eq!(epoch_1.status, EpochStatus::Fulfilled);
    assert_eq!(epoch_1.share_price, wad(2));

    let epoch_2 = f.vault.get_epoch(&2).unwrap();
    assert_eq!(epoch_2.status, EpochStatus::Open);
    assert_eq!(epoch_2.total_deposited, 0);
    assert_eq!(epoch_2.share_price, 0);

    assert_eq!(f.vault.current_epoch(), 2);
}

#[test]
#[should_panic(expected = "#2000")]
fn test_non_manager_cannot_fulfill() {
    let f = setup();
    let impostor = Address::generate(&f.e);
    f.attest(wad(2));

    f.vault.fulfill_epoch(&impostor);
}

#[test]
fn the_admin_is_not_the_manager() {
    let f = setup();
    f.attest(wad(2));

    assert!(f.vault.try_fulfill_epoch(&f.admin).is_err());
    assert_eq!(f.vault.current_epoch(), 1);
}

#[test]
fn fulfilling_keeps_the_struck_epoch_total() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));

    let epoch_1 = f.vault.get_epoch(&1).unwrap();
    assert_eq!(epoch_1.total_deposited, 400);
    assert_eq!(epoch_1.share_price, wad(2));
    assert_eq!(
        f.vault.get_deposit_request(&1, &investor).unwrap().amount,
        400
    );
}

#[test]
fn fulfilling_needs_the_manager_authorisation() {
    let f = setup();

    f.attest(wad(2));
    f.e.set_auths(&[]);
    assert!(f.vault.try_fulfill_epoch(&f.manager).is_err());
    assert_eq!(f.vault.current_epoch(), 1);
}
