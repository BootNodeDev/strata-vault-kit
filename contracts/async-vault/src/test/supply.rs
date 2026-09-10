use super::*;

#[test]
fn economic_supply_reflects_fulfilled_unminted_deposits() {
    let f = setup();
    let user = f.investor(1_000);

    assert_eq!(f.vault.total_economic_supply(), 0);
    assert_eq!(f.vault.pending_mint_shares(), 0);

    // Request deposit of 400 assets. Unfulfilled epoch -> economic supply remains 0.
    let epoch = f.vault.request_deposit(&user, &400);
    assert_eq!(f.vault.total_economic_supply(), 0);
    assert_eq!(f.vault.pending_mint_shares(), 0);

    // Close and fulfill epoch at 2.0 WAD (400 assets / 2 = 200 shares owed).
    f.close_epoch();
    f.fulfill_epoch_at(epoch, wad(2));

    // Raw total_supply on token is still 0, but economic supply reflects the 200 shares owed.
    assert_eq!(f.share.total_supply(), 0);
    assert_eq!(f.vault.pending_mint_shares(), 200);
    assert_eq!(f.vault.total_economic_supply(), 200);

    // User claims deposit.
    f.vault.claim_deposit(&user, &epoch);

    // Raw token supply is now 200, pending_mint_shares is 0, economic supply remains 200.
    assert_eq!(f.share.total_supply(), 200);
    assert_eq!(f.vault.pending_mint_shares(), 0);
    assert_eq!(f.vault.total_economic_supply(), 200);
}

#[test]
fn economic_supply_excludes_shares_locked_in_redemption_escrow() {
    let f = setup();
    let holder = f.holder(200);

    // Holder has 200 shares minted.
    assert_eq!(f.share.total_supply(), 200);
    assert_eq!(f.vault.total_economic_supply(), 200);

    // Holder requests redeem of 50 shares.
    let epoch = f.vault.request_redeem(&holder, &50);

    // Shares are in vault escrow (forced transfer), so circulating economic supply drops to 150.
    assert_eq!(f.share.total_supply(), 200);
    assert_eq!(f.share.balance(&f.vault.address), 50);
    assert_eq!(f.vault.total_economic_supply(), 150);

    // Close and fulfill epoch and claim.
    f.close_epoch();
    f.fulfill_epoch_at(epoch, wad(2));
    assert_eq!(f.vault.pending_redeem_assets(), 100);

    f.vault.claim_redeem(&holder, &epoch);

    // After claim, the 50 shares are burned. Total supply is 150, vault escrow is 0.
    assert_eq!(f.share.total_supply(), 150);
    assert_eq!(f.share.balance(&f.vault.address), 0);
    assert_eq!(f.vault.total_economic_supply(), 150);
    assert_eq!(f.vault.pending_redeem_assets(), 0);
}

#[test]
fn economic_supply_combines_circulating_and_pending_mint_correctly() {
    let f = setup();
    let holder = f.holder(100);
    let depositor = f.investor(1_000);

    // Initially 100 shares circulating.
    assert_eq!(f.vault.total_economic_supply(), 100);

    // Depositor requests 300 assets, holder requests 40 shares redeem.
    let epoch = f.vault.request_deposit(&depositor, &300);
    f.vault.request_redeem(&holder, &40);

    // Circulating dropped to 60 (100 - 40 in vault).
    assert_eq!(f.vault.total_economic_supply(), 60);

    // Close and fulfill at 1.0 WAD: 300 assets / 1 = 300 shares owed.
    f.close_epoch();
    f.fulfill_epoch_at(epoch, wad(1));

    // Economic supply = 60 circulating + 300 pending mint = 360.
    assert_eq!(f.vault.pending_mint_shares(), 300);
    assert_eq!(f.vault.total_economic_supply(), 360);

    // Depositor claims 300 shares.
    f.vault.claim_deposit(&depositor, &epoch);

    // Raw supply is now 400 (100 initial + 300 minted), vault has 40 in escrow -> 360 economic supply.
    assert_eq!(f.share.total_supply(), 400);
    assert_eq!(f.vault.pending_mint_shares(), 0);
    assert_eq!(f.vault.total_economic_supply(), 360);
}
