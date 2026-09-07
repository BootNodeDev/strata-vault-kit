use super::*;

#[test]
fn test_manager_can_fulfill_epoch_and_rotate() {
    let f = setup();

    assert_eq!(f.fulfill_epoch(wad(2)), 1);

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
    f.close_epoch();
    f.attest(wad(2));

    f.vault.fulfill_epoch(&impostor, &1);
}

#[test]
fn the_admin_is_not_the_manager() {
    let f = setup();
    f.close_epoch();
    f.attest(wad(2));

    assert!(f.vault.try_fulfill_epoch(&f.admin, &1).is_err());
    assert!(f.vault.try_close_epoch(&f.admin).is_err());
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

    f.close_epoch();
    f.attest(wad(2));
    f.e.set_auths(&[]);
    assert!(f.vault.try_fulfill_epoch(&f.manager, &1).is_err());
}

#[test]
fn closing_seals_the_epoch_and_opens_the_next() {
    let f = setup();

    assert_eq!(f.close_epoch(), 1);

    assert_eq!(f.vault.get_epoch(&1).unwrap().status, EpochStatus::Pending);
    assert_eq!(f.vault.get_epoch(&1).unwrap().share_price, 0);

    let next = f.vault.get_epoch(&2).unwrap();
    assert_eq!(next.status, EpochStatus::Open);
    assert_eq!(next.total_deposited, 0);
    assert_eq!(next.total_shares_redeeming, 0);
    assert_eq!(f.vault.current_epoch(), 2);
}

#[test]
fn a_deposit_cannot_join_a_sealed_epoch() {
    let f = setup();
    let early = f.investor(1_000);
    let late = f.investor(1_000);

    f.vault.request_deposit(&early, &400);
    f.close_epoch();

    assert_eq!(f.vault.request_deposit(&late, &400), 2);

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 400);
    assert_eq!(f.vault.get_epoch(&2).unwrap().total_deposited, 400);
    assert_eq!(f.vault.get_deposit_request(&1, &late), None);
}

#[test]
fn a_redeem_cannot_join_a_sealed_epoch() {
    let f = setup();
    let one = f.holder(500);
    let two = f.holder(500);

    let epoch = f.vault.request_redeem(&one, &200);
    let sealed = f.close_epoch();
    assert_eq!(sealed, epoch);

    assert_eq!(f.vault.request_redeem(&two, &100), sealed + 1);

    assert_eq!(
        f.vault.get_epoch(&sealed).unwrap().total_shares_redeeming,
        200
    );
    assert_eq!(f.vault.get_redeem_request(&sealed, &two), None);
}

#[test]
fn an_open_epoch_cannot_be_fulfilled() {
    let f = setup();
    f.attest(wad(2));

    assert!(f.vault.try_fulfill_epoch(&f.manager, &1).is_err());
    assert_eq!(f.vault.get_epoch(&1).unwrap().status, EpochStatus::Open);
}

#[test]
fn a_sealed_epoch_cannot_be_closed_again() {
    let f = setup();
    f.close_epoch();

    assert!(f.vault.try_fulfill_epoch(&f.manager, &1).is_err());
    assert_eq!(f.vault.get_epoch(&1).unwrap().status, EpochStatus::Pending);
    assert_eq!(f.vault.current_epoch(), 2);
}

#[test]
fn a_fulfilled_epoch_cannot_be_fulfilled_again() {
    let f = setup();
    let epoch = f.fulfill_epoch(wad(2));

    assert!(f.vault.try_fulfill_epoch(&f.manager, &epoch).is_err());
    assert_eq!(f.vault.get_epoch(&epoch).unwrap().share_price, wad(2));
}

#[test]
fn epochs_can_be_fulfilled_out_of_order_after_closing() {
    let f = setup();

    let first = f.close_epoch();
    let second = f.close_epoch();
    f.attest(wad(2));

    f.vault.fulfill_epoch(&f.manager, &second);
    f.vault.fulfill_epoch(&f.manager, &first);

    assert_eq!(
        f.vault.get_epoch(&first).unwrap().status,
        EpochStatus::Fulfilled
    );
    assert_eq!(
        f.vault.get_epoch(&second).unwrap().status,
        EpochStatus::Fulfilled
    );
}
