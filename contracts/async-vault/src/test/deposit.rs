use super::*;

#[test]
fn test_request_deposit_updates_epoch_and_user_state() {
    let f = setup();
    let user = f.investor(1_000);

    assert_eq!(f.vault.request_deposit(&user, &400), 1);

    assert_eq!(f.balance(&user), 600);
    assert_eq!(f.balance(&f.vault.address), 400);

    let epoch_info = f.vault.get_epoch(&1).unwrap();
    assert_eq!(epoch_info.total_deposited, 400);
    assert_eq!(epoch_info.status, EpochStatus::Open);

    let user_req = f.vault.get_deposit_request(&1, &user).unwrap();
    assert_eq!(user_req.amount, 400);
    assert!(!user_req.claimed);
}

#[test]
fn deposits_from_several_investors_accumulate_in_the_epoch() {
    let f = setup();
    let one = f.investor(1_000);
    let two = f.investor(1_000);

    f.vault.request_deposit(&one, &400);
    f.vault.request_deposit(&two, &250);

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 650);
    assert_eq!(f.balance(&f.vault.address), 650);
    assert_eq!(f.vault.get_deposit_request(&1, &one).unwrap().amount, 400);
    assert_eq!(f.vault.get_deposit_request(&1, &two).unwrap().amount, 250);
}

#[test]
fn a_second_request_from_the_same_investor_is_rejected() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.request_deposit(&investor, &400);
    assert!(f.vault.try_request_deposit(&investor, &100).is_err());

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 400);
    assert_eq!(f.balance(&investor), 600);
}

#[test]
fn request_deposit_rejects_a_non_positive_amount() {
    let f = setup();
    let investor = f.investor(1_000);

    assert!(f.vault.try_request_deposit(&investor, &0).is_err());
    assert!(f.vault.try_request_deposit(&investor, &-1).is_err());
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn request_deposit_rejects_a_total_that_would_overflow() {
    let f = setup();
    let whale = f.investor(i128::MAX);
    let other = f.investor(1_000);

    f.vault.request_deposit(&whale, &(i128::MAX - 10));
    assert!(f.vault.try_request_deposit(&other, &11).is_err());

    assert_eq!(
        f.vault.get_epoch(&1).unwrap().total_deposited,
        i128::MAX - 10
    );
}

#[test]
fn request_deposit_needs_the_investor_authorisation() {
    let f = setup();
    let investor = f.investor(1_000);

    f.e.set_auths(&[]);
    assert!(f.vault.try_request_deposit(&investor, &100).is_err());
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn an_investor_without_a_request_reads_as_none() {
    let f = setup();
    let investor = f.investor(1_000);

    assert_eq!(f.vault.get_deposit_request(&1, &investor), None);
}

#[test]
fn test_user_can_claim_deposit_and_receive_shares() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));

    assert_eq!(f.vault.claim_deposit(&user, &1), 200);

    assert_eq!(f.shares(&user), 200);
    assert!(f.vault.get_deposit_request(&1, &user).unwrap().claimed);
    assert_eq!(f.balance(&f.vault.address), 400);
}

#[test]
#[should_panic(expected = "#6035")]
fn test_cannot_claim_twice() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));

    f.vault.claim_deposit(&user, &1);
    f.vault.claim_deposit(&user, &1);
}

#[test]
fn claiming_an_unfulfilled_epoch_is_rejected() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    assert!(f.vault.try_claim_deposit(&user, &1).is_err());
    assert_eq!(f.shares(&user), 0);
}

#[test]
fn claiming_without_a_request_is_rejected() {
    let f = setup();
    let stranger = Address::generate(&f.e);

    f.fulfill_epoch(wad(2));
    assert!(f.vault.try_claim_deposit(&stranger, &1).is_err());
}

#[test]
fn a_deposit_below_one_share_cannot_be_claimed() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &1);
    f.fulfill_epoch(wad(2));

    assert!(f.vault.try_claim_deposit(&user, &1).is_err());
    assert!(!f.vault.get_deposit_request(&1, &user).unwrap().claimed);
}

#[test]
fn claiming_needs_the_investor_authorisation() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));

    f.e.set_auths(&[]);
    assert!(f.vault.try_claim_deposit(&user, &1).is_err());
}

#[test]
fn claims_are_scoped_to_their_own_epoch() {
    let f = setup();
    let user = f.investor(1_000);

    f.vault.request_deposit(&user, &400);
    f.fulfill_epoch(wad(2));
    f.vault.request_deposit(&user, &300);
    f.fulfill_epoch(wad(3));

    assert_eq!(f.vault.claim_deposit(&user, &1), 200);
    assert_eq!(f.vault.claim_deposit(&user, &2), 100);
    assert_eq!(f.shares(&user), 300);
}

#[test]
fn deposits_after_fulfilling_land_in_the_new_epoch() {
    let f = setup();
    let investor = f.investor(1_000);

    f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));

    assert_eq!(f.vault.request_deposit(&investor, &300), 2);

    assert_eq!(f.vault.get_epoch(&1).unwrap().total_deposited, 400);
    assert_eq!(f.vault.get_epoch(&2).unwrap().total_deposited, 300);
    assert_eq!(
        f.vault.get_deposit_request(&2, &investor).unwrap().amount,
        300
    );
    assert_eq!(f.balance(&f.vault.address), 700);
}
