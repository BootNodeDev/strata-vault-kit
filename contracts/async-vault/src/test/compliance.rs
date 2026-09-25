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

#[test]
fn a_delisted_investor_can_cancel_deposit_and_receive_asset() {
    let f = setup();
    let investor = f.investor(1_000);
    let epoch = f.vault.request_deposit(&investor, &400);

    // Investor gets delisted
    f.identity.allow(&investor, &false, &f.admin);

    // Delisted investor can still cancel deposit and receive settlement asset
    assert_eq!(f.vault.cancel_deposit(&investor, &epoch), 400);
    assert_eq!(f.balance(&investor), 1_000);
}

#[test]
fn a_delisted_holder_cannot_cancel_redemption_back_to_shares() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);

    // Delisted before pricing
    f.identity.allow(&user, &false, &f.admin);

    // Cannot return shares to a delisted account (refused by share transfer compliance)
    assert!(f.vault.try_cancel_redeem(&user, &epoch).is_err());
    assert_eq!(f.shares(&user), 300);

    // Exit proceeds through cash claim once fulfilled
    f.fulfill_epoch(wad(2));
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
    assert_eq!(f.balance(&user), 400);
}

#[test]
fn a_frozen_holder_cannot_cancel_redemption_back_to_shares() {
    let f = setup();
    let user = f.holder(500);
    let epoch = f.vault.request_redeem(&user, &200);

    // Freeze address
    f.share.set_address_frozen(&user, &true, &f.admin);
    assert!(f.share.is_frozen(&user));

    // Cannot return shares to a frozen account
    assert!(f.vault.try_cancel_redeem(&user, &epoch).is_err());
    assert_eq!(f.shares(&user), 300);

    // Exit proceeds through cash claim once fulfilled
    f.fulfill_epoch(wad(2));
    assert_eq!(f.vault.claim_redeem(&user, &epoch), 400);
    assert_eq!(f.balance(&user), 400);
}

#[test]
fn a_frozen_or_delisted_holder_cannot_transfer_shares() {
    let f = setup();
    let user = f.holder(500);
    let recipient = f.investor(0);

    // Transfer works when both allowlisted
    f.share.transfer(&user, &recipient, &100);
    assert_eq!(f.shares(&recipient), 100);

    // Delisted sender cannot transfer
    f.identity.allow(&user, &false, &f.admin);
    assert!(f.share.try_transfer(&user, &recipient, &100).is_err());

    // Restore allowlist, then freeze sender
    f.identity.allow(&user, &true, &f.admin);
    f.share.set_address_frozen(&user, &true, &f.admin);
    assert!(f.share.try_transfer(&user, &recipient, &100).is_err());
}
