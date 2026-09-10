use super::*;

/// Several epochs sit Pending at once, and any caller may price any of them.
#[test]
fn several_epochs_can_be_pending_at_once() {
    let f = setup();
    let a = f.holder(200);

    f.vault.request_redeem(&a, &100);
    let first = f.close_epoch();
    let second = f.close_epoch();

    assert_eq!(
        f.vault.get_epoch(&first).unwrap().status,
        EpochStatus::Pending
    );
    assert_eq!(
        f.vault.get_epoch(&second).unwrap().status,
        EpochStatus::Pending
    );
    assert_eq!(f.vault.current_epoch(), second + 1);
}

/// Pricing the younger epoch first is accepted today. #73 leaves this open on
/// purpose: order of pricing must not decide who gets paid.
#[test]
fn a_younger_epoch_can_be_priced_first() {
    let f = setup();
    let a = f.holder(200);

    f.vault.request_redeem(&a, &100);
    let first = f.close_epoch();
    let second = f.close_epoch();

    f.attest(wad(2));
    f.vault.fulfill_epoch(&second);
    f.vault.fulfill_epoch(&first);

    assert_eq!(
        f.vault.get_epoch(&first).unwrap().status,
        EpochStatus::Fulfilled
    );
    assert_eq!(
        f.vault.get_epoch(&second).unwrap().status,
        EpochStatus::Fulfilled
    );
}

/// One aggregate floor is credited at pricing, one floor per claimant is debited.
/// The sum of floors is at most the floor of the sum, so a residue is left behind
/// that no path releases. Three odd share counts lose half a unit each; the odd
/// aggregate loses only half.
#[test]
fn the_rounding_residue_is_never_released() {
    let f = setup();
    let a = f.holder(101);
    let b = f.holder(103);
    let c = f.holder(105);

    f.vault.request_redeem(&a, &101);
    f.vault.request_redeem(&b, &103);
    f.vault.request_redeem(&c, &105);
    let epoch = f.close_epoch();

    f.attest(wad(3) / 2);
    f.vault.fulfill_epoch(&epoch);

    // floor(309 * 1.5) = 463 credited for the epoch.
    assert_eq!(f.vault.committed(), 463);

    f.vault.claim_redeem(&a, &epoch); // floor(101 * 1.5) = 151
    f.vault.claim_redeem(&b, &epoch); // floor(103 * 1.5) = 154
    f.vault.claim_redeem(&c, &epoch); // floor(105 * 1.5) = 157

    // 151 + 154 + 157 = 462, one short of the 463 credited.
    assert_eq!(f.vault.committed(), 1);
}

/// One controller may hold a live redemption in two epochs at once, because the
/// outstanding-request check is keyed per epoch. Claims are taken newest first
/// here, which today is allowed.
#[test]
fn one_controller_redeems_across_two_epochs() {
    let f = setup();
    let a = f.holder(500);

    f.vault.request_redeem(&a, &200);
    let first = f.close_epoch();
    f.vault.request_redeem(&a, &200);
    let second = f.close_epoch();

    assert_eq!(f.shares(&a), 100);

    f.attest(wad(2));
    f.vault.fulfill_epoch(&first);
    f.vault.fulfill_epoch(&second);

    f.vault.claim_redeem(&a, &second);
    f.vault.claim_redeem(&a, &first);

    assert_eq!(f.shares(&a), 100);
    assert_eq!(f.vault.committed(), 0);
}

/// A deposit-only epoch computes nothing owed and passes the coverage test
/// trivially. An epoch with neither side still prices. Both shapes appear only in
/// a sequence.
#[test]
fn deposit_only_redeem_only_and_empty_epochs() {
    let f = setup();
    let inv = f.investor(1_000);

    let deposits = f.vault.request_deposit(&inv, &400);
    f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&deposits);
    f.vault.claim_deposit(&inv, &deposits);
    assert_eq!(f.shares(&inv), 200);

    f.vault.request_redeem(&inv, &200);
    let redeems = f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&redeems);

    let empty = f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&empty);
    assert_eq!(f.vault.get_epoch(&empty).unwrap().total_deposited, 0);

    f.vault.claim_redeem(&inv, &redeems);
    assert_eq!(f.vault.committed(), 0);
}

/// An epoch whose whole redemption total floors to zero reaches Fulfilled having
/// recorded no liability. The claim then hands each holder their shares back
/// rather than keeping them.
#[test]
fn an_epoch_that_owes_nothing_is_fulfilled_having_paid_nobody() {
    let f = setup();
    let r1 = f.holder(1);
    let r2 = f.holder(1);

    f.vault.request_redeem(&r1, &1);
    f.vault.request_redeem(&r2, &1);
    let epoch = f.close_epoch();

    // 0.4 per share: floor(2 * 0.4) = 0 owed for the whole epoch.
    f.attest(wad(4) / 10);
    f.vault.fulfill_epoch(&epoch);
    assert_eq!(f.vault.committed(), 0);

    // Each claim pays nothing, so the shares go back to their holders.
    assert_eq!(f.vault.claim_redeem(&r1, &epoch), 0);
    assert_eq!(f.vault.claim_redeem(&r2, &epoch), 0);
    assert_eq!(f.shares(&r1), 1);
    assert_eq!(f.shares(&r2), 1);
    assert_eq!(f.shares(&f.vault.address), 0);
}

