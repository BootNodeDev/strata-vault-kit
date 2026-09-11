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

/// Money a holder can still cancel is not the treasury's to deploy, in any
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

/// A refund after pricing is an extra payout, so it waits for free reserve
/// rather than taking money owed to a priced exit.
#[test]
fn a_dust_refund_never_takes_committed_money() {
    let f = setup();
    let holder = f.holder(200);
    let dust = f.investor(10);

    f.vault.request_deposit(&dust, &1);
    f.vault.request_redeem(&holder, &200);
    let epoch = f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&epoch);

    // Move every free unit out, leaving only what the redeemer is owed.
    f.vault.set_custodian(&f.custodian, &f.admin);
    let free = f.vault.free_reserve();
    if free > 0 {
        f.vault.deploy_to_custodian(&f.treasury, &free);
    }
    assert_eq!(f.vault.free_reserve(), 0);

    // The refund is refused rather than dipping into the redeemer's money.
    assert!(f.vault.try_claim_deposit(&dust, &epoch).is_err());
    assert!(f.balance(&f.vault.address) >= f.vault.committed());

    // Once there is spare cash, the refund goes through.
    let backer = f.investor(50);
    f.vault.fund(&backer, &10);
    assert_eq!(f.vault.claim_deposit(&dust, &epoch), 0);
    assert_eq!(f.balance(&dust), 10);
}

/// Cancelling before pricing returns escrow that was never counted as free, so
/// it must not be blocked by what the vault owes elsewhere.
#[test]
fn cancelling_is_never_blocked_by_what_the_vault_owes() {
    let f = setup();
    let holder = f.holder(200);
    let inv = f.investor(500);

    f.vault.request_redeem(&holder, &200);
    let epoch = f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&epoch);

    // A fresh deposit into the open epoch, with the vault fully committed.
    let open = f.vault.request_deposit(&inv, &500);
    assert_eq!(f.vault.free_reserve(), 0);

    assert_eq!(f.vault.cancel_deposit(&inv, &open), 500);
    assert_eq!(f.balance(&inv), 500);
}

// ---- cancellation is an escape hatch, not a free option ----

/// While the epoch is Open no price applies to it yet, so cancelling is free
/// even when the feed is healthy.
#[test]
fn an_open_epoch_cancels_with_a_healthy_feed() {
    let f = setup();
    let inv = f.investor(1_000);

    f.attest(wad(2));
    let epoch = f.vault.request_deposit(&inv, &400);

    assert_eq!(f.vault.cancel_deposit(&inv, &epoch), 400);
}

/// Once sealed, the standing attestation is the price this epoch will take. An
/// investor who can read it must not be able to decline it.
#[test]
fn a_sealed_epoch_cannot_be_cancelled_while_it_can_be_priced() {
    let f = setup();
    let inv = f.investor(1_000);

    let epoch = f.vault.request_deposit(&inv, &400);
    f.close_epoch();
    f.attest(wad(2));

    assert!(f.vault.try_cancel_deposit(&inv, &epoch).is_err());

    // The way out is to price it and claim, not to walk away.
    f.vault.fulfill_epoch(&epoch);
    assert_eq!(f.vault.claim_deposit(&inv, &epoch), 200);
}

/// A sealed epoch the feed cannot price is exactly the stuck case cancellation
/// exists for.
#[test]
fn a_sealed_epoch_cancels_once_the_feed_goes_stale() {
    let f = setup();
    let inv = f.investor(1_000);

    f.attest(wad(2));
    let epoch = f.vault.request_deposit(&inv, &400);
    f.close_epoch();

    f.advance(7_200); // past the freshness window
    assert_eq!(f.vault.cancel_deposit(&inv, &epoch), 400);
    assert_eq!(f.balance(&inv), 1_000);
}

#[test]
fn a_sealed_epoch_cancels_while_the_ripcord_is_raised() {
    let f = setup();
    let holder = f.holder(200);

    let epoch = f.vault.request_redeem(&holder, &200);
    f.close_epoch();
    f.oracle.raise_ripcord(&f.guardian);

    assert_eq!(f.vault.cancel_redeem(&holder, &epoch), 200);
    assert_eq!(f.shares(&holder), 200);
}
