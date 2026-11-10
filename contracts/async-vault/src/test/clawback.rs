//! The asset's issuer takes part of the vault's balance: what is still paid,
//! what is refused by name, and how funding the gap lifts each refusal.

use super::*;

#[test]
fn a_cancellation_the_balance_cannot_cover_is_refused_by_name() {
    let f = setup();
    let a = f.investor(1_000);
    f.vault.request_deposit(&a, &100);
    f.claw_back(60);

    refused(
        f.vault.try_cancel_deposit(&a, &1),
        VaultError::EscrowNotCovered,
    );
    assert_eq!(f.balance(&a), 900);
    assert!(f.vault.get_deposit_request(&1, &a).is_some());
    assert_eq!(f.vault.uncovered(), 60);

    f.vault.fund(&f.unverified_investor(60), &60);
    assert_eq!(f.vault.cancel_deposit(&a, &1), 100);
    assert_eq!(f.balance(&a), 1_000);
}

#[test]
fn cancellations_are_paid_in_the_order_they_come_while_the_balance_lasts() {
    let f = setup();
    let (a, b) = (f.investor(1_000), f.investor(1_000));
    f.vault.request_deposit(&a, &30);
    f.vault.request_deposit(&b, &70);
    f.claw_back(70);

    assert_eq!(f.vault.cancel_deposit(&a, &1), 30);
    refused(
        f.vault.try_cancel_deposit(&b, &1),
        VaultError::EscrowNotCovered,
    );
    f.vault.fund(&f.unverified_investor(70), &70);
    assert_eq!(f.vault.cancel_deposit(&b, &1), 70);
}

#[test]
fn no_deposit_is_taken_while_the_balance_is_below_the_escrow() {
    let f = setup();
    let (a, b) = (f.investor(1_000), f.investor(1_000));
    f.vault.request_deposit(&a, &100);
    f.claw_back(1);

    refused(
        f.vault.try_request_deposit(&b, &50),
        VaultError::EscrowNotCovered,
    );
    assert_eq!(f.balance(&b), 1_000);
    f.vault.fund(&f.unverified_investor(1), &1);
    f.vault.request_deposit(&b, &50);
}

#[test]
fn a_priced_redemption_waits_while_the_issuer_has_taken_the_escrow() {
    let f = setup();
    let holder = f.holder(100);
    f.vault.request_redeem(&holder, &100);
    let exit = f.close_epoch();
    let c = f.investor(1_000);
    f.vault.request_deposit(&c, &300);
    f.fulfill_epoch_at(exit, wad(2));
    f.claw_back(300);

    refused(
        f.vault.try_claim_redeem(&holder, &exit),
        VaultError::ClaimNotCovered,
    );
    assert_eq!(f.vault.uncovered(), 300);
    f.vault.fund(&f.unverified_investor(300), &300);
    assert_eq!(f.vault.claim_redeem(&holder, &exit), 200);
    assert_eq!(f.vault.cancel_deposit(&c, &(exit + 1)), 300);
}

#[test]
fn a_refund_below_one_share_waits_while_the_issuer_has_taken_the_escrow() {
    let f = setup();
    let dust = f.investor(1_000);
    f.vault.request_deposit(&dust, &1);
    let priced = f.fulfill_epoch(wad(2));
    let pending = f.investor(1_000);
    f.vault.request_deposit(&pending, &100);
    f.claw_back(2);

    refused(
        f.vault.try_claim_deposit(&dust, &priced),
        VaultError::ClaimNotCovered,
    );
    f.vault.fund(&f.unverified_investor(2), &2);
    assert_eq!(f.vault.claim_deposit(&dust, &priced), 0);
    assert_eq!(f.balance(&dust), 1_000);
}

#[test]
fn nothing_goes_to_the_custodian_while_the_issuer_has_taken_the_escrow() {
    let f = setup();
    f.holder(100);
    let pending = f.investor(1_000);
    f.vault.request_deposit(&pending, &100);
    f.claw_back(250);

    refused(
        f.vault.try_deploy_to_custodian(&f.treasury, &1),
        VaultError::ReserveCommittedToExits,
    );
    assert_eq!(f.vault.free_reserve(), 0);
    assert_eq!(f.vault.uncovered(), 50);
}

#[test]
fn pricing_ignores_a_shortfall_and_mints_the_full_deposit() {
    let f = setup();
    let a = f.investor(1_000);
    f.vault.request_deposit(&a, &100);
    f.claw_back(40);
    let epoch = f.fulfill_epoch(wad(1));

    assert_eq!(f.vault.claim_deposit(&a, &epoch), 100);
    assert_eq!(f.vault.liquid_reserve(), 60);
}