/// A later epoch's deposit is still refundable, so it does not fund an earlier
/// epoch's exit. Only priced money does.
#[test]
fn a_later_epochs_deposit_does_not_fund_an_earlier_exit() {
    let f = setup();
    let a = f.holder(200);
    let late = f.investor(1_000);

    // Move the vault's own cash out, so only the new deposit can cover the exit.
    f.vault.set_custodian(&f.custodian, &f.admin);
    let free = f.vault.free_reserve();
    f.vault.deploy_to_custodian(&f.treasury, &free);

    f.vault.request_redeem(&a, &100);
    let exits = f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&exits);

    // Nothing on hand, so the claim waits.
    assert!(f.vault.try_claim_redeem(&a, &exits).is_err());

    // A deposit into the open epoch is recallable, so it changes nothing.
    f.vault.request_deposit(&late, &400);
    assert_eq!(f.vault.cancellable_escrow(), 400);
    assert_eq!(f.vault.uncovered(), 200);
    assert!(f.vault.try_claim_redeem(&a, &exits).is_err());

    // Money the custodian returns is not recallable, so it does fund the exit.
    f.vault.fund(&f.custodian, &200);
    assert_eq!(f.vault.uncovered(), 0);
    assert_eq!(f.vault.claim_redeem(&a, &exits), 200);
}

// ---- #73: pricing and payment are separate ----

/// An epoch prices whether or not the cash is there. The liability is recorded
/// and the gap is visible.
#[test]
fn an_epoch_prices_without_the_cash() {
    let f = setup();
    let a = f.holder(200);

    f.vault.set_custodian(&f.custodian, &f.admin);
    f.vault
        .deploy_to_custodian(&f.treasury, &f.vault.free_reserve());

    f.vault.request_redeem(&a, &100);
    let epoch = f.close_epoch();

    f.attest(wad(2));
    f.vault.fulfill_epoch(&epoch);

    assert_eq!(
        f.vault.get_epoch(&epoch).unwrap().status,
        EpochStatus::Fulfilled
    );
    assert_eq!(f.vault.committed(), 200);
    assert_eq!(f.vault.uncovered(), 200);
    assert_eq!(f.vault.free_reserve(), 0);
}

/// A claim pays only when the reserve covers that claim's own amount.
#[test]
fn a_claim_waits_until_the_reserve_covers_it() {
    let f = setup();
    let a = f.holder(200);

    f.vault.set_custodian(&f.custodian, &f.admin);
    f.vault
        .deploy_to_custodian(&f.treasury, &f.vault.free_reserve());

    f.vault.request_redeem(&a, &100);
    let epoch = f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&epoch);

    assert!(f.vault.try_claim_redeem(&a, &epoch).is_err());

    f.vault.fund(&f.custodian, &200);
    assert_eq!(f.vault.claim_redeem(&a, &epoch), 200);
    assert_eq!(f.vault.uncovered(), 0);
}

/// No holder is ordered ahead of another. A covered claim pays even while an
/// earlier, larger one is still waiting.
#[test]
fn a_covered_claim_pays_while_a_larger_one_waits() {
    let f = setup();
    let big = f.holder(400);
    let small = f.holder(20);

    f.vault.set_custodian(&f.custodian, &f.admin);
    f.vault
        .deploy_to_custodian(&f.treasury, &f.vault.free_reserve());

    f.vault.request_redeem(&big, &400);
    f.vault.request_redeem(&small, &20);
    let epoch = f.close_epoch();
    f.attest(wad(2));
    f.vault.fulfill_epoch(&epoch);

    // 840 owed in total, only 100 on hand.
    f.vault.fund(&f.custodian, &100);

    assert!(f.vault.try_claim_redeem(&big, &epoch).is_err());
    assert_eq!(f.vault.claim_redeem(&small, &epoch), 40);
}

/// Nothing leaves for the custodian while a holder is owed money the vault does
/// not hold.
#[test]
fn the_treasury_cannot_deploy_while_anything_is_uncovered() {
    let f = setup();
    let a = f.holder(200);

    f.vault.set_custodian(&f.custodian, &f.admin);
    f.vault.request_redeem(&a, &200);
    let epoch = f.close_epoch();
    f.attest(wad(3));
    f.vault.fulfill_epoch(&epoch);

    // 600 owed against 400 held.
    assert_eq!(f.vault.uncovered(), 200);
    assert_eq!(f.vault.free_reserve(), 0);
    assert!(f.vault.try_deploy_to_custodian(&f.treasury, &1).is_err());
}
