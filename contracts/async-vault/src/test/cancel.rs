//! Cancelling a request before its epoch is priced.

use super::*;

#[test]
fn cancelling_a_deposit_returns_the_asset() {
    let f = setup();
    let inv = f.investor(1_000);

    let epoch = f.vault.request_deposit(&inv, &400);
    assert_eq!(f.balance(&inv), 600);
    assert_eq!(f.vault.get_epoch(&epoch).unwrap().total_deposited, 400);

    assert_eq!(f.vault.cancel_deposit(&inv, &epoch), 400);

    assert_eq!(f.balance(&inv), 1_000);
    assert_eq!(f.vault.get_epoch(&epoch).unwrap().total_deposited, 0);
    assert_eq!(f.vault.get_deposit_request(&epoch, &inv), None);
}

#[test]
fn cancelling_a_redemption_returns_the_shares() {
    let f = setup();
    let holder = f.holder(200);

    let epoch = f.vault.request_redeem(&holder, &200);
    assert_eq!(f.shares(&holder), 0);

    assert_eq!(f.vault.cancel_redeem(&holder, &epoch), 200);

    assert_eq!(f.shares(&holder), 200);
    assert_eq!(f.vault.get_epoch(&epoch).unwrap().total_shares_redeeming, 0);
    assert_eq!(f.vault.get_redeem_request(&epoch, &holder), None);
}

/// The window closes at pricing, not at sealing. A sealed epoch that cannot be
/// priced is exactly where a stuck deposit needs the way out.
#[test]
fn a_sealed_epoch_is_still_cancellable() {
    let f = setup();
    let inv = f.investor(1_000);

    let epoch = f.vault.request_deposit(&inv, &400);
    f.close_epoch();

    assert_eq!(
        f.vault.get_epoch(&epoch).unwrap().status,
        EpochStatus::Pending
    );
    assert_eq!(f.vault.cancel_deposit(&inv, &epoch), 400);
    assert_eq!(f.balance(&inv), 1_000);
}

#[test]
fn a_priced_epoch_is_not_cancellable() {
    let f = setup();
    let inv = f.investor(1_000);

    let epoch = f.vault.request_deposit(&inv, &400);
    f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&epoch);

    assert!(f.vault.try_cancel_deposit(&inv, &epoch).is_err());
}

#[test]
fn the_pause_never_blocks_a_cancellation() {
    let f = setup();
    let inv = f.investor(1_000);
    let holder = f.holder(200);

    let epoch = f.vault.request_deposit(&inv, &400);
    f.vault.request_redeem(&holder, &200);

    f.vault.pause(&f.guardian);

    assert_eq!(f.vault.cancel_deposit(&inv, &epoch), 400);
    assert_eq!(f.vault.cancel_redeem(&holder, &epoch), 200);
}

#[test]
fn the_same_investor_can_request_again_after_cancelling() {
    let f = setup();
    let inv = f.investor(1_000);

    let epoch = f.vault.request_deposit(&inv, &400);
    f.vault.cancel_deposit(&inv, &epoch);

    assert_eq!(f.vault.request_deposit(&inv, &250), epoch);
    assert_eq!(f.vault.get_epoch(&epoch).unwrap().total_deposited, 250);
}

/// Money a holder can still recall is not the treasury's to deploy, in any
/// unpriced epoch, not only the open one.
#[test]
fn refundable_escrow_is_not_free_reserve() {
    let f = setup();
    let inv = f.investor(1_000);
    f.vault.set_custodian(&f.custodian, &f.admin);

    let before = f.vault.free_reserve();
    f.vault.request_deposit(&inv, &400);

    assert_eq!(f.vault.cancellable_escrow(), 400);
    assert_eq!(f.vault.free_reserve(), before);
    assert!(f
        .vault
        .try_deploy_to_custodian(&f.treasury, &(before + 1))
        .is_err());
}

#[test]
fn sealing_an_epoch_keeps_its_deposits_refundable() {
    let f = setup();
    let inv = f.investor(1_000);

    f.vault.request_deposit(&inv, &400);
    f.close_epoch();

    assert_eq!(f.vault.cancellable_escrow(), 400);
}

#[test]
fn pricing_an_epoch_makes_its_deposits_deployable() {
    let f = setup();
    let inv = f.investor(1_000);

    let epoch = f.vault.request_deposit(&inv, &400);
    let before = f.vault.free_reserve();
    f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(f.vault.cancellable_escrow(), 0);
    assert_eq!(f.vault.free_reserve(), before + 400);
}

/// A request too small to price used to be unclaimable and unrecoverable. The
/// claim now returns the escrow instead of refusing.
#[test]
fn a_deposit_that_mints_nothing_is_refunded_at_claim() {
    let f = setup();
    let inv = f.investor(10);

    let epoch = f.vault.request_deposit(&inv, &1);
    f.close_epoch();
    f.attest(wad(4));
    f.vault.fulfill_epoch(&epoch);

    // 1 asset at 4.0 mints zero shares.
    assert_eq!(f.vault.claim_deposit(&inv, &epoch), 0);
    assert_eq!(f.balance(&inv), 10);
    assert_eq!(f.shares(&inv), 0);
}

#[test]
fn a_redemption_that_pays_nothing_returns_the_shares_at_claim() {
    let f = setup();
    let holder = f.holder(1);

    let epoch = f.vault.request_redeem(&holder, &1);
    f.close_epoch();
    f.attest(wad(4) / 10);
    f.vault.fulfill_epoch(&epoch);

    // 1 share at 0.4 pays zero assets.
    assert_eq!(f.vault.claim_redeem(&holder, &epoch), 0);
    assert_eq!(f.shares(&holder), 1);
}
