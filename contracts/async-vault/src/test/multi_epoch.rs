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
    assert_eq!(f.vault.pending_redeem_assets(), 463);

    f.vault.claim_redeem(&a, &epoch); // floor(101 * 1.5) = 151
    f.vault.claim_redeem(&b, &epoch); // floor(103 * 1.5) = 154
    f.vault.claim_redeem(&c, &epoch); // floor(105 * 1.5) = 157

    // 151 + 154 + 157 = 462, one short of the 463 credited.
    assert_eq!(f.vault.pending_redeem_assets(), 1);
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
    assert_eq!(f.vault.pending_redeem_assets(), 0);
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
    assert_eq!(f.vault.pending_redeem_assets(), 0);
}

/// An epoch whose whole redemption total floors to zero still reaches Fulfilled,
/// having recorded no liability and paid nobody. Fulfilled does not mean settled.
/// #74 is what gives these shares a way back.
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
    assert_eq!(f.vault.pending_redeem_assets(), 0);

    // Each claim floors to zero and is refused, so the shares stay escrowed.
    assert!(f.vault.try_claim_redeem(&r1, &epoch).is_err());
    assert!(f.vault.try_claim_redeem(&r2, &epoch).is_err());
    assert_eq!(f.shares(&f.vault.address), 2);
}

/// Coverage is measured against the whole asset balance, so cash deposited into a
/// later epoch counts toward an earlier epoch's redemptions. #74 removes that,
/// because unpriced deposits become refundable.
#[test]
fn a_later_epochs_deposit_covers_an_earlier_epochs_redemption() {
    let f = setup();
    let a = f.holder(200);
    let late = f.investor(1_000);

    // Move the vault's own cash out, so only the new deposit can cover the exit.
    f.vault.set_custodian(&f.custodian, &f.admin);
    let free = f.vault.free_reserve();
    f.vault.deploy_to_custodian(&f.treasury, &free);

    f.vault.request_redeem(&a, &100);
    let exits = f.close_epoch();

    assert!(f.vault.try_fulfill_epoch(&exits).is_err());

    // A deposit that belongs to the open epoch makes the older epoch fundable.
    f.vault.request_deposit(&late, &400);
    f.attest(wad(2));
    f.vault.fulfill_epoch(&exits);

    assert_eq!(
        f.vault.get_epoch(&exits).unwrap().status,
        EpochStatus::Fulfilled
    );
}
