use super::*;

#[test]
fn a_non_allowlisted_investor_cannot_claim_shares() {
    let f = setup();
    let stranger = f.unverified_investor(1_000);

    f.vault.request_deposit(&stranger, &400);
    f.fulfill_epoch(wad(2));

    assert!(f.vault.try_claim_deposit(&stranger, &1).is_err());
    assert_eq!(f.shares(&stranger), 0);
    assert!(!f.vault.get_deposit_request(&1, &stranger).unwrap().claimed);
    assert_eq!(f.balance(&f.vault.address), 400);
}

#[test]
fn allowlisting_after_the_fact_lets_the_claim_through() {
    let f = setup();
    let investor = f.unverified_investor(1_000);

    f.vault.request_deposit(&investor, &400);
    f.fulfill_epoch(wad(2));
    assert!(f.vault.try_claim_deposit(&investor, &1).is_err());

    f.identity.allow(&investor, &true, &f.admin);

    assert_eq!(f.vault.claim_deposit(&investor, &1), 200);
    assert_eq!(f.shares(&investor), 200);
}

#[test]
fn a_delisted_holder_can_still_queue_an_exit() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.current_epoch();

    f.identity.allow(&user, &false, &f.admin);

    assert_eq!(f.vault.request_redeem(&user, &200), epoch);
    assert_eq!(f.shares(&f.vault.address), 200);
}

#[test]
fn a_delisted_holder_can_still_claim_their_exit() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);
    f.fulfill_epoch(wad(2));

    f.identity.allow(&user, &false, &f.admin);

    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
    assert_eq!(f.balance(&user), 400);
}
