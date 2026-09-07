use super::*;

#[test]
fn test_request_redeem_locks_shares_and_updates_epoch() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.current_epoch();

    assert_eq!(f.shares(&user), 500);
    assert_eq!(f.vault.request_redeem(&user, &200), epoch);

    assert_eq!(f.shares(&user), 300);
    assert_eq!(f.shares(&f.vault.address), 200);

    assert_eq!(
        f.vault.get_epoch(&epoch).unwrap().total_shares_redeeming,
        200
    );

    let user_req = f.vault.get_redeem_request(&epoch, &user).unwrap();
    assert_eq!(user_req.shares, 200);
    assert!(!user_req.claimed);
}

#[test]
fn request_redeem_rejects_a_non_positive_amount() {
    let f = setup();
    let user = f.holder(500);

    assert!(f.vault.try_request_redeem(&user, &0).is_err());
    assert!(f.vault.try_request_redeem(&user, &-1).is_err());
    assert_eq!(f.shares(&user), 500);
}

#[test]
fn a_second_redeem_request_in_the_same_epoch_is_rejected() {
    let f = setup();
    let user = f.holder(500);

    f.vault.request_redeem(&user, &200);
    assert!(f.vault.try_request_redeem(&user, &100).is_err());
    assert_eq!(f.shares(&user), 300);
}

#[test]
fn request_redeem_needs_the_holder_authorisation() {
    let f = setup();
    let user = f.holder(500);

    f.e.set_auths(&[]);
    assert!(f.vault.try_request_redeem(&user, &200).is_err());
    assert_eq!(f.shares(&user), 500);
}

#[test]
fn redeeming_more_shares_than_held_is_rejected() {
    let f = setup();
    let user = f.holder(500);

    assert!(f.vault.try_request_redeem(&user, &501).is_err());
    assert_eq!(f.shares(&user), 500);
}

#[test]
fn test_claim_redeem_pays_assets_and_burns_the_shares() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);

    let supply_before = f.share.total_supply();
    let vault_assets_before = f.balance(&f.vault.address);

    f.fulfill_epoch(wad(2));
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);

    assert_eq!(f.balance(&user), 400);
    assert_eq!(f.balance(&f.vault.address), vault_assets_before - 400);
    assert_eq!(f.shares(&f.vault.address), 0);
    assert_eq!(f.share.total_supply(), supply_before - 200);
    assert!(f.vault.get_redeem_request(&epoch, &user).unwrap().claimed);
}

#[test]
fn a_redeem_cannot_be_claimed_twice() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.fulfill_epoch(wad(2));

    f.vault.claim_redeem(&user, &epoch);
    assert!(f.vault.try_claim_redeem(&user, &epoch).is_err());
    assert_eq!(f.balance(&user), 400);
}

#[test]
fn claiming_a_redeem_before_the_epoch_is_fulfilled_is_rejected() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);

    assert!(f.vault.try_claim_redeem(&user, &epoch).is_err());
    assert_eq!(f.shares(&f.vault.address), 200);
}

#[test]
fn fulfill_is_rejected_when_the_vault_cannot_cover_the_redemptions() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &500);

    assert_eq!(f.balance(&f.vault.address), 1_000);

    f.close_epoch();
    f.attest(wad(4));
    assert!(f.vault.try_fulfill_epoch(&f.manager, &epoch).is_err());
    assert_eq!(
        f.vault.get_epoch(&epoch).unwrap().status,
        EpochStatus::Pending
    );
}

#[test]
fn a_covered_epoch_is_struck_and_leaves_the_liability_pending() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &500);

    f.fulfill_epoch(wad(2));

    assert_eq!(
        f.vault.get_epoch(&epoch).unwrap().status,
        EpochStatus::Fulfilled
    );
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 1_000);
    assert_eq!(f.balance(&f.vault.address), 0);
}
